# Audit: PianoKiosk User Integration

**Date:** 2026-07-27
**Scope:** `frontend/src/modules/Piano/PianoKiosk/` (+ `Apps/PianoApp.jsx` wiring and the
backend surfaces it calls in `4_api/v1/routers/piano.mjs`, `routers/play.mjs`,
`3_applications/piano/UserVideoProgressStore.mjs`, `1_adapters/piano/YamlPianoStudioDatastore.mjs`).
**Question:** Is per-user identity (roster / current player / Guest) wired correctly and
consistently through the kiosk?

---

## Architecture summary (what's working)

- **Single identity source.** `PianoUserProvider` (mounted per-piano in `PianoApp.jsx`)
  owns roster + `currentUser`, persisted per piano in `localStorage["piano:user:{pianoId}"]`,
  defaulting to the first roster user. All consumers go through `usePianoUser()` or read
  the context optionally (`PianoUserChip`, `Games`) so isolated mounts degrade to no-user.
- **Roster SSOT.** Backend `getRoster()` reads `household.yml → users` via
  `UserService.getHouseholdRoster()` — no per-app restatement. Frontend fetches it once
  from `GET /api/v1/piano/users`.
- **Guest is a deliberate identity, not a roster entry.** `GUEST_PROFILE` (`pianoUser.js`)
  is the dismiss-outcome: idle-gap re-prompt dismissed, or "Turn off screen"
  (`usePianoScreenOff` → `setCurrentUser('guest')`). The chip renders Guest whenever
  there's no resolvable profile, so the header never shows blank.
- **Backend validation is consistent and safe.** Every per-user endpoint (studio,
  compositions, preferences, preset, progress, course playable) gates on
  `isKnownUser` → 400, guarding arbitrary dir creation under `data/users/`. The one
  deliberate exception is MIDI history (`PUT /users/:userId/history/...`), which accepts
  `guest` and stores at household level — matching the always-on recorder's need to
  capture anonymous play.
- **Mis-credit protections work.** `useAutoMidiHistory` closes the open take when the
  owner changes (owner read live via ref); the user chip locks while a video lecture is
  open; the idle-gap re-prompt is suppressed during video and Listen-mode playback;
  `UserVideoProgressStore.record()` no-ops for unknown users, and the economy earn only
  fires on a real user's `newlyCompleted` transition — guests can't earn coins or create
  phantom progress files.
- **Graceful null-user degradation.** Before the roster loads (or if it fails),
  `currentUser` is `null`: Studio disables its API base, Videos falls back to the
  device-level fitness playable endpoint, watch-log payloads omit `userId`, auto-history
  attributes to `'guest'`.

---

## Findings

### F1 — Guest Studio takes are silently lost (medium)

`Studio.jsx` treats any truthy `currentUser` as valid, and `'guest'` is truthy. A guest
can record a take, get the keep/discard review prompt, choose **keep** — and the
`POST /users/guest/studio` 400s (`Invalid user`). The failure is only
`logger.error('studio.save-failed')`; the UI gives no feedback and the take is gone.
Same for favorite/delete (400, warn-logged).

*Recommendation:* gate recording (or at least the keep action) on
`currentUser !== 'guest'` with a "pick a player to save recordings" affordance, or route
guest takes to the household-level history store the way auto-history already does.

### F2 — Guest Composer edits can't persist; partial feedback (medium-low)

`Composer.jsx` checks `currentUser ? <Gallery/> : 'Loading…'` — `'guest'` passes. The
autosave `create`/`save` calls 400; `EditorSurface` does surface a "Couldn't save" status
chip, but nothing explains *why* or how to fix it (pick a player), and the gallery list
request is a guaranteed 400. A guest can build a whole piece that never persists.

*Recommendation:* same gating pattern as F1; the `currentUser ? … : …` branch should
treat `'guest'` like the null case (or show a dedicated guest notice).

### F3 — Persisted `'guest'` silently becomes the first roster user on reload (medium-low)

`setCurrentUser('guest')` writes `'guest'` to localStorage, but the restore effect in
`PianoUserContext` only honors saved ids that exist in the roster — so after any reload
(FKB restart, jank reboot, deploy reload) an explicit "I'm stepping away / Guest" state
becomes `users[0]`. Auto MIDI history then attributes the next played notes to the first
roster user until the idle-gap re-prompt fires and is answered (the re-prompt does catch
long gaps, so the mis-credit window is small — but it's roster-order-dependent and
contradicts the deliberate guest semantics).

*Recommendation:* honor `saved === 'guest'` in the restore branch.

### F4 — Guest selection fires a burst of guaranteed-400 requests (low, systemic)

Selecting Guest triggers `GET /users/guest/preferences` (`usePianoPreferences`, and again
in `PianoFlashcards`), `GET /users/guest/preset` (`usePianoPreset`), plus per-mode 400s
(Studio list, Composer list, course playable). All are caught and warn-logged, but it's
guaranteed noise in the session logs on every guest cycle — and the *writes* are
optimistic: SoundPanel's "save default"/"favorite" buttons appear to succeed for guests
while the PUT 400s in the background (state reverts on next switch).

*Recommendation:* short-circuit the per-user hooks when
`currentUser === GUEST_PROFILE.id` (the id is statically known), and disable the preset
save affordances for guests.

### F5 — Guest can't browse Videos courses, with a misleading message (low)

`usePianoCoursePlayable(courseId, 'guest')` hits the piano endpoint, which 400s
(`invalid_user`), so `CourseDetail` renders `PianoEmpty` with the raw error (or "No
lectures found."). Contrast with the `null` user case, which cleanly falls back to the
device-level fitness endpoint. Guests get a dead end that reads like missing content.

*Recommendation:* for guest, either fall back to the device-level endpoint (watching
without credit is harmless) or show "pick a player to track course progress".

### F6 — Roster fetch is one-shot (low, robustness)

`PianoUserProvider` fetches `/api/v1/piano/users` once on mount with no retry. A
transient failure (backend restarting mid-deploy — exactly when kiosks reload) leaves
`users=[]` for the tab's lifetime: pickers render empty, chip pinned to Guest, all
per-user features dead until a manual reload.

*Recommendation:* retry with backoff, or refetch when the picker opens.

### F7 — Who's-Playing re-prompt can open over a just-launched lecture, then demote to Guest (medium)

`useIdleGap` fires on the *next input* after the gap — a `pointerdown` in capture phase.
That same tap still completes its own click. If the first tap after an idle gap is the
one that launches a video lecture (e.g. a resume tile on a course page), the fire-time
guard `if (videoActive || playing) return` passes — `videoActive` only becomes true
*after* the player mounts — so the prompt opens on top of the starting lecture. Nothing
closes `whoOpen` when `videoActive` flips true (the chip handles this via
`open={open && !locked}`; the PianoApp instance has no equivalent). 30 s later the
auto-timeout dismisses → `setCurrentUser('guest')` **mid-lesson**: the watch-log
`userId` flips to guest, per-user progress stops accruing, and the auto-history take
splits — precisely the mis-credit the chip lock was built to prevent.

*Recommendation:* in PianoApp, close the prompt silently when playback starts
(`useEffect(() => { if (videoActive || playing) setWhoOpen(false); }, …)`) — silent
close (keep the prior user), matching the chip-lock semantics, NOT a guest dismiss.

**FIXED 2026-07-27:** `useWhoPromptAutoClose` (PianoKiosk) wired into PianoShell —
closes silently on `videoActive`/`playing`, covered by hook tests.

### F8 — Stacked pickers: a chip pick can be clobbered to Guest (medium-low)

The tap that opens the chrome chip's manual picker is also a `pointerdown`, so after an
idle gap it simultaneously fires the re-prompt: two `ProfilePicker`s stack (the chip's
renders later in the DOM, so it sits on top). The user picks themselves in the chip
picker — then the underlying re-prompt is still open, doesn't mark their pick (no
`activeId`), and its ✕/backdrop/30s-timeout dismiss runs `setCurrentUser('guest')`,
silently overwriting the pick they just made.

*Recommendation:* close `whoOpen` whenever `currentUser` changes while it's open (any
pick elsewhere answers the question); that also collapses the double-modal.

**FIXED 2026-07-27:** same `useWhoPromptAutoClose` hook — closes on a player *change*
while open (opening with a player already selected does not self-dismiss).

### F9 — Re-prompt timeout doesn't extend on in-modal interaction (low)

`ProfilePicker`'s auto-dismiss timer is armed once per open; tapping page dots doesn't
reset it. On a roster large enough to paginate (7+), browsing to page 2 can eat most of
the 30 s and land the browser on a surprise guest dismiss. Cosmetic today (household
roster fits one page).

---

## Non-issues verified

- `play/log` with a guest/unknown `userId`: `UserVideoProgressStore.record()` returns
  null before touching disk — no phantom `data/users/guest/` dirs, no economy earn.
- Singalong as guest: video plays; the device-level media-memory write still provides
  resume; only per-user credit is skipped. Correct.
- Games: `currentUser` is optional by design (`user_start_levels` lookup misses for
  guest → default levels). Flashcards' per-user level pref write 400s for guests but is
  cosmetic.
- Path-safety: `safeSegment` / `isKnownUser` / `DATE_RE`/`TAKE_RE` guards on every
  user-scoped route; history is the only guest-writable surface and it's regex-locked.
- Producer attributes records to `currentUser || 'household'` — household-level storage,
  no validation needed.
- Chip lock during lectures, re-prompt suppression during video/Listen playback (at
  fire time — see F7 for the launch race), and owner-change take splitting all behave
  as documented.
- Who's-Playing modal internals: timeout uses an `onDismissRef` (never a stale
  closure); mount doesn't false-fire the idle gap (`lastRef` initialized to now);
  `whoIsPlayingMinutes` has a default (2) and is set in live config; dismiss→Guest is
  scoped to the re-prompt only (chip passes `timeoutMs={0}`, dismiss just closes);
  screen-off is two-tap armed; the chip picker self-closes when a lecture starts.

## Suggested priority

F1 (silent data loss) > F7 (mid-lesson guest demotion) > F3 (identity semantics) > F2 >
F8 > F4 > F5 > F6 > F9. F1+F2+F4 share one fix shape (a "guest can't persist here"
gate); F7+F8 share another (close `whoOpen` on playback start / on any user change).
