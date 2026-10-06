# Ordinary aimed Play/Add — outcome bottleneck brief

## Verdict

The suspected user-facing false-success bug is **partly refuted**. `DispatchProvider` does set internal `status:'success'` on `GET /device/:id/load` `res.ok`, but `DispatchProgressTray` renders that unresolved phase as **“Sent to <screen>”**, not playing; only a later `playback:confirmed` step renders **“Playing on <screen>”**. The immediate search notices likewise say **“Casting…”** / **“Adding… to queue”**, so transport wording is not itself an actual-play claim.

Two real outcome bugs remain. First, remote Add loses its verb: `buildDispatchUrl` sends `queue=<id>` without `op=add`, while `WebSocketContentAdapter` and Wake-and-Load both default a missing op to `play-now`; an aimed Add can therefore replace/start instead of append. Second, Play confirmation is unsafe: `WakeAndLoadService.#armPlaybackWatchdog` listens to global `playback.log` and accepts content ID alone, so the same title playing on another target/session/owner can produce “Playing on <screen>”. The F2 browser-control test does not close either gap: it directly sends `queue:add` through `clientControlCorrelator`, asserts no native player, and never exercises ordinary UI → `/load` → outcome tray. Also, `WebSocketContentAdapter` only broadcasts and returns; `useExternalControl` listens on identity-routed `client-control:*`, so that adapter→hook chain is not proven by composition merely because both exist.

## Smallest coherent packet (six files)

1. `frontend/src/modules/Media/cast/dispatchUrl.js` — carry an explicit canonical op (`play-now` or `add`) across `/load`; never infer Add from the `queue` key.
2. `frontend/src/modules/Media/cast/DispatchProvider.jsx` — retain the attempt verb and treat HTTP success as delivered/sent; accept a typed receiver outcome containing command, target, content, session and owner identity.
3. `frontend/src/modules/Media/cast/dispatchReducer.js` — preserve that identity and distinct `sent`, Play-confirmed/unconfirmed, and Add-confirmed/failed phases.
4. `frontend/src/modules/Media/cast/DispatchProgressTray.jsx` — Play may say “Playing…” only after correlated receiver state; Add says “Added <item> to <screen> · <position/count>” and never “Playing”.
5. `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — replace the global content-only watchdog for ordinary dispatch with the existing command ack plus target `device-state`/`playback_state` observation: require matching dispatch/command ID and target, then owner/session/content; Play requires target `playing`, Add requires the target queue mutation while current playback identity stays unchanged. Ack alone remains “Sent”, never playing.
6. `tests/live/flow/media/media-app-browser-control.runtime.test.mjs` — extend the real two-page WS/bus/ingress fixture with the ordinary `/load` composition and normal Play/Add UI, then inspect the receiver’s real local controller and native media node.

## Behavioral REDs and acceptance route

- Play: HTTP 200 plus matching ack stays “Sent”; wrong-target, wrong-owner/session, or same-content foreign playback cannot confirm; only the target’s matching post-command playing state plus an advancing native `<video>/<audio>` yields “Playing…” and may start the PLACE.2a aim exemption.
- Add: normal aimed Add reaches the receiver as `op:add`, increases that session’s queue at the reported position, preserves the exact playing native node/source/advancement, and never emits a playing confirmation for the added item.
- Missing matching receiver state ends as the persistent RELY.3a “may not have started”/retry outcome; no fabricated ack or injected state counts as native proof.

This packet unlocks `PLACE.2a/AC6`, `PLAY.1a/AC1–AC3`, remote parity for `PLAY.6a/AC1–AC3`, and `RELY.1a/AC1`, `RELY.2a/AC1–AC2`, `RELY.3a/AC1–AC4` (with R46’s observable timing/copy discipline). It supplies the actual-send premise needed by `PLACE.2a/AC4`; the two-hour clock behavior still needs its separate receiver-backed journey.

## Transport follow-up evidence

`SinglePlayer` now uses canonical content identity to resolve `/play` transport metadata before renderer selection, while identity-less direct embeds retain the direct-media path. `SinglePlayer.transport`, `api.streamId`, and `api.mintLog` passed: **3 files, 12 tests**. The live native readiness probe still fails: the visible video did not reach `readyState >= 2` and `currentTime > 0` within 30 seconds, so the ordinary UI/native journey is not yet accepted.
