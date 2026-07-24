# SheetMusic Input Telemetry — Full-Fidelity Capture with DVR Replay

**Date:** 2026-07-22
**Status:** Design approved (brainstorm), not yet implemented
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` + `frontend/src/lib/logging/` + backend session-file transport
**Target device:** Piano tablet (Samsung SM-T590, FKB WebView, `10.0.0.245`)

## Problem

The sheet-music player already emits structured telemetry (`useScoreTelemetry.js` → `media/logs/piano-sheetmusic/{ts}.jsonl`), but coverage is lopsided and the behavioral layer is missing:

1. **~20 interaction events never persist.** `ScorePlayer.jsx:56` creates a second child logger *without* `app:'piano-sheetmusic', sessionLog:true`, so every `logger.info('score.transport.play' | 'score.hands' | 'score.countin.*' | 'score.focus.*' | 'score.perform.pageturn' | …)` is console-only and written nowhere. Verified: grep of all `media/logs/` for `score.transport.play` returns zero hits.
2. **No raw input stream.** Individual MIDI notes (with velocity), sustain-pedal, and every touch/tap are not captured — only aggregates and a heavily over-firing `score.playback.stall` (94% of all bytes on disk).
3. **No identity.** All 427k existing events carry only `ip`+`userAgent` in context; zero `userId`.
4. **No way to reconstruct a session** to see *where the user got frustrated* or *where the UI failed to respond as expected*.

**Goal:** capture every MIDI input, every tap, every touch, every UI intent — at full fidelity — buffered so it does not cost frames on the SM-T590, and replayable after the fact.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Fidelity goal | **Full DVR replay** — reconstruct a session frame-by-frame |
| Storage location + retention | **Same dir** (`media/logs/piano-sheetmusic/`), **30-day** retention for this app; batched writes |
| Continuous pointer movement | **Coalesced to frame rate** (~60Hz cap), recorded as a per-gesture polyline |

## Architecture

Two independent channels, so the firehose never touches the semantic pipeline:

```
                    ┌─ semantic events (unchanged) ──► emit() ──► WS topic 'logging' ──► sessionFile.mjs ──► {ts}.jsonl
ScorePlayer / MIDI ─┤
                    └─ raw inputs ──► record() ──► ring buffer ──► drain@1s ──► WS channel:'input' ──► sessionEventsFile.mjs ──► {ts}.events
```

### 1. Hot path — `frontend/src/lib/logging/inputRecorder.js` (NEW)

The recorder never calls `JSON.stringify`, `new Date()`, or `console` on the hot path. `record()` writes numeric slots into preallocated typed arrays and returns.

```
record(kind, a, b, c, d)   // enum + 5 numeric slots, zero object allocation
```

Backed by parallel typed arrays, capacity 16,384 records (~640 KB, allocated once):

| Array | Holds |
|---|---|
| `Float64Array t` | `performance.now()` — monotonic; no clock skew, no `Date` alloc |
| `Uint8Array kind` | event type enum (`MIDI_ON=1`, `MIDI_OFF=2`, `SUSTAIN=3`, `CC=4`, `TAP=5`, `TOUCH_START=6`, `TOUCH_MOVE=7`, `TOUCH_END=8`, `UI_INTENT=9`, `RENDER=10`, …) |
| `Int32Array a,b,c,d` | payload slots — note/velocity, x/y, controlId, step, etc. |

- One `record()` call = 6 array writes + an index bump. **No allocation → no GC pressure** during a chord flurry (GC pauses are the jank we're measuring, so the recorder must not create any).
- Non-numeric values (control name, score id) go through a small **string-intern table** → integer id on the hot path; the id→string map **ships in every batch** (`batch.strings`), and the decoder unions them. (The header's copy is usually empty because `startRecorder` resets the table before sending the header — names are interned later, as controls are used — so per-batch strings are what actually make names decodable.)
- The buffer is a **ring**: at capacity it wraps and overwrites oldest, incrementing a `dropped` counter surfaced in each `batch.dropped`. This counts records overwritten *before a drain read them* — at 16k capacity vs ≤1s of input it is ~always 0 in practice; it guards against a pathological input storm, not against transport loss (see below).

### 2. Drain — inside the recorder

- Runs on a **1s timer wrapped in `requestIdleCallback`** (fallback: plain `setTimeout`), so the encode cost lands in idle time, not during playback.
- Converts the numeric records since the last head into a compact batch, hands it to a buffering WS transport tagged `channel:'input'`, resets the write head.
- **Telemetry never blocks, never throws, never retries into a spiral.** Note a known gap: if the WS is down, loss happens at the *transport* layer (the ws-buffered queue sheds oldest at 500 with no counter), not in the recorder's `dropped`. Batches carry no sequence number yet, so transport-shed batches are not currently distinguishable from an idle user — a per-session `seq` is the follow-up that would close this (design "Open follow-ups").

### 3. Capture inventory — one tap point per source, no double-logging

| Source | Tap point | Captures |
|---|---|---|
| **MIDI** | `useWebMidiBLE.js:153` `subscribeRaw` (fires before parse) | note-on **with velocity**, note-off, sustain-pedal CC (`:190` path), any other CC. Velocity + pedal = where "tentative playing" is visible; neither logged today. |
| **Touch/pointer** | `pointerdown/move/up/cancel` listeners on the score scroll container, `{ passive: true }` | gesture start/move/end. **Passive is non-negotiable** — a non-passive touch listener blocks scroll compositing and would itself cause jank. Because passive lets native scroll proceed, a scroll gesture ends in `pointercancel` (not `pointerup`), so both flush. Moves are coalesced to ≤1/frame and each carries its **original sample timestamp** (slot `c`), so velocity/shape are reconstructable at decode time (the recorder's own `t` is record-time, not sample-time). |
| **UI intent** | each control handler (transport, loop, hands, tempo, mode, focus, page-turn) | **two records**: the semantic action + the raw tap that caused it. The gap between them is the responsiveness measurement. |
| **Render correlation** | existing `reportRender` (`jankProbes.js:51`) also feeds `record(RENDER,…)` | which component committed after each input, so replay shows what repainted. |

**Input→paint latency on every input record:** stamp a `requestAnimationFrame` after the handler; the delta is the felt latency. This attributes the existing anonymous `slowEvents` counter (`jankProbes.js:117`, >104ms) to the specific control that was hit. Frustration signals (repeat-taps on an unresponsive control, retry loops on a measure, rapid mode-flipping, mid-run abandonment) then fall out of the data rather than needing a bespoke detector.

### 4. Wire format — `{ts}.events` JSONL, repetition eliminated

```jsonc
// line 1 — header, context ONCE
{"h":1,"session":"2026-07-22T15-57-08","score":"...trainer-battle-music.mxl",
 "t0":"2026-07-22T15:57:08.297Z","ctx":{"ip":..,"userAgent":..,"device":"piano-tablet","user":"<id>"},
 "kinds":{"1":"midi.on","7":"touch.move",...},"strings":["loop-toggle","tempo-",...]}
// subsequent lines — batches of raw numeric tuples, t = ms offset from t0
{"b":[[12841,1,72,88,112,0],[12903,2,72,0,0,0],[13001,6,412,880,0,0]],"dropped":0}
```

- Header carries context **once**, killing the ~250 bytes/line duplication that `ingestion.mjs:119-120` currently stamps on every record (currently the dominant disk cost).
- A record costs ~25 bytes vs ~400. **A 30-minute session lands ~1–3 MB** (vs ~30–100 MB naive).

### 5. Backend — `sessionEventsFile.mjs` (NEW), sibling to `sessionFile.mjs`

- Routed by the `channel:'input'` marker in the WS frame → **bypasses the dispatcher and the semantic `.jsonl` entirely**.
- Does **not** repeat `sessionFile.mjs:75`'s per-event blocking `fs.writeSync`. Holds a `fs.createWriteStream` and lets Node's stream buffering coalesce. Frontend already batches to ~1 flush/sec ⇒ roughly **one write/sec per session**, not thousands of blocking syscalls. Also keeps Dropbox sync churn to a trickle (the dir is under `Dropbox/Apps/DaylightStation`).
- **Retention becomes per-app** instead of the global `maxAgeDays:3` (`sessionFile.mjs:20`): sheetmusic → 30 days, others unchanged. Add a **total-bytes backstop** so a runaway session can't fill the volume.

### 6. Fix the routing bug (prerequisite)

Merge `ScorePlayer.jsx:56`'s standalone logger with the session-logged one from `useScoreTelemetry.js:20` (add `app:'piano-sheetmusic', sessionLog:true`), so the ~20 currently-dropped `score.*` intent events land in the `.jsonl`. This is the semantic-side counterpart to the raw `.events` stream and makes the two files line up on replay.

### 7. Replay viewer

Route under the existing admin area. Loads a `.events` file (+ its sibling `.jsonl`) and scrubs on a timeline: MIDI notes, gestures, taps, renders on parallel lanes with a playhead; latency outliers and drop windows marked. Build **thin first** (timeline + lanes + detail pane); no fancy viz until real sessions show what's worth surfacing.

### 8. Kill switch

Recorder is **off unless `piano.yml` enables it**; toggle at runtime via `window.__INPUT_REC__`. Given the tablet's jank history (`reference_piano_jank_adaptive_power_saving`), the off-lever must exist without a deploy.

## Verification — the load-bearing claim

"Does not compromise performance" must be **measured, not asserted** (workspace rule: label device claims measured-vs-inferred).

- Before/after `perf.diagnostics` on the **actual SM-T590**, comparing `fps`, `loopLag`, `longTasks` across matched sessions (same score, same mode). Infrastructure already exists — same probes in `jankProbes.js`.
- If recording measurably moves those numbers, the design is wrong; find out on the bench, not in production.

## Tests

- Ring-buffer wrap + drop accounting
- Gesture coalescing (≤1 sample/frame; polyline shape preserved)
- String-intern table growth + id stability
- Encode/decode round-trip (numeric tuples ↔ named events)
- **Hot-path allocation assertion** — a guard so a future edit can't reintroduce `JSON.stringify`/object-alloc into `record()`
- Backend: `channel:'input'` bypasses dispatcher; stream write coalescing; per-app retention prune

## Files

**New**
- `frontend/src/lib/logging/inputRecorder.js` + `.test.js`
- `backend/src/0_system/logging/transports/sessionEventsFile.mjs`
- replay viewer (admin route) — thin

**Modified**
- `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` — merge loggers (§6); wire `record()` at UI handlers
- `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js` — MIDI tap in `subscribeRaw`
- `frontend/src/lib/logging/jankProbes.js` — `reportRender` also feeds recorder
- `backend/src/0_system/logging/ingestion.mjs` — route `channel:'input'` frames
- `backend/src/0_system/logging/transports/sessionFile.mjs` — per-app retention
- `piano.yml` (household config) — enable flag

## Privacy note

This captures a child's practice sessions in fine detail; the header carries a `user` id. Correct for the feature's purpose, but deliberate — worth a line in the school/piano privacy posture.

## Open follow-ups (not blocking)

- Raise/attribute the over-firing `score.playback.stall` threshold (94% of current disk) — separate cleanup.
- `score.load.failed` (`useScoreTelemetry.js:30`, `logLoadFailed`) is exported but never called — wire it or drop it.
- Session-end event (currently duration only inferable from ts spread).
