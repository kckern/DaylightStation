# Camera Feed UI — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Summary

Upgrade the CameraFeed module with a loading skeleton, fullscreen pan/zoom viewport for the panoramic 32:9 camera feed, real-time AI detection badges, and floodlight/siren controls. All new capabilities go through DDD port interfaces — no vendor-specific code outside adapters.

## Problem

The current camera card crams a 32:9 panoramic image into a 16:9 box with black bars. There's no loading indicator (first snapshot takes ~13s). No way to zoom or pan the panoramic image. No detection status or camera controls.

## Design

### New Port Interfaces

#### `ICameraStateGateway` (`3_applications/camera/ports/`)

Polls real-time detection and motion state from the camera.

```
listDetections(cameraId) → { detections: [{ type: 'person'|'vehicle'|'animal', active: boolean }], motion: boolean }
```

No-op implementation returns `{ detections: [], motion: false }`.

#### `ICameraControlGateway` (`3_applications/camera/ports/`)

Lists and toggles camera-related controls (floodlight, siren, etc.).

```
listControls(cameraId) → [{ id: string, type: 'light'|'siren', label: string, state: 'on'|'off' }]
executeControl(cameraId, controlId, action: 'on'|'off'|'trigger') → { ok: boolean }
```

No-op implementation returns `[]` for list and `{ ok: false }` for execute.

### New Adapters

#### `ReolinkStateAdapter` (`1_adapters/camera/`)

Implements `ICameraStateGateway` by calling the Reolink HTTP API:
- Login: `POST /cgi-bin/api.cgi?cmd=Login` → get token (1-hour lease, cache it)
- Poll: `POST /cgi-bin/api.cgi?token={t}` with `[{"cmd":"GetAiState","action":0,"param":{"channel":0}}]`
- Response maps `people.alarm_state`, `vehicle.alarm_state`, `dog_cat.alarm_state` → generic detection types
- Re-login on token expiry (rspCode -6)

Token management: cache the token in-memory, refresh when it expires or returns auth error.

#### `HomeAssistantControlAdapter` (`1_adapters/camera/`)

Implements `ICameraControlGateway` using the existing HA gateway:
- Reads control entity IDs from `devices.yml` → `homeassistant` block (e.g. `floodlight: light.driveway_camera_floodlight`, `siren: siren.driveway_camera_siren`)
- `listControls` → queries HA entity states, maps to generic `{ id, type, label, state }`
- `executeControl` → calls HA service (`light.turn_on`/`light.turn_off`, `siren.turn_on`)
- Cameras without HA entities → no controls returned

### CameraService Changes

Constructor adds two optional gateways:
```
constructor({ gateway, streamAdapter, stateGateway?, controlGateway?, logger })
```

Both default to no-op if not provided. New methods:
- `getDetectionState(cameraId)` → delegates to `stateGateway`
- `listControls(cameraId)` → delegates to `controlGateway`
- `executeControl(cameraId, controlId, action)` → delegates to `controlGateway`

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/camera/:id/state` | AI detection + motion state |
| `GET` | `/api/v1/camera/:id/controls` | List available controls |
| `POST` | `/api/v1/camera/:id/controls/:controlId` | Execute a control (body: `{ action: 'on'|'off'|'trigger' }`) |

### Frontend Changes

#### Card View (default)

- **Aspect ratio:** Change container from `16/9` to native camera ratio. For the dual-lens panoramic, this is approximately `32/9`. The aspect ratio should be derived from the first loaded snapshot's `naturalWidth/naturalHeight` — not hardcoded.
- **Loading skeleton:** Before first snapshot loads, show a pulsing dark placeholder. CSS animation on the background (`#111` → `#1a1a1a` pulse). No text, no spinner.
- **AI detection badges:** Small pill badges in the top-left corner: "Person" (blue), "Vehicle" (amber), "Animal" (green). Only visible when active. Poll `GET /api/v1/camera/:id/state` every 2 seconds. Fade in/out with CSS transition.
- **Click to expand:** Clicking the image/video opens the fullscreen viewport.

#### Fullscreen Viewport (`CameraViewport.jsx`)

New component, separate file from `CameraFeed.jsx`.

**Layout:**
- Fixed overlay covering entire screen, `z-index: 9999`, dark backdrop
- Camera feed rendered inside a transform container
- Close button (top-right), zoom indicator (top-right below close), minimap (bottom-right), controls (bottom-left), hint bar (bottom-center)

**Pan/Zoom engine:**
- CSS `transform: translate(x, y) scale(z)` on the image/video element inside an `overflow: hidden` container
- State: `{ x, y, zoom }` managed in a `useReducer`
- Clamping: prevent panning beyond image bounds at current zoom level

**Input handling:**
- Mouse drag: `pointerdown` → track delta → update translate. Use `pointer` events for unified mouse+touch.
- Scroll wheel: zoom in/out centered on cursor position
- Pinch: touch zoom via pointer events + distance calculation
- Keyboard: Arrow keys pan (50px per press), +/- zoom, Home resets, Esc closes
- Double-click: toggle between fit-all (full panorama) and 2x zoom at click position
- Momentum: on pointer release, apply velocity decay for smooth coast

**Minimap:**
- Tiny full-panorama thumbnail (bottom-right)
- White rectangle shows current viewport bounds
- Click to jump viewport to that position
- Semi-transparent background, unobtrusive

**Zoom indicator:**
- Shows "1.0x", "2.0x", etc. top-right
- Fades after 2 seconds of no zoom change

**Controls hint bar:**
- Bottom center: "Drag to pan · Scroll to zoom · +/- · Double-click to reset · Esc to close"
- Fades after 3 seconds, reappears on mouse move

**AI detection badges:**
- Same as card view but larger — positioned in the overlay header area

**Camera controls (bottom-left):**
- Floodlight toggle: icon button, lit yellow when on, grey when off
- Siren button: icon button with confirmation (click once → "Confirm?" state for 3s → click again to trigger, or auto-cancel)
- Only shown if the camera has controls (`listControls` returned items)

#### File Structure

```
frontend/src/modules/CameraFeed/
├── CameraFeed.jsx            # Card view (modified — skeleton, badges, click-to-expand)
├── CameraFeed.scss           # Card styles (modified — native aspect, skeleton, badges)
├── CameraViewport.jsx        # Fullscreen pan/zoom overlay (new)
├── CameraViewport.scss       # Viewport styles (new)
├── usePanZoom.js             # Pan/zoom state + input handlers hook (new)
└── CameraControls.jsx        # Floodlight/siren controls (new)
```

### Polling Strategy

- **Snapshot:** 3s interval (existing)
- **AI detection state:** 2s interval, lightweight JSON response
- **Controls state:** Fetch once on mount, re-fetch after executing a control
- All polling stops when component unmounts (existing pattern)

## Out of Scope

- Two-way audio (requires WebRTC)
- Recording playback (NVR territory)
- Binocular stitch control
- Webhook push events (polling is sufficient)
- Bounding boxes on detections (Reolink API doesn't provide coordinates, only binary alarm states)
