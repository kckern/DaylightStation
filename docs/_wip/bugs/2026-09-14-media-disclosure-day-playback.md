# Disclosure Day playback: session evidence

Status: reproduced in part; implementation in progress through the media redesign execution plan. No presumption that existing playback controls work end to end.

## Today's session

Structured log-store observations, September 14, Pacific time:

- 10:22:41: local session restored at position zero.
- 10:22:56: startup resilience recovery after 15 seconds.
- 10:23:01: movie ready and started; session loading → playing.
- 10:23:02.690: Play transport command; session playing → loading.
- 10:23:04: expanded Now Playing host claimed the media node.
- 10:23:17.692: session loading → stalled while render-frame events continued.
- 10:23:59: another Play command; stalled → loading.
- 10:24: movie still rendering. Renderer reported the default shader, not focused playback.

No seek or stop transport command was found in the examined Media session events. That does **not** prove the user never tried those controls. The logs establish a discrepancy between actual rendering and session state, not a complete record of physical input.

## Reproduction with real media

The new `tests/live/flow/media/media-app-playback-journey.runtime.test.mjs` searches the real catalog, clicks the actual result, opens Now Playing, and verifies an advancing HTML video element inside the DASH renderer. No synthetic click, forced click, route mock, or fabricated session state is used.

| Junction | Observation |
|---|---|
| Catalog → queue | Search result supplies title/identity but no duration or resolved video format |
| Player → session → seek UI | Real video advances; visible slider reports maximum zero, position zero and unknown length, and is disabled: **RED** |
| ±10-second controls → player | Both actual forward and backward seeking passed in the browser scenario |
| Pause/resume → player → UI | Passed including actual time advancing beyond the historical watchdog interval; a harness closure error was corrected before judging this result |
| Expand video | No accessible Expand video control: **RED** |
| Stop → retained queue | Actual playback stopped and queue reopened with the first repair slice in progress; full Stop story is not yet accepted |

## Code explanation to verify with fixes

`PlayerBridge` receives duration in the real Player progress payload but does not reconcile it into session metadata. `SeekBar` depends on session duration and disables itself when it is absent. Supplying invented duration in component tests hides that junction failure.

`LocalSessionController.transport.play` can switch an already-playing session back to loading. The bridge only marks playback started once per item, so the subsequent loading state can outlive ongoing playback and trigger the slow-start watchdog. Ordinary pause/resume passing does not disprove that repeated-Play path.

Repair must preserve the bridge-owned media element, update metadata without treating enrichment as a new playback identity, reconcile actual player state, and provide focused expansion/shrinking without restarting media. All stories retain individual acceptance criteria in the acceptance ledger.
