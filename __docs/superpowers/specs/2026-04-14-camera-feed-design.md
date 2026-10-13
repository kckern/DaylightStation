# Camera Feed — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Summary

Add a camera feed system that proxies IP camera snapshots and live video streams through the backend, serving them over clean HTTP URLs. Cameras are discovered dynamically from `devices.yml` (any device with `type: ip-camera`). The frontend gets a reusable `CameraFeed` module; HomeApp is the first consumer.

## Problem

The Reolink driveway camera exposes RTSP streams and an HTTPS snapshot endpoint, both requiring credentials. Browsers cannot play RTSP natively, and exposing camera credentials to the frontend is unacceptable. We need the backend to broker access and transcode RTSP to a browser-playable format.

## Design

### Backend

#### Camera Adapter (`__backend/src/1_adapters/camera/`)

**`ReolinkCameraAdapter.mjs`** — handles communication with Reolink IP cameras.

Responsibilities:
- Discover all `type: ip-camera` devices from `devices.yml` at startup
- Resolve credentials via `auth_ref` (reads e.g. `data/household/auth/reolink.yml`)
- Interpolate `{username}` and `{password}` placeholders in stream URLs from `devices.yml`
- **Snapshot:** Fetch a JPEG from the camera's CGI endpoint (`https://{host}/cgi-bin/api.cgi?cmd=Snap&channel=0&user={username}&password={password}`). Self-signed TLS cert — use `rejectUnauthorized: false` for the fetch.
- **Live stream management:** Spawn/kill ffmpeg processes for RTSP→HLS transcoding on demand.

**`HlsStreamManager.mjs`** — manages ffmpeg lifecycle for live streams.

Responsibilities:
- Spawn ffmpeg when a client requests a live stream for a camera
- ffmpeg command: RTSP input → HLS output (`.m3u8` playlist + `.ts` segments) written to a temp directory
- Track last access time per stream; kill ffmpeg after inactivity timeout (30s of no segment requests)
- Clean up temp segment files on stream stop
- One ffmpeg process per camera — multiple clients share the same HLS output
- Use the **sub stream** (`h264Preview_01_sub`, 640x480) for live view to keep CPU/bandwidth reasonable. The main 4K stream is for recording, not live viewing.

ffmpeg invocation (approximate):
```
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@host/h264Preview_01_sub \
  -c:v copy -c:a aac -f hls \
  -hls_time 2 -hls_list_size 3 -hls_flags delete_segments+append_list \
  /tmp/camera/{id}/stream.m3u8
```

Key flags:
- `-c:v copy` — no video re-encoding, just repackaging (minimal CPU)
- `-hls_time 2` — 2-second segments for low latency
- `-hls_list_size 3` — keep only 3 segments in the playlist (rolling window)
- `-hls_flags delete_segments` — auto-delete old `.ts` files
- `-rtsp_transport tcp` — TCP for reliability over LAN

**`index.mjs`** — factory function `createCameraAdapter()` that reads config and returns the adapter.

#### No ProxyService

The existing `ProxyService` is designed for stateless HTTP passthrough. Camera streaming has stateful lifecycle (spawn/kill ffmpeg, track viewers, manage temp files). A standalone adapter with its own routes is the right fit.

#### API Routes (`__backend/src/4_api/v1/routers/camera.mjs`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/camera` | List available cameras (id, name, capabilities) |
| `GET` | `/api/v1/camera/:id/snap` | Proxy a live snapshot JPEG from the camera |
| `GET` | `/api/v1/camera/:id/live/stream.m3u8` | HLS playlist — starts ffmpeg if not running |
| `GET` | `/api/v1/camera/:id/live/:segment.ts` | Serve HLS `.ts` segment files |
| `DELETE` | `/api/v1/camera/:id/live` | Stop a live stream (kill ffmpeg, cleanup) |

The `stream.m3u8` endpoint is the trigger: first request spawns ffmpeg, subsequent requests serve the playlist file. The inactivity timer resets on every segment request. If no segments are fetched for 30s, ffmpeg is killed and temp files are cleaned.

**Snapshot response headers:**
- `Content-Type: image/jpeg`
- `Cache-Control: no-cache` (always fresh)

**HLS response headers:**
- `.m3u8`: `Content-Type: application/vnd.apple.mpegurl`, `Cache-Control: no-cache`
- `.ts`: `Content-Type: video/mp2t`, `Cache-Control: public, max-age=60`

#### Error handling

- Camera unreachable (snapshot timeout): return 502 with `{ error: 'Camera unreachable', cameraId }`
- ffmpeg crashes: detect via `child_process` exit event, clean up, next request will re-spawn
- Invalid camera ID: return 404

### Frontend

#### `CameraFeed` Module (`frontend/src/modules/CameraFeed/`)

**`CameraFeed.jsx`** — reusable component.

```jsx
<CameraFeed cameraId="driveway-camera" mode="snapshot" />
<CameraFeed cameraId="driveway-camera" mode="live" />
```

Props:
- `cameraId` (string, required) — matches device ID from `devices.yml`
- `mode` (`'snapshot'` | `'live'`, default `'snapshot'`) — display mode
- `interval` (number, default `3000`) — snapshot polling interval in ms (snapshot mode only)
- `onError` (function, optional) — error callback

**Snapshot mode:**
- Renders an `<img>` tag
- Polls `GET /api/v1/camera/:id/snap` on the configured interval
- Appends `?t={timestamp}` cache-buster to each request
- Shows last successful frame if a poll fails (don't flash blank)

**Live mode:**
- Renders a `<video>` tag
- Uses `hls.js` to load `GET /api/v1/camera/:id/live/stream.m3u8`
- hls.js handles segment fetching, buffering, and playback
- On unmount, optionally calls `DELETE /api/v1/camera/:id/live` to stop the stream immediately rather than waiting for the inactivity timeout

**`CameraFeed.scss`** — minimal styling, aspect ratio container.

#### `hls.js` dependency

hls.js is the standard HLS player library for browsers. It will be added as an npm dependency. Safari supports HLS natively; hls.js handles all other browsers.

#### HomeApp Integration

HomeApp will:
1. Fetch `GET /api/v1/camera` to discover available cameras
2. Render a `<CameraFeed>` for each camera, defaulting to snapshot mode
3. Provide a toggle/button to switch to live mode per camera

### Data Flow

```
Snapshot:
  Browser <img> → GET /api/v1/camera/:id/snap → Backend fetch → Reolink HTTPS → JPEG → pipe to response

Live:
  Browser <video> + hls.js → GET /api/v1/camera/:id/live/stream.m3u8
    → Backend checks: ffmpeg running?
      No  → spawn ffmpeg (RTSP → HLS segments in /tmp/camera/:id/)
      Yes → serve .m3u8 from disk
    → hls.js requests .ts segments → served from /tmp/camera/:id/
    → No requests for 30s → kill ffmpeg, delete temp files
```

### File Structure

```
__backend/src/1_adapters/camera/
├── ReolinkCameraAdapter.mjs    # Camera communication (snapshot, stream URLs, auth)
├── HlsStreamManager.mjs       # ffmpeg lifecycle (spawn, kill, cleanup)
└── index.mjs                  # Factory + exports

__backend/src/4_api/v1/routers/
└── camera.mjs                 # Express router

frontend/src/modules/CameraFeed/
├── CameraFeed.jsx             # Reusable component (snapshot + live modes)
└── CameraFeed.scss            # Styles
```

### Camera Discovery

Cameras are any device in `devices.yml` with `type: ip-camera`. The adapter reads the device config at startup and builds a registry:

```yaml
# From devices.yml — already defined
driveway-camera:
  type: ip-camera
  host: 10.0.0.56
  auth_ref: reolink
  streams:
    main:
      url: rtsp://{username}:{password}@10.0.0.56/h264Preview_01_main
    sub:
      url: rtsp://{username}:{password}@10.0.0.56/h264Preview_01_sub
```

Adding a new camera is just adding another `type: ip-camera` entry to `devices.yml`. No code changes.

## Out of Scope

- Motion detection / alerts (handled by Home Assistant)
- Recording / NVR (handled by Frigate if added later)
- PTZ control
- Audio from snapshot mode
- Multi-camera grid layout (future HomeApp enhancement)
