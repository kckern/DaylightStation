# Live Camera Feed

IP camera integration with live HLS streaming, snapshot warmup sequence, and detection overlays. Supports Reolink cameras via the Reolink HTTP API and RTSP/HLS transcoding.

**Depends on:** Camera devices in `devices.yml`, auth credentials in `data/household/auth/reolink.yml`

---

## How It Fits

```
Reolink Camera (IP network)
       │
       │  HTTPS /cgi-bin/api.cgi (snapshots)
       │  RTSP rtsp://host/h264Preview_01_sub (live)
       ▼
ReolinkCameraAdapter (backend adapter)
       │  Discovers cameras from devices.yml
       │  Fetches snapshots, proxies streams
       ▼
Camera API (Express router)
       │  /api/v1/camera/*
       ▼
CameraRenderer (frontend component)
       │  Warmup: snapshot → blur/deblur → HLS crossfade
       ▼
┌──────────────┬──────────────────┐
│  HomeApp     │  Screen/Kiosk    │
│  (interactive│  (passive        │
│   pan, full- │   display)       │
│   screen)    │                  │
└──────────────┴──────────────────┘
```

---

## Camera Configuration

Cameras are declared in `data/household/config/devices.yml` with `type: ip-camera`.

```yaml
driveway-camera:
  type: ip-camera
  manufacturer: Reolink
  model: F760P
  host: <camera-host>
  auth_ref: reolink          # references data/household/auth/reolink.yml
  streams:
    main:
      url: rtsp://{username}:{password}@<camera-host>/h264Preview_01_main
      resolution: 4K
    sub:
      url: rtsp://{username}:{password}@<camera-host>/h264Preview_01_sub
      resolution: 640x480
  homeassistant:              # optional HA entity mappings
    camera: camera.driveway_camera_fluent
    motion: binary_sensor.driveway_camera_motion
    person: binary_sensor.driveway_camera_person
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | Must be `ip-camera` for the adapter to discover it |
| `host` | yes | Camera IP address |
| `auth_ref` | yes | Key into `data/household/auth/` for username/password |
| `streams` | no | RTSP stream URLs with `{username}`/`{password}` placeholders |
| `homeassistant` | no | HA entity IDs for detection state polling |
| `manufacturer` | no | For display purposes |
| `model` | no | For display purposes |

### Auth File

`data/household/auth/reolink.yml`:
```yaml
username: admin
password: <camera-admin-password>
```

All cameras sharing the same credentials use the same `auth_ref`.

---

## API Endpoints

All under `/api/v1/camera/`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/camera` | GET | List all discovered cameras (no credentials exposed) |
| `/camera/:id/snap` | GET | Fetch a live JPEG snapshot from the camera |
| `/camera/:id/live/stream.m3u8` | GET | HLS playlist for live stream (starts transcoding) |
| `/camera/:id/live` | DELETE | Stop the live stream transcoding session |
| `/camera/:id/state` | GET | Detection state (motion, person, vehicle, animal) |
| `/camera/:id/clips?day=YYYY-MM-DD` | GET | The day's recorded clips: `{camera, day, clips: [{start, end, name, labels}]}`, ascending (404 unknown camera, 400 bad `day`, 503 when no clip library is wired) |
| `/camera/:id/clips/file?name=…` | GET | One recorded clip as range-aware MP4, `Cache-Control: private, max-age=3600` (404 unknown camera, 400 missing or bad name, 503 when no clip library is wired, 502 `{error: 'Clip unavailable'}` when the camera fetch fails) |

### Recorded Clips

`CameraClipLibrary` (`__app_modules/household/camera/server/adapters/`) answers both
clip routes behind the `ICameraClipLibrary` port:

- **List.** Ledger records (`CameraLedgerStore`, `camera-archive` `storage.ledgerPaths`)
  that carry a `clip.name`. A ledger that cannot be read (a torn final line while the
  ledger job is mid-append) logs `camera.clips.ledger_unreadable` and is treated as
  empty, never a 500. When the ledger has none for the day (today, before the
  nightly ledger job), it searches the camera itself (the archive plan's camera-side
  source) and caches that answer for 2 minutes per camera and day; expired entries
  are evicted on each new search. A failed search logs `camera.clips.search_failed`
  and returns `[]`, never an error.
- **File.** The name must be a recorder path (`[/mnt/sdX/]Mp4Record/YYYY-MM-DD/<file>.mp4`)
  and the camera id a slug. The clip is downloaded once into `/tmp/camera-clips/<camera>/`
  (via a `.part` file, so an interrupted download is never served; a second viewer of the
  same clip waits on the first download). Someone is waiting on that download, so it
  uses the library's **interactive** policy — give up after 30 s with no data and retry
  once (`INTERACTIVE_CLIP_DOWNLOAD`; `createCameraServices({ clipDownloadPolicy })`
  overrides it) — not the archive job's 300 s idle / 4 retries with backoff, which
  suits an unattended backfill. After each download the directory is pruned:
  `.part` files older than an hour that no download is writing are swept, and the cache
  keeps the 40 most recently **used** clips (a cache hit touches the file, so pruning is
  LRU, not FIFO). Later requests are served from disk with Express range handling; a
  seek or a closed player aborting the transfer is not logged as a fault.
- A camera that is not in the `camera-archive` plan, or missing NVR credentials, has no
  clip source: lists come back empty and file requests answer 502
  (`camera.clips.source_unavailable` is logged).

Events: `camera.clips.listed` (debug, `{camera, day, source, count}`),
`camera.clips.fetched` (info, `{camera, name, bytes}`), `camera.clips.search_failed`,
`camera.clips.ledger_unreadable`, `camera.clips.source_unavailable`,
`camera.clips.fetch_failed`, `camera.clips.send_failed` (warn).

The `/home` dashboard's doorbell drawer is the consumer: it matches each ring to the
nearest clip edge within 120 s, and a clip it cannot load reads "Recording could not
be loaded" with a Retry (see [home/README.md](home/README.md)).

### Snapshot Parameters

| Param | Type | Description |
|-------|------|-------------|
| `width` | number | Requested snapshot width (camera may ignore) |
| `height` | number | Requested snapshot height |
| `t` | number | Cache-bust timestamp |

### Camera List Response

```json
{
  "cameras": [
    {
      "id": "driveway-camera",
      "host": "<camera-host>",
      "manufacturer": "Reolink",
      "model": "F760P",
      "capabilities": ["snapshot", "live"],
      "streams": ["main", "sub"],
      "homeassistant": { ... }
    }
  ]
}
```

---

## Rendering Flow

All camera displays use the same rendering sequence via `CameraRenderer`:

```
1. Loading skeleton
       │
       ▼
2. Fetch snapshot (/snap)
       │
       ▼
3. Warmup animation (3s)
   blur(8px) grayscale → sharp color
       │
       ▼
4. Start HLS stream in background
       │
       ▼
5. Crossfade snapshot → live video (0.8s)
       │
       ▼
6. Live stream with detection badges
```

This sequence runs automatically on mount. There is no manual "live" toggle — cameras always warm up to live.

---

## Frontend Components

### CameraRenderer

The shared core component used by all camera displays.

**Location:** `frontend/src/modules/CameraFeed/CameraRenderer.jsx`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `cameraId` | string | required | Camera ID from devices.yml |
| `crop` | boolean | `true` | 16:9 aspect ratio with `object-fit: cover` |
| `interactive` | boolean | `false` | Enables click-to-center and drag-to-pan |
| `onError` | function | — | Error callback |

**When `crop` is true:** The feed is forced to 16:9. Images/video that don't match are cropped with `object-fit: cover`. The visible region can be panned when `interactive` is enabled.

**When `interactive` is true:**
- Click anywhere to center on that point (animated, 0.3s ease-out)
- Drag to pan the cropped region (instant, no animation)
- Only effective when `crop` is also true (uncropped feeds have nothing to pan)

### CameraFeed

HomeApp card wrapper. Adds the fullscreen button (rendered in the card header via `renderHeader` prop) and viewport overlay.

**Location:** `frontend/src/modules/CameraFeed/CameraFeed.jsx`

**Usage:**
```jsx
<CameraFeed
  cameraId="doorbell"
  renderHeader={(onFullscreen) => (
    <div className="header">
      <span>Doorbell</span>
      <button onClick={onFullscreen}>Fullscreen</button>
    </div>
  )}
/>
```

### CameraOverlay

Screen framework widget for kiosk/signage displays. Non-interactive — no buttons, no pan.

**Location:** `frontend/src/modules/CameraFeed/CameraOverlay.jsx`
**Widget name:** `camera` (registered in `screen-framework/widgets/builtins.js`)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `dismiss` | function | — | Overlay dismiss callback (from screen framework) |
| `crop` | boolean | `true` | 16:9 crop or uncropped contain |

Fetches the camera list on mount and renders the first available camera.

### CameraViewport

Fullscreen pan/zoom overlay. Opened from CameraFeed's fullscreen button.

**Location:** `frontend/src/modules/CameraFeed/CameraViewport.jsx`

Features: drag-to-pan, scroll-to-zoom, minimap, keyboard shortcuts (arrows, +/-, Esc), camera controls (floodlight, siren if available).

---

## Shared Hooks

| Hook | Location | Returns | Description |
|------|----------|---------|-------------|
| `useSnapshotFetch` | `useSnapshotFetch.js` | `{ src, loading, error, naturalSize, onImgLoad }` | Single snapshot fetch with blob URL lifecycle |
| `useHlsStream` | `useHlsStream.js` | `{ ready, videoSize }` | HLS stream via hls.js with auto-cleanup |
| `useDetections` | `useDetections.js` | `detections[]` | Polls detection state every 2s |

All three hooks accept `(cameraId, logger)` — pass `null` for `cameraId` to disable.

---

## Backend Architecture

### ReolinkCameraAdapter

**Location:** `__backend/src/1_adapters/camera/ReolinkCameraAdapter.mjs`
**Layer:** Adapter (DDD layer 1)

Discovers cameras from `devices.yml` at startup. Provides:

| Method | Description |
|--------|-------------|
| `listCameras()` | All cameras without credentials (safe for API) |
| `getCamera(id)` | Full camera object including credentials (internal) |
| `getStreamUrl(id, streamName)` | RTSP URL for a stream |
| `fetchSnapshot(id, { width, height })` | Live JPEG from the camera's HTTP API |

Snapshots use the Reolink `/cgi-bin/api.cgi?cmd=Snap` endpoint over HTTPS with `rejectUnauthorized: false` (self-signed certs). Timeout is 30s.

---

## Detection Badges

When Home Assistant entities are configured in `homeassistant` block, the backend polls HA for detection state. Active detections render as colored badges on the feed:

| Type | Color |
|------|-------|
| Person | Blue |
| Vehicle | Amber |
| Animal | Green |
| Motion | — (no badge, used for triggers) |

---

## Adding a New Camera

1. Add the device to `data/household/config/devices.yml` with `type: ip-camera`
2. Ensure the `auth_ref` file exists in `data/household/auth/`
3. Restart the backend (or Docker container) to trigger discovery
4. The camera appears automatically on the Home page and in the camera API

Required network access from the backend:
- HTTPS port 443 (snapshots)
- RTSP port 554 (live streams, if using HLS)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Camera unavailable" | Can't reach camera on port 443 | Check `curl -sk https://{host}/cgi-bin/api.cgi?cmd=GetDevInfo` |
| Snapshot loads but no live | RTSP port 554 closed | Enable RTSP in camera settings |
| Snapshot takes 30-40s | Camera returning full-res 4K image | Request smaller size via `width`/`height` params |
| Camera not in list | `type` not set to `ip-camera` | Check devices.yml spelling |
| Auth failure | Wrong credentials | Check `data/household/auth/{auth_ref}.yml` |
