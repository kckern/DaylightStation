# Pose Detector Runtime

How the Fitness app runs BlazePose: which backend, how many threads, how the
model is switched, and the HTTP headers the thread pool depends on.

For what happens to the keypoints afterwards, see `semantic-pose-pipeline.md`.

## Related code

- `__app_modules/wellness/fitness/browser/domain/pose/PoseDetectorService.js` — the singleton service
- `__app_modules/wellness/fitness/browser/context/PoseContext.jsx` — React provider around it
- `__backend/src/app.mjs` — global middleware that sends the isolation headers on every response (prod)
- `frontend/vite.config.js` — `server.headers`, the same pair in dev
- `frontend/scripts/prepare-public-assets.mjs` — copies the `.wasm` binaries into `frontend/public/`

---

## Backend and threads

The service prefers the `wasm` backend on Firefox (the garage kiosk) and
`webgl` elsewhere, falling back through `webgl → wasm → cpu`.

TF.js WASM ships three binaries and picks one at init:

| Binary | Used when |
|--------|-----------|
| `tfjs-backend-wasm.wasm` | no SIMD |
| `tfjs-backend-wasm-simd.wasm` | SIMD, page **not** cross-origin isolated |
| `tfjs-backend-wasm-threaded-simd.wasm` | SIMD and `self.crossOriginIsolated === true` |

All three are copied from the npm package into `frontend/public/` by the
frontend `prebuild` hook, land at the root of `frontend/dist/`, and are loaded
same-origin through `setWasmPaths('/')`. The pthread worker script is not a
file: TF.js 4.x inlines it and starts workers from a `blob:` URL, so there is
no `*.worker.js` to serve.

Thread count is the `wasmThreads` service option:

- `'auto'` (default) — half the logical cores, capped at 8
- a positive integer — that many, capped at the core count

TF.js's own default is one thread per logical core, which oversubscribes a
machine that is also decoding video. The count is only applied when the page is
isolated; otherwise the single-threaded binary loads whatever the option says.

Measured on the garage box (16 cores, Firefox, one still frame, 2026-11-11):

| Backend | `full` | `lite` |
|---------|--------|--------|
| webgl | 85 ms | 69 ms |
| wasm, 1 thread | 66 ms | 20 ms |
| wasm, 8 threads | 15 ms | 12 ms |

### What to look for in the logs

`pose_detector.backend_selected` is emitted at init and on every backend switch:

| Field | Meaning |
|-------|---------|
| `backend` | `wasm` / `webgl` / `cpu` |
| `crossOriginIsolated` | whether the page got isolation |
| `threads` | what the thread pool actually reports after init (`null` off wasm) |
| `requestedThreads` | what the service asked for |
| `hardwareConcurrency`, `isSecureContext`, `modelType`, `reason` | context |

`pose_detector.wasm_single_threaded` (warn) fires when the wasm backend comes
up on a page that is not isolated. Pose still works, at roughly a third of the
speed. The usual causes:

- the page was not served by this backend or the Vite dev server — e.g. a
  static file server or proxy that does not send the two headers. This is what
  happened in the Skyline Invaders garage spike on 2026-11-11: the build was
  served from a localhost proxy without the headers, pose ran single-threaded
  (~13 fps), and that number was briefly mistaken for the kiosk's
- the page was reached over plain `http://` on a non-localhost host — browsers
  ignore COOP/COEP outside a secure context

---

## Cross-origin isolation

Threads need `SharedArrayBuffer`, which browsers only expose to a page served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

### Where the headers are set

The backend sends the pair on **every** response from a global middleware in
`__backend/src/app.mjs` (since 2026-03), and the Vite dev server sends the same
pair through `server.headers`. Every app's document is therefore isolated,
Fitness included; there is no per-app switch.

Verify on prod with `curl -sI https://<host>/fitness | grep -i cross-origin`.

A 2026-11 change that narrowed the headers to `/fitness` behind a flag was
written and then dropped before shipping: it bought Fitness nothing (it was
already isolated) and would have removed isolation from every other app.

### What isolation changes for the page

`credentialless` was chosen over `require-corp` because it does not require
other origins to opt in: cross-origin images, video, audio, fonts, scripts and
styles still load, they are just requested without cookies.

| Resource in the Fitness app | Origin | Effect |
|-----------------------------|--------|--------|
| Plex thumbnails, stills, video, audio (`/api/v1/display/*`, `/api/v1/proxy/*`) | same origin | none |
| Session recap video, sound cues, sprites, tiles (`/api/v1/proxy/media/*`, `/vendor/*`) | same origin | none |
| WebSocket (`/ws`) | same origin | none; COEP does not apply to WebSockets |
| TF.js `.wasm` and blob workers | same origin / blob | none; blob workers inherit the page's policy |
| BlazePose model weights (TF Hub / Kaggle CDN) | cross origin, CORS `fetch` | none; CORS requests are exempt |
| Google Fonts stylesheet + font files | cross origin | none; public, sent without credentials anyway |
| OpenStreetMap tiles in the session map | cross origin `<img>` | none; public tiles, loaded without cookies |
| Strava activity link | cross origin, plain link | opens normally; the new tab gets no `window.opener` |
| HR simulator popup (`/sim-panel.html`) | same origin | keeps `window.opener` because it carries the same headers as the app |
| Service worker (`/sw.js`) | same origin | none; when offline it can serve the last cached shell document with whatever headers that copy had |

Things that **would** break, and do not exist in the Fitness app today:

- a cross-origin `<iframe>` (YouTube, a third-party embed). Firefox blocks it
  unless that origin sends COEP itself; Chrome also accepts the
  `credentialless` iframe attribute. The Player's `webview` renderer is an
  iframe — do not route webview content through the Fitness app.
- a Worker or AudioWorklet loaded from a **URL** rather than a blob needs a
  COEP header on its own script response. Today every worker and worklet in
  the frontend is a blob.
- an OAuth popup that has to call back through `window.opener`.

Add any of these and the embed has to come from the same origin (or send its
own COEP), since the headers are global.

---

## Switching the model

`updateConfig({ modelType })` — `lite`, `full` or `heavy` — replaces the live
detector:

1. inference is paused (the animation loop keeps ticking and skips frames)
2. an inference already running is allowed to finish
3. the old detector is disposed
4. the new model is built and warmed up
5. `pose_detector.model_switched` is logged with `from`, `to`, `durationMs`

Rules the service holds:

- **One detector alive.** Builds are serialized; a burst of switches ends on
  the last model asked for.
- **A switch during the first load is applied**, not dropped
  (`pose_detector.model_switch_deferred`, then `model_switched` with
  `reason: changed_during_load`).
- **A failed switch falls back** to the previous model
  (`pose_detector.model_switch_failed`, `pose_detector.model_switch_reverted`).
- **Metrics tell the truth.** `modelType` in metrics and `getState()` is the
  model the live detector was built with; `requestedModelType` is what config
  asks for.
- **The singleton applies options.** `getPoseDetectorService(options)` on an
  existing instance rebinds callbacks and pushes config keys through
  `updateConfig`.

Before 2026-11 a switch built a second detector without disposing the first,
and a switch made while the first model was loading changed the reported model
type only — which is why `lite` once measured the same as `full`.
