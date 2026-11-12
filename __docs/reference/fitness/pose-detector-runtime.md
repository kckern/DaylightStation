# Pose Detector Runtime

How the Fitness app runs BlazePose: which backend, how many threads, how the
model is switched, and the HTTP headers the thread pool depends on.

For what happens to the keypoints afterwards, see `semantic-pose-pipeline.md`.

## Related code

- `__app_modules/wellness/fitness/browser/domain/pose/PoseDetectorService.js` — the singleton service
- `__app_modules/wellness/fitness/browser/context/PoseContext.jsx` — React provider around it
- `shared/contracts/crossOriginIsolation.mjs` — the isolation policy (paths, flag, env)
- `__backend/src/4_api/middleware/platformHttp.mjs` — `createCrossOriginIsolationMiddleware` (prod)
- `frontend/vite.config.js` — `crossOriginIsolationPlugin` (dev mirror)
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

- the flag is off (see below)
- the page was reached over plain `http://` — browsers ignore COOP/COEP outside
  a secure context
- the document was not loaded at a `/fitness` URL: isolation is decided by the
  headers of the **document**, so arriving by an in-app route change from
  another app's page does not isolate it; a reload at `/fitness` does

---

## Cross-origin isolation

Threads need `SharedArrayBuffer`, which browsers only expose to a page served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

### Where the headers are set

The SPA serves one `index.html` for every route, so the **request path** is the
only thing that tells a Fitness document from any other. The middleware runs
first in the Express stack and adds the pair to responses whose path is, or
sits beneath, an isolated path. By default:

| Path | Why |
|------|-----|
| `/fitness` | the app |
| `/sim-panel.html` | the HR simulator popup. It drives the app through `window.opener`, and a popup keeps its opener only if its COOP and COEP match the opener's |

Matching is by whole path segment: `/fitness/menu/1` matches, `/fitnessx` and
`/api/v1/fitness` do not. No other app's document, no `/api/*` response and no
static asset carries the headers.

Until 2026-11 the same two headers were sent on every response from the
backend. They were narrowed to the paths above so other apps can embed
cross-origin iframes again and are not cut off from popups they open.

The Vite dev server applies the same policy from the same module, so a page
that is isolated in prod is isolated in dev.

### Turning it off

The flag lives in the fitness household config and defaults to **on**:

```yaml
# household/fitness/config.yml
cross_origin_isolation:
  enabled: false        # default true; only an explicit false turns it off
  # paths:              # optional; replaces the default list
  #   - /fitness
  #   - /sim-panel.html
```

The policy is read on every request, so no rebuild or restart is needed —
reload the app config and then reload the kiosk page:

```bash
curl -X POST 'http://localhost:{env.ports.app}/api/v1/system/reload?app=fitness'
```

With the flag off the Fitness app runs exactly as before, minus threads: TF.js
loads the single-threaded SIMD binary.

`DAYLIGHT_CROSS_ORIGIN_ISOLATION=off` (also `0`, `false`, `no`, `disabled`) in
the environment overrides the config in both the backend and the Vite dev
server. It is read at request time by the backend but needs a process restart
to change, so prefer the config flag.

The backend logs the resolved policy once at boot as
`http.cross_origin_isolation.configured` (`enabled`, `paths`, `source`).

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
| HR simulator popup (`/sim-panel.html`) | same origin | needs the same headers, which is why it is in the path list |
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

Add any of these and either the embed has to come from the same origin, or the
path list / flag has to change.

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
