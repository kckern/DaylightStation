# Piano: session identity (who's-playing) + always-on MIDI history

**Date:** 2026-06-26
**Status:** Approved (brainstormed). Two coupled features in one spec; build A first (it's the
attribution foundation), then B.

## Goal

Make piano practice credit the **right player**, and passively keep a per-player history of
everything played as `.mid` files.

1. **Who's-playing identity** — after an idle gap, re-prompt for the player so a new person's
   playing isn't silently credited to whoever sat there last. Unclaimed → **Guest**.
2. **Always-on MIDI history** — continuously capture the live MIDI stream and write segmented
   `.mid` files to `data/household/history/piano/{user}/{YYYY-MM-DD}/{HH.MM.SS}.mid`, attributed
   to the current player. Behavioral reference: `_extensions/piano/recorder/auto_midi_recorder.py`
   (silence-segmented session files) — but it must run **browser-side**, because the piano is
   Bluetooth-MIDI paired to the **tablet**, so the notes exist only in the kiosk's Web MIDI (a
   host daemon using `mido` host ports cannot see them).

Both hang off the existing per-user model (`PianoUserContext.currentUser` → `/api/v1/piano/users/{id}/...`).

---

## Feature A — Who's-playing identity re-prompt

### Components
- **`useWhoIsPlaying({ activeNotes, historyLen, timeoutMinutes, onIdleGap })`**
  (`frontend/src/modules/Piano/PianoKiosk/useWhoIsPlaying.js`) — mirrors `useInactivityReturn`'s
  idle detection (same signals: MIDI notes via `activeNotes`/`historyLen`, plus `pointerdown`/
  `keydown`). Tracks `lastActivity`. On each input it computes the gap *before* updating
  `lastActivity`; if the gap ≥ `timeoutMinutes` it fires `onIdleGap()` once per gap. Disabled when
  `timeoutMinutes <= 0`. Does **not** fire on the very first interaction after mount unless that
  interaction itself follows a ≥threshold gap from mount (a kiosk left sitting, then approached,
  *should* prompt).
- **`WhoIsPlayingPrompt`** (`.../WhoIsPlayingPrompt.jsx`) — modal overlay showing the title
  "Who's playing?" and **only the roster faces** (Guest is **never** a card in the picker). Tap a
  face → `setCurrentUser(id)` + close. **Dismiss without a selection** — the **✕**/close button,
  backdrop tap, or ~30s auto-timeout — → `setCurrentUser('guest')` + close. Rendered at `PianoShell`.
- **Guest sentinel** — `PianoUserContext` recognizes `currentUser === 'guest'` and resolves a
  synthetic `{ id: 'guest', name: 'Guest' }` profile so `PianoUserChip` renders "Guest". Guest is
  **NOT** added to the `users` roster array (so it never appears as a pick option anywhere). It is
  set only by dismissing the prompt.

### Flow
```
… playing/idle … gap ≥ who_is_playing_minutes (no MIDI, no touch)
   └─ next input (note OR touch) ─→ open "Who's playing?" (roster faces only)
          ├─ tap a face            → currentUser = that user
          └─ ✕ / backdrop / 30s    → currentUser = 'guest'
```
Guest is the **dismiss outcome**, never a pickable face — so a new player who doesn't identify
isn't silently credited to the previous (departed) player. The always-on recorder's player-change
segmentation + min-take filter (Feature B) make any brief pre-selection tail negligible.
Independent of `inactivityMinutes` (return-to-menu) and the screensaver timers; all three coexist.

### Config (`piano.yml`, per piano)
- `who_is_playing_minutes` (number; default `2`; `<= 0` disables).

---

## Feature B — Always-on MIDI history

### Capture (browser)
- **`useAutoMidiHistory({ subscribe, currentUser, config })`**
  (`frontend/src/modules/Piano/PianoKiosk/useAutoMidiHistory.js`), mounted at `PianoShell`.
  Subscribes to the live note stream via `usePianoMidi().subscribe` (the same tap
  `useStudioRecorder` uses — NOT `noteHistory`, which trims). Accumulates relative-time events
  (reuse `studioRecording.js` → `toTakeEvent`/`closeOpenNotes`/`takeDuration`).

### Segmentation — a take closes on EITHER:
1. **Silence gap** — `silence_seconds` with no notes, or
2. **Player change** — `currentUser` changes (so each file belongs to exactly one player).

On close: finalize (close held notes), do a final flush, then start fresh on the next note.

### Min-take filter
A take is buffered in memory and is **not** persisted until it reaches **`min_notes` notes**
(and, if `min_seconds` is configured, also that duration — both must hold). Below threshold →
dropped silently (no file, no backend call). Tiny accidental blips never hit disk.

### Resilience — idempotent full-state upsert (no loss, no dup, no merge)
- When a take first crosses the threshold it is assigned a **stable id = its start time**
  (`HH.MM.SS`; add a `-2`,`-3` suffix on the rare same-second collision). The id + date + user
  fix its file path for its whole life.
- While active, the take is **flushed every `flush_seconds`**: a full-state
  `PUT …/history/:date/:takeId` with the *entire* event list so far. The backend **re-encodes and
  overwrites** the file (never appends). Idempotent — retries/duplicate flushes are harmless.
- Final flush on segment-close and on unmount/`beforeunload` (best-effort).
- A reload loses at most `flush_seconds` of tail; the post-reload continuation simply becomes a
  **new** take/file (clean split — never a merge or duplicate, because ids are start-time-stable
  and writes are whole-file overwrites).

### Attribution
`currentUser` (or `guest`) captured at take **start**. A mid-take player change closes the take
(segmentation rule 2), so a file is never split across players.

### Backend
- **Endpoint** (`backend/src/4_api/v1/routers/piano.mjs`):
  `PUT /api/v1/piano/users/:userId/history/:date/:takeId`
  body `{ events, startedAt, durationMs }` → encode `.mid`, write
  `data/household/history/piano/{userId}/{date}/{takeId}.mid` (atomic, mkdir -p, overwrite).
  `:userId` accepts `guest` (path-safe slug; not validated against the roster — history is a
  catch-all, mirroring how studio takes already accept the user slug). `:date` and `:takeId` are
  slug-validated (`YYYY-MM-DD`, `HH.MM.SS[-n]`).
  *(Optional, future: `GET …/history` to browse — out of scope here; this spec only writes.)*
- **SMF encoder** (`backend/src/.../piano/midiFile.mjs`, new, pure + unit-tested): event model
  → Standard MIDI File bytes (format 0, single track): `MThd` (division = ticks/quarter, e.g.
  480) + `MTrk` with delta-time var-len, note-on/off (`0x90`/`0x80`), tempo meta (default 120bpm),
  end-of-track. Relative-ms event times → ticks via the tempo. No SMF encoder exists today, so
  this is net-new; encoding in node (not the browser) keeps the encoder testable and the browser
  light.
- **Persistence** writes under the household data path (same `data/household/...` the piano user
  store already uses).

### Config (`piano.yml`, per piano)
```yaml
auto_record:
  enabled: true          # master on/off
  silence_seconds: 25    # gap that closes a take
  min_notes: 5           # drop takes smaller than this
  min_seconds: 3         # (and/or) minimum duration
  flush_seconds: 12      # incremental full-state save cadence
```

### Relationship to the explicit Studio recorder
Untouched. Always-on is a separate **passive** store (`history/piano/...`) vs the curated Studio
takes (`/users/:id/studio`). Both run in parallel; passively logging during an explicit Studio
take is fine (different stores, no conflict).

---

## Edge cases
- **No MIDI connected** — capture simply never fires; no files. Harmless.
- **Guest playing** — files land under `history/piano/guest/…`. Fine.
- **Player change with an open take** — close + final-flush the old take (old user), open a new
  one (new user).
- **Same-second take ids** — suffix `-2`, `-3`.
- **Backend flush failure** — log + keep the in-memory events; the next flush retries the full
  state (idempotent), so a transient failure self-heals.
- **`who_is_playing_minutes` / `auto_record.enabled` absent** — feature off (safe defaults).

## Testing
- **A:** `useWhoIsPlaying` gap logic — no fire within X; fires once on resume after ≥X; MIDI and
  touch both reset; disabled at `<=0`; fires after a long mount-to-first-input gap. Prompt: pick →
  setCurrentUser; dismiss/timeout → guest. Guest sentinel selectable.
- **B:** segmentation (silence gap closes; player change closes); min-filter drops sub-threshold
  takes; flush cadence PUTs full state with a stable id; player change attributes correctly.
  Backend: SMF encoder round-trips a known event list to valid `.mid` bytes (MThd/MTrk, note
  on/off, deltas); `PUT history` writes the right path and overwrites idempotently; `guest` and
  slug validation.

## Phasing
1. **Phase A** — identity: guest sentinel, `useWhoIsPlaying`, `WhoIsPlayingPrompt`, config, wire
   into `PianoShell`. Ship + verify.
2. **Phase B** — history: SMF encoder + `PUT history` endpoint (backend, TDD), `useAutoMidiHistory`
   (capture/segment/filter/flush), config, wire into `PianoShell`. Ship + verify on the kiosk
   (files appear under `history/piano/{user}/{date}/`).

## Out of scope (future)
- Browsing/playback of the history files in the UI.
- Retention/cleanup of old history.
- Re-attributing already-written Guest takes to a real user after the fact.
