# Fitness Session Auto-Merge Failure — 2026-04-28

**Status:** Investigation
**Author:** Claude (auto-audit)
**Date:** 2026-04-28
**Severity:** High — single workout gets fragmented into multiple session files; per-session totals (coins, distance, HR averages) are wrong

---

## TL;DR

A single ~37-minute Kettlebell Swings workout on 2026-04-28 produced **three independent
session files** instead of one merged session. The auto-merge / resume logic in
`FitnessSession._startWithResumeCheck` did not fire, even though every precondition for
a silent auto-merge appeared to be met (same content, same day, gap of 11 / 13 seconds,
no `finalized` flag on disk). The frontend silently fell through to "start a fresh
session" each time the page reloaded or the buffer threshold was re-met.

The root cause is **not yet definitively identified** — this audit captures evidence and
narrows the suspect list. A backend-instrumented re-test is needed to confirm.

---

## Evidence

### Three session files on disk

`data/household/history/fitness/2026-04-28/`:

| File | Start | End | Duration | First content event | Coins |
|---|---|---|---|---|---|
| `20260428122815.yml` | 12:28:15.752 PT | 12:34:50.752 PT | 6m 35s | `plex:606203` Kettlebell Swings | 58 |
| `20260428123501.yml` | 12:35:01.771 PT | 12:42:16.771 PT | 7m 15s | `plex:606203` Kettlebell Swings | 88 |
| `20260428124229.yml` | 12:42:29.110 PT | 13:05:24.470 PT | 22m 55s | `plex:606203` Kettlebell Swings | 348 |

- **Total fragmented duration:** 36m 45s
- **Inter-session gaps:** 11 sec (122815→123501), 13 sec (123501→124229)
- **Same primary contentId** (`plex:606203`) on all three
- **Same primary participant** (`kckern`, HR device `40475`)
- **Coin counts restart at 0** in every session — a clean indicator they are not
  hydrated/resumed

### What the logs show

#### Session start events (frontend → backend session log)

From `media/logs/fitness/2026-04-28T19-*.jsonl`:

```
12:28:15.723Z  fs_20260428122815  reason=buffer_threshold_met  UA: Mac/Chrome
12:28:15.752Z  fs_20260428122815  reason=buffer_threshold_met  UA: Linux/Firefox
12:35:01.771Z  fs_20260428123501  reason=buffer_threshold_met  UA: Linux/Firefox
12:42:29.110Z  fs_20260428124229  reason=buffer_threshold_met  UA: Linux/Firefox
```

**No `fitness.session.resumed` events are present anywhere in the log day.** That event
only fires from `_hydrateFromSession` (`FitnessSession.js:1460`), so we know hydration
was never attempted.

#### Save failures

A burst of HTTP 502 ("Connecting…" Nginx Proxy Manager splash) happened around
19:42:05Z (12:42:05 PT). Around 12:42:29 PT — *exactly when 124229 starts* — the
backend appears to have just restarted. This may be coincidence or causally related;
worth cross-checking against deploys.

Session 122815 has 35+ minutes of `fitness.session.save_health_warning` events
(`lastSuccessfulSaveAt: 0`), but the file *did* eventually persist (file mtime
12:34 PT). So saves worked at some point.

#### Two clients running concurrently

Two browsers were on the fitness page simultaneously:

- **Mac / Chrome** (172.18.0.94, UA: `Macintosh ... Chrome/147`)
- **Linux / Firefox** (172.18.0.94, UA: `X11; Linux ... Firefox/149`)

At 12:28:15 they both produced the **same `sessionId` `fs_20260428122815`** (within
30 ms of each other). That collision is incidental to the merge bug but worth flagging
as a related race condition — see [Adjacent issue](#adjacent-issue-multi-client-session-id-collision)
below.

---

## What the merge / resume code actually does

### Frontend — `frontend/src/hooks/fitness/FitnessSession.js`

`_startWithResumeCheck(reason)` (line 1478) runs whenever a fresh session is about to
start (e.g. on `buffer_threshold_met`). It:

1. Reads `contentId` from `snapshot.mediaPlaylists.video[0]`.
2. Calls `GET /api/v1/fitness/resumable?contentId=<id>`.
3. If `{ resumable: false }` → `ensureStarted({ reason, force: true })` (fresh session).
4. If `{ resumable: true, finalized: true }` → store `_pendingResumePrompt`, fire
   `_onResumePrompt` callback (UI prompt).
5. If `{ resumable: true, finalized: false }` →
   `ensureStarted({ reason: 'resumed', force: true })` then
   `_hydrateFromSession(result.session)` — **silent auto-merge**.

`_hydrateFromSession` (line 1401) restores the prior session's `sessionId`, `startTime`,
timeline series, events, and treasure box, then pads the gap with nulls.

**Important:** the call at line 1218 is fire-and-forget (`this._startWithResumeCheck(...)`
without `await`), and line 1219 immediately reads `this.sessionId` to decide whether the
session "started." The async resume path may resolve later and overwrite `sessionId` via
`ensureStarted({ reason: 'resumed', force: true })`. If it succeeded, we'd see
`fitness.session.started` with `reason: 'resumed'`. We see only
`reason: 'buffer_threshold_met'` — so the resume path never executed step 5.

### Backend — `backend/src/3_applications/fitness/services/SessionService.mjs`

`findResumable(contentId, householdId, { maxGapMs = 30 * 60 * 1000 })` (line 319):

1. Build `today` from local date.
2. `sessions = await this.sessionStore.findByDate(today, hid)`.
3. Filter:
   - `s.finalized` truthy → reject.
   - `s.media?.primary?.contentId || s.contentId` must equal `contentId` → else reject.
   - Must have an `endTime`.
   - `(now - endTime) < maxGapMs` (30 min default) → else reject.
4. Sort by `endTime` desc, take the most recent.
5. Load full session via `getSession(...)` and return `{ resumable: true, session, finalized }`.

### Backend — `findByDate` constructs `media.primary.contentId`

`backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:260` builds
`media.primary` from, in order of preference:

1. `summary.media[*]` where `primary: true` (the V3 path — used here).
2. Longest `timeline.events[type=media]`.
3. Longest `timeline.events[type=media_start, source=video_player]`.

For all three of our YAMLs, `summary.media[0]` is set with
`contentId: plex:606203, primary: true`. So `s.media.primary.contentId` will resolve
correctly at the filter step.

### `finalized` flag — disk vs domain

- The `Session.toJSON()` method only writes `finalized` when truthy
  (`Session.mjs:292`), so absence of the field on disk = "not finalized."
- All three YAMLs have **no top-level `finalized:` field**. So the resumable filter
  `if (s.finalized) return false` should pass for all of them.

**Caveat:** there are TWO end paths on the backend:

| Path | What sets `finalized` |
|---|---|
| `POST /api/v1/fitness/sessions/:id/end` → `endSession()` → `session.end(endTime)` | **Always** sets `finalized = true` (`Session.mjs:146`) — unconditionally. |
| `POST /api/v1/fitness/sessions/:id` (`saveSession`) | Only sets `finalized` if the frontend payload included `finalized: true`. The frontend only does that when end reason is `'manual'` or `'user_initiated'` (`FitnessSession.js:2087`). |

Since none of the YAMLs have `finalized: true` on disk, **the explicit `endSession()`
endpoint was never called for these three sessions**. They were ended only by
frontend-driven saves on page unload or session-timeout — which leaves the on-disk
`finalized` falsy.

---

## Why the merge didn't fire — hypotheses

We have proof the merge didn't run, but not yet proof of *why*. Best-guess ranking:

### H1 (most likely): The resumable check ran but matched zero candidates due to a state-shape mismatch

The resumable-eligibility filter is sensitive to several derived fields. If `findByDate`
had any reason to *not* surface `media.primary.contentId` when called moments after a
save (for example, the save was in flight, or the file was incompletely flushed, or the
summary block was missing in an early save), the filter would drop the candidate
silently. The on-disk *final* state has the right shape — but the state at the moment
the next session's resumable check fires may have been different.

**To verify:** add `logger.debug('fitness.resumable.candidates', { count, sessionIds })`
inside `findResumable` filter and replay.

### H2: Backend was unreachable when the resumable check fired

`_checkResumable` swallows fetch errors and returns `{ resumable: false }` (silently
falling back to "fresh start"). The 502 storm visible in the logs around 12:42:05 PT
demonstrates the backend was sometimes unreachable today. If the resumable GET also
got a 502, we'd see no error log AND no successful match — exactly what we observe.

**Counter-argument:** the 502s don't appear at 12:35:01 (the 122815→123501 transition)
— only around 12:42:05. So this can't explain the first transition's fragmentation.

**To verify:** change `_checkResumable` to log error responses (currently it only logs
on JS-thrown errors, not on non-2xx HTTP).

### H3: Household ID mismatch

The frontend doesn't pass `household` in the query string
(`fetch('/api/v1/fitness/resumable?contentId=...')`). Backend resolves
`req.query.household` → `undefined` → `defaultHouseholdId`. If the active session was
saved under a different household than `defaultHouseholdId`, `findByDate` would scan
the wrong directory.

**Counter-argument:** the files exist at `data/household/history/fitness/2026-04-28/` —
i.e. the *default* household path — so this should be the path scanned.

### H4: The contentId lookup returned `null` at session start

`_getCurrentContentId()` reads `this.snapshot?.mediaPlaylists?.video[0]?.contentId`. If
the snapshot wasn't yet populated when `buffer_threshold_met` fired, contentId would be
`null`, and `_startWithResumeCheck` short-circuits to a fresh `ensureStarted` without
calling the backend.

**To verify:** add `logger.debug('fitness.session.resume_check', { contentId })` at the
top of `_startWithResumeCheck`.

### H5: The frontend already had a sessionId set when buffer_threshold_met re-fired

`_startWithResumeCheck`'s fresh-start branch only runs `ensureStarted` when
`!this.sessionId`. If `sessionId` is already set from a *prior* synchronous code path,
the resume hydration is no-op'd. But fresh sessions clearly *did* start (we see new
`fitness.session.started` events with new IDs), so this hypothesis would also have to
explain how the prior session-id was cleared. Less likely.

---

## What's definitely true

1. **No `fitness.session.resumed` events.** `_hydrateFromSession` was never called.
2. **Three back-to-back sessions with the same contentId got fragmented.**
3. **The on-disk `finalized` field is absent for all three.** Backend-side filter
   should not reject them on that basis.
4. **The `summary.media` block is correctly populated** with `contentId: plex:606203,
   primary: true` in all three files.
5. **All three sessions logged `reason: buffer_threshold_met`** for `fitness.session.started`
   — no `reason: resumed`.
6. **Two browsers are running concurrently on the fitness page** — both Mac/Chrome and
   Linux/Firefox emit independent session events, occasionally producing duplicate
   sessionIds.

---

## Adjacent issue: multi-client session ID collision

At 12:28:15.723 (Mac) and 12:28:15.752 (Linux), both browsers emitted
`fitness.session.started` with **identical** `sessionId: fs_20260428122815`. Session
IDs are generated from `Date.now()` at second precision; sub-second collisions are
inevitable when multiple clients are active.

This is not the cause of the merge failure but is a related correctness issue —
two clients independently writing to the same session file will race and one will lose
data. A future fix should either:
- Add a millisecond suffix to session IDs, or
- Use a backend-issued session ID (POST → returns id), or
- Disallow more than one fitness UI per household at a time.

---

## Recommended next steps (in order)

1. **Add logging at every step of the resume flow** (frontend `_startWithResumeCheck`,
   `_checkResumable`; backend `findResumable` filter). Without instrumentation we cannot
   tell H1 vs H2 vs H4 apart.
2. **Make `_checkResumable` log non-2xx HTTP responses** (currently only logs JS errors).
3. **Replay the bug.** Open Kettlebell Swings, let the session reach
   `buffer_threshold_met`, then close the tab and reopen — confirm whether the resume
   prompt fires or the session fragments again. Compare backend logs.
4. **Decide on the multi-client policy.** Two browsers on the same workout is currently
   undefined behavior; should be either supported (peer-merged) or actively rejected.
5. **Consider whether `Session.end()` should always set `finalized = true`.** Right now
   the only thing that prevents *every* explicitly-ended session from being treated as
   "user-finalized, do not merge" is that the frontend uses
   `POST /api/v1/fitness/sessions/:id` (saveSession) instead of
   `POST /api/v1/fitness/sessions/:id/end` (endSession) for non-manual ends. That coupling
   is fragile — anyone who switches the call would silently disable auto-merge.

---

## Files referenced

- `frontend/src/hooks/fitness/FitnessSession.js:1217-1555` — resume entry/decision flow
- `frontend/src/hooks/fitness/FitnessSession.js:1401-1470` — `_hydrateFromSession`
- `frontend/src/hooks/fitness/FitnessSession.js:2087` — frontend `_finalized` rule
- `backend/src/3_applications/fitness/services/SessionService.mjs:319-376` — `findResumable`
- `backend/src/3_applications/fitness/services/SessionService.mjs:288-304` — `endSession`
- `backend/src/3_applications/fitness/services/SessionService.mjs:247-280` — `saveSession`
- `backend/src/2_domains/fitness/entities/Session.mjs:140-147` — `end()` always finalizes
- `backend/src/2_domains/fitness/entities/Session.mjs:292` — `toJSON` writes `finalized` only when true
- `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:260-389` — `findByDate` constructs `media.primary`
- `backend/src/4_api/v1/routers/fitness.mjs:429-441` — `/api/v1/fitness/resumable` route
- Affected data: `data/household/history/fitness/2026-04-28/{20260428122815,20260428123501,20260428124229}.yml`
- Frontend session logs: `media/logs/fitness/2026-04-28T19-{27-57,35-00,42-22}.jsonl`

---

## Resolution (2026-04-28, later same day)

**Root cause confirmed: H4 (most likely H1 turned out to be wrong) + an additional latent bug.**

- **Active cause for these three sessions (was H4):** `updateSnapshot` (`FitnessSession.js:1716`) returns early when `!this.sessionId`, leaving `snapshot.mediaPlaylists.video` empty at buffer-threshold time. `_getCurrentContentId()` returned `null`, and `_startWithResumeCheck` short-circuited to a fresh start without ever calling the backend. Confirmed by absence of `fitness.session.resumable_check_failed` events in the session logs (the catch block would have fired if `_checkResumable` had been called).
- **Latent bug that would have fired the moment H4 was fixed in isolation:** `_checkResumable` called `DaylightAPI.get(url)` (`FitnessSession.js:1389`) but `DaylightAPI` (`frontend/src/lib/api.mjs:11`) is a function, not an object — the call would always throw `TypeError`.

Both fixed via plan `docs/_wip/plans/2026-04-28-fitness-session-merge-fix.md`. Phase D adds `setPendingContentId(id)` (FitnessSession.js) which the FitnessContext useEffect feeds from the play-queue head, so the resume check has a contentId to work with even before the session starts. Phase B fixes the typo. Phase C adds structured logs at every decision point (`fitness.resumable.check.{start,candidates,match,no_match}` on the backend; `fitness.session.resume_check.{start,no_content,result,finalized_prompt,auto_resume}` on the frontend) so future failures are diagnosable from logs alone.

The three fragmented sessions from this incident were merged via a one-shot CLI script `cli/merge-fitness-sessions.cli.mjs` (Phase A) — final session is `data/household/history/fitness/2026-04-28/20260428124229.yml`, ~37 min, 494 coins.

### Side findings (not addressed in this plan, worth tracking)

- **`POST /api/v1/fitness/sessions/merge` produces a corrupt merged YAML.** The endpoint is what we tried to use first for Phase A; we abandoned it because (a) it doesn't update the `session.start/end` strings on the merged file, and (b) it doesn't recompute the `summary` block (per-participant coins/HR/zones, total coins, buckets). The CLI workaround at `cli/merge-fitness-sessions.cli.mjs` does both correctly. The endpoint should either be fixed (with a real summary recomputation step) or removed.

- **Multi-client session-id collision is still open.** Two browsers on the same fitness page within the same second produce identical session IDs (`Date.now()` truncated to seconds) and race to write the same file. Tracked as a separate concern.

- **`Session.end()` always sets `finalized = true`** (`Session.mjs:146`), but only on the explicit `POST /sessions/:id/end` route — not on the `saveSession` route the frontend currently uses. This coupling is fragile: if anyone switches to the explicit end-session call, every session will be marked `finalized` and auto-merge will silently break for everyone.
