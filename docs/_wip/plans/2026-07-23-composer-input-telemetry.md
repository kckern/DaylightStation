# Composer Input Telemetry — Full-Fidelity Capture + Edit Correlation

**Date:** 2026-07-23
**Status:** Design approved (brainstorm), implementation in progress
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/Composer/` + reuse of `frontend/src/lib/logging/` input-telemetry infra
**Target device:** Piano tablet (Samsung SM-T590, FKB WebView, `10.0.0.245`)
**Precedent:** This is the SheetMusic sibling — see `2026-07-22-sheetmusic-input-telemetry.md`. Reuses the same recorder, drain, encode/decode, backend `channel:'input'` transport, and off-by-default + kill-switch model. This doc covers only what differs.

## Problem

Composer is already richly instrumented (`composer-editor`, `composer-input`, `composer-mode` child loggers emit the full edit→engrave→layout→caret loop). But two gaps, exactly as SheetMusic had:

1. **Nothing persists.** None of those child loggers carry `app`/`sessionLog`, so every `composer.*` event is console-only — there is no `piano-composer/` session file.
2. **No raw-input fidelity.** MIDI note-entry is `sampled` (120/min), audition `sampled` (30/min), numpad caret is `debug`, and taps aren't captured at all. You cannot reconstruct what a kid pressed, how it felt, or where the editor failed to respond.

**Goal:** capture every numpad key, every MIDI note (with velocity), every toolbar tap, AND the model edit each input produced — buffered so it costs no frames on the SM-T590 — replayable as a single interleaved input+edit stream.

## What differs from SheetMusic

Composer is a **numpad-driven notation editor**, so its primary inputs and its value are different:

| | SheetMusic | Composer |
|---|---|---|
| Primary input | MIDI follow + touch scroll | **numpad keymap** + MIDI note-entry + toolbar taps |
| Distinctive value | timing/jank during playback | **input → resulting edit** correlation (did the note land? did Write actually toggle?) |
| New recorder kinds | — | **`KEY`** (numpad), **`EDIT`** (model mutation result) |

## Reused as-is (no change)

`inputRecorder.js` ring buffer / drain / `startRecorder`/`stopRecorder` / allocation guard; `gestureCoalescer.js`; `midiTap.js` (`midiToRecord`); `decodeEvents.js` (extended, not rewritten); backend `sessionEventsFile.mjs` + `channel:'input'` routing + per-app retention. The recorder is a module singleton and only one piano mode is mounted at a time, so SheetMusic and Composer share it with no conflict.

## New / changed

### 1. Two new recorder kinds (`inputRecorder.js`)

Extend `KIND` + `KIND_NAME` (append only — existing ids 1–10 unchanged):

- **`KEY: 11` → `'key'`** — a numpad keydown. `a = intern(code)` (e.g. `Numpad5`), `b = intern(mapKind)` (`duration`/`arm`/`rest`/`dot`/`deleteBack`/`deleteAt`/`caret`/`play`).
- **`EDIT: 12` → `'edit'`** — the model edit an input produced. `a = intern(editType)` (`insert-note`/`insert-rest`/`delete`/`delete-back`/`caret`/`arm`/`dot`/`duration`/`undo`/`redo`), `b = midi note` (0 if none), `c = caret.measureIdx`, `d = intern(durationOrEmpty)`. Rich detail (dots, velocity, undo-depth) lives in the time-aligned `.jsonl` — the 4 int slots carry the replay essentials.

`decodeEvents.js` gains two cases:
- `key` → `{ t, event, code: strings[a], intent: strings[b] }`
- `edit` → `{ t, event, editType: strings[a], note: b, measure: c, duration: strings[d] }`

### 2. Header wall-clock anchor (`inputRecorder.js`) — closes SheetMusic's deferred gap

`buildHeader` currently ships `ctx` verbatim. Edit-correlation needs `.events` (perf-clock `t`) to align with the semantic `.jsonl` (ISO wall-clock). Add to the header a `t0` pair — `{ perf: performance.now(), wall: Date.now() }` — captured at `startRecorder`, so a decoder maps any record `t` to wall-clock: `wall = t0.wall + (t − t0.perf)`. (This is SheetMusic design "Open follow-up" #2, promoted because it is load-bearing here.) `Date.now()` is off-hot-path (once per session start), which is allowed.

### 3. Composer session-logged child (persists the existing semantic stream)

Create ONE session-logged child in `Composer.jsx`:
`getLogger().child({ component: 'composer', app: 'piano-composer', sessionLog: true })`
and thread it as `logger` into `EditorSurface` and `useComposerInput` (they already accept a `logger` prop / option and fall back to bare children). This alone routes the entire existing `composer.*` stream to `media/logs/piano-composer/{ts}.jsonl` — the "edit results" side of the correlation, for free, since Composer already logs edits/state/transport/autosave. Exactly one `session-log.start` per mount (the `child({sessionLog})` auto-emit); do not add a second.

### 4. Raw recorder taps (the `.events` side)

| Source | Where | Record |
|---|---|---|
| Numpad keydown | `useComposerInput.js` `onKey` (after `mapKey`) | `record(KEY, intern(code), intern(m.kind))` + a `requestAnimationFrame`-stamped `TAP` for input→paint latency |
| MIDI | new `subscribeRaw` sub in `EditorSurface` (reuse `midiToRecord`) | `record(MIDI_ON/OFF/SUSTAIN/CC, …)` — full fidelity incl. note-off/pedal, independent of the editor's parsed `subscribe` |
| Toolbar taps | `EditorSurface` buttons (undo/redo/play/songs/help/title) + `DurationPalette` (duration/dot/write/rest/delete) | `record(UI_INTENT, intern(name))` + latency `TAP` |
| Model edit | at each mutation site in `useComposerInput` (insert-note, rest, delete, delete-back, duration, dot, arm) + `EditorSurface` (undo/redo, caret) | `record(EDIT, intern(editType), note|0, measureIdx, intern(duration))` |

A tiny shared helper (`tapIntent(name)` / `recordEdit(...)`) keeps this DRY, mirroring SheetMusic's `tapIntent`.

### 5. Config gate + lifecycle + kill switch

Extract SheetMusic's `inputTelemetryEnabled(config)` into a shared `frontend/src/lib/logging/inputTelemetryGate.js` (and point ScorePlayer at it — small, low-risk) so both modes share one gate. Composer reads `config.composer?.inputTelemetry?.enabled ?? config.inputTelemetry?.enabled`. Lifecycle effect in `EditorSurface` (score is loaded there): when enabled, `startRecorder({ session, score: songId ?? 'draft', ctx: { user, t0: {...} }, send })` on mount; `stopRecorder()` on unmount. `send = makeInputSender()` — one `getLogger().info('input.header'|'input.batch', payload, {context:{app:'piano-composer', channel:'input'}})` per batch (one WS event = one backend write; no `sessionLog`). `window.__INPUT_REC__` kill switch (shared singleton).

## Storage / retention / backend

Unchanged from SheetMusic: `media/logs/piano-composer/{ts}.events` (+ sibling `.jsonl`), routed by `channel:'input'`, one `writeSync` per batch (~1/sec), 30-day per-app retention. `sessionEventsFile.mjs` already keys the file dir on `context.app`, so `piano-composer` needs no backend change beyond retention (already per-app-capable; add `piano-composer` to the 30-day set if retention is hard-coded per app — verify).

## Verification (same discipline as SheetMusic)

- Every new pure function (KEY/EDIT encode+decode, gate) unit-tested with a **production-order** test (intern after header — the class of bug the SheetMusic BLOCKER was).
- Hot-path allocation guard still green (no new alloc in `record`).
- Existing Composer tests (Composer/*.test.jsx) stay green; telemetry off by default.
- **On-tablet perf verification required before enabling in prod `piano.yml`** — deferred, same as SheetMusic. Do not enable the flag until measured on the real SM-T590.

## Open follow-ups (not in this work)

- Replay viewer: extend the (still-unbuilt) SheetMusic viewer to render `key`/`edit` lanes.
- Per-session `seq` on batches (transport-loss visibility) — still deferred.
