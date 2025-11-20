# Player Hooks Overview

```mermaid
graph TD
  A[Player.jsx\n(main component)] -->|renders SinglePlayer and injects\nplay/queue metadata + resilience options| B[useCommonMediaController.js]
  B -->|invokes useMediaResilience({\ngetMediaEl, meta, seconds,\nhints, handlers })| C[useMediaResilience.js]
  C -->|subscribes via usePlaybackHealth({\nseconds, getMediaEl, hints })| D[usePlaybackHealth.js]
  D -->|progressToken,\nlastProgressAt,\nelementSignals,\nframeInfo| C
  C -->|overlayProps,\nrecovery controller,\nstatus callbacks| B
  B -->|controller transport,\nonController/onMediaRef\ncallbacks| A
  C -->|triggerRecovery() -> handleResilienceReload\n-> hardReset()/seek intents| B
  B -->|media lifecycle events,\ngetMediaEl() implementation| D
```

This diagram highlights the control and data flow across the player stack:

1. `Player.jsx` decides whether to render `SinglePlayer` and hands down playback metadata and resilience hooks.
2. `useCommonMediaController.js` owns DOM access, transport APIs, and wires `useMediaResilience` into playback state.
3. `useMediaResilience.js` orchestrates overlays and recovery logic, relying on `usePlaybackHealth` for telemetry.
4. `usePlaybackHealth.js` listens to media events and frame metrics, emitting progress tokens that bubble back up so resilience can reset timers and detect stalls accurately.
