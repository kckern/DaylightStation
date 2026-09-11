# Piano game jank: the protocol session was syncing every frame

**Date:** 2026-09-11
**Status:** trigger fixed; kernel amplifier still open (see "Still open")
**Surfaces:** side-scroller, hero, space-invaders (and any game whose score or
metrics move continuously)

This supersedes the device-level theories in
`2026-02-28-piano-jank-cpu-contention.md` and
`2026-06-23-piano-kiosk-jank-paint-bound.md` **for in-game jank**. Those
described the *idle aged page*. This is a different defect that only fires
while a game runs, and it is not device-specific.

## Symptom

From `perf.diagnostics` in the log store, piano tablet (SM-T590), 2026-09-11:

| | idle kiosk | during a side-scroller run |
|---|---|---|
| fps | 59.8 | 33.8 decaying to 3.6 |
| long-task occupancy (totalMs / wall-clock) | 1–2% | **90–140%** |
| single longest task | 0–104 ms | 234 ms growing to **1512 ms** |
| loopLag.curMs | 0–3 | 1650–2087 |
| domNodes / heap | flat | **flat** |

It recovers to 59.8 fps the instant the game ends. The MacBook shows the same
shape (120 fps → 12.5 fps, 98% occupancy), so this is not thermal, not the
Android WebView, and not the idle-page rAF throttle.

Flat DOM and flat heap alongside growing long tasks rules out a render storm or
a leak. High `loopLag` with low fps is, per `jankProbes.js`, main-thread
saturation — the probe was built to make exactly this call.

## Root cause

`usePianoRunSession` keyed its sync effect on
`JSON.stringify({ phase, score, metrics })`. The side-scroller's score advances
every rAF frame (`score += scrollSpeed * dt * 10`); Hero's `elapsed_ms` advances
every millisecond. So the key changed **every frame**, and the effect dispatched
a `piano.run.sync` command into the event-sourced session ~60×/second.

`GameSessionCoordinator.dispatch` calls `#recoverSnapshot` on **every** dispatch,
which:

- `journal.read()` → `structuredClone` of the entire journal (one entry per
  frame so far),
- replays every record through `runtime.dispatch`,
- `stableHash`es each record's events twice to verify no divergence.

That is O(n) per dispatch where n is frames elapsed — O(n²) per run.

Measured against the real kernel in node (no React, no DOM, M-series Mac):

| dispatch # | cost of that dispatch | cumulative CPU |
|---|---|---|
| 3 | 0.7 ms | 3 ms |
| 60 | 6.4 ms | 180 ms |
| 300 | 91.4 ms | 10.0 s |
| 600 | 349.6 ms | **72.2 s** |

600 frames is ten seconds of play at 60 fps. It cost 72 seconds of CPU.

The rule module (`pianoRunRuleModule`) keeps only the **latest** sync — no
history — and `usePianoRunSession` returns nothing, so every one of those
intermediate commits was overwritten without ever being read.

It also ran tabs out of memory. From prod, 2026-09-08:

```
piano.game.protocol-sync-failed
  "Failed to execute 'structuredClone' on 'Window': Data cannot be cloned, out of memory."
  gameId: space-invaders, phase: PLAYING
```

## Fix

`usePianoRunSession` now syncs on **phase transitions only**, carrying whatever
score and metrics stand at that moment. A run commits ~4 times (IDLE →
STARTING → PLAYING → GAME_OVER) instead of thousands, which is what the
protocol session is for: the run's lifecycle and its final result.

`logger` moved to the same ref and out of the dep array — a caller passing an
unmemoized logger would otherwise have reintroduced per-frame dispatch through
the back door. (The test fixture did exactly that, which is how it was caught.)

Regression tests in `usePianoRunSession.test.js` pin both halves: 120 renders
that move only score and metrics must produce no dispatch, and a phase change
must carry the values standing at that moment.

## Still open

`GameSessionCoordinator.dispatch` re-reads, deep-clones and fully replays the
whole journal on **every** dispatch. With the trigger fixed, n per piano run is
~4, so it no longer matters in practice — but it is O(n) per dispatch for every
gaming surface on this kernel, and any future high-command-rate session hits the
same wall.

The verification is deliberate (journal checksums, snapshot-divergence
detection), so moving it is a contract decision, not a cleanup: the candidate
change is to verify on `#load` — first touch of a session — rather than on every
dispatch. For `createEphemeralLocalAuthority` the per-dispatch replay is
provably redundant (in-process `Map`s that nothing else can write). Needs a call
on whether persistent/remote coordinators keep per-dispatch verification.

## Telemetry gap noticed

`reportRender` is wired only into `NoteWaterfall` and `PianoKeyboard`, so
`data.renders.*` is blank for every game component — the side-scroller's own
render cost is invisible in `perf.diagnostics`. It was not the cause here, but
the next in-game perf question will want it.
