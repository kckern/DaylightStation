# Camera Renderer Consolidation

**Date:** 2026-04-17
**Status:** Approved

## Problem

Camera rendering logic is duplicated across three components:
- `CameraFeed.jsx` (HomeApp cards) — SnapshotPoller + HlsPlayer, no warmup
- `CameraViewport.jsx` (fullscreen overlay) — inline snapshot fetch + HLS setup + warmup sequence
- `CameraOverlay.jsx` (kiosk/signage) — thin wrapper around CameraViewport

The warmup sequence (thumbnail fade-in → live crossfade) only exists in CameraViewport. It should be the standard rendering flow everywhere.

## Design

### CameraRenderer — Shared Core

A single component that handles the universal camera rendering flow:

```
snapshot fetch → blur/sharp fade-in → HLS start → crossfade to live
```

**Props:**

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `cameraId` | `string` | required | Camera ID |
| `crop` | `boolean` | `true` | `true` = 16:9 + `object-fit: cover`, `false` = uncropped `contain` |
| `interactive` | `boolean` | `false` | Enables click-to-center, drag-to-pan, mini-nav, fullscreen button |
| `onError` | `function` | — | Error callback |
| `onFullscreen` | `function` | — | Fullscreen button click (only when `interactive`) |

**Rendering flow (always, all contexts):**

1. Fetch snapshot from `/api/v1/camera/{id}/snap`
2. Render with blur→sharp warmup animation (reuse `camera-warmup` keyframes from CameraViewport.scss)
3. Start HLS stream in background via `useHlsStream`
4. When HLS is playing, crossfade from snapshot to live video (opacity transition)
5. Detection badges overlay (polled every 2s)

**When `interactive` is true (HomeApp):**
- Click on the feed sets `objectPosition` to center on click point
- Drag-to-pan via pointer capture updates `objectPosition`
- Mini-nav thumbnail in bottom-right (only when aspect ratio differs from 16:9 by >5%)
- Fullscreen button in top-right (calls `onFullscreen`)

**When `interactive` is false (kiosk):**
- No pointer handlers, no buttons, no mini-nav
- Pure display: warmup → live → badges

### Extracted Hooks

**`useSnapshotFetch(cameraId, logger)`**
Returns `{ src, loading, error, naturalSize }`.
- Fetches a single snapshot on mount (not polling — live stream replaces it)
- Manages blob URL lifecycle (create/revoke)
- Tracks `naturalWidth`/`naturalHeight` from the loaded image

**`useHlsStream(cameraId, videoRef, logger)`**
Returns `{ ready, videoSize }`.
- Creates hls.js instance, loads source, attaches to video element
- Handles native HLS fallback (Safari)
- Cleans up: destroys hls.js, DELETEs `/api/v1/camera/{id}/live`
- `ready` flips true on first `playing` event
- `videoSize` set from `loadedmetadata`

**`useDetections(cameraId, logger)`**
Returns `detections[]`.
- Polls `/api/v1/camera/{id}/state` every 2s
- Currently duplicated in CameraFeed and CameraOverlay

### Consumer Changes

**HomeApp (`HomeApp.jsx`):**
- Remove `liveCameras` state and `toggleLive` handler
- Remove "Live" button from card header
- Render `<CameraFeed cameraId={cam.id} />` (no `mode` prop)

**CameraFeed (`CameraFeed.jsx`):**
- Becomes a thin wrapper: detection polling + viewport toggle + `<CameraRenderer interactive crop />`
- Remove `SnapshotPoller` and `HlsPlayer` inner components
- Remove `MiniNav` and `FullscreenButton` (move into CameraRenderer)
- Keep viewport open/close state and `<CameraViewport>` portal

**CameraOverlay (`CameraOverlay.jsx`):**
- Fetch camera list, pick first camera
- Render `<CameraRenderer cameraId={cam.id} crop={config.crop ?? true} />`
- Remove duplicated detection polling (CameraRenderer handles it)
- `dismiss` prop wired to overlay system (unchanged)

**CameraViewport (`CameraViewport.jsx`):**
- Keeps its own pan/zoom system (`usePanZoom`) and fullscreen chrome (close button, hints, minimap, controls)
- Replaces inline snapshot fetch with `useSnapshotFetch` hook
- Replaces inline HLS setup with `useHlsStream` hook
- Warmup animation CSS shared with CameraRenderer

### File Structure

```
frontend/src/modules/CameraFeed/
  CameraRenderer.jsx      # NEW — shared core (warmup + live + badges + interactive)
  CameraRenderer.scss     # NEW — warmup animation, crop/contain, interactive chrome
  CameraFeed.jsx          # Simplified — wrapper for HomeApp (viewport toggle)
  CameraFeed.scss         # Simplified — card-level styles only
  CameraOverlay.jsx       # Simplified — kiosk wrapper
  CameraViewport.jsx      # Uses extracted hooks, keeps pan/zoom
  CameraViewport.scss     # Unchanged
  CameraControls.jsx      # Unchanged
  usePanZoom.js            # Unchanged
  useSnapshotFetch.js      # NEW — extracted hook
  useHlsStream.js          # NEW — extracted hook
  useDetections.js         # NEW — extracted hook
```

### CSS

**CameraRenderer.scss** absorbs from CameraFeed.scss:
- 16:9 aspect ratio + `object-fit: cover` (when `crop`)
- Warmup animation keyframes (from CameraViewport.scss `camera-warmup`)
- Preview/live crossfade classes
- Fullscreen button styles
- Mini-nav styles
- Detection badge styles
- Skeleton/error states

**CameraFeed.scss** retains only:
- Card-level layout (used by HomeApp grid)

### Interaction: Click-to-Center and Drag-to-Pan

When `interactive` and `crop` are both true:
- **Click:** Convert click position to `objectPosition` percentage, set it
- **Drag:** On pointerdown, capture pointer. On pointermove, compute delta as percentage of container dimensions, update `objectPosition`. On pointerup, release.
- **Mini-nav:** Shows full uncropped thumbnail. Viewport rectangle shows visible area. Drag mini-nav to pan (existing behavior, moved from CameraFeed).

These handlers are only attached when `interactive={true}`.

### What Does NOT Change

- Backend `ReolinkCameraAdapter` — unchanged
- API endpoints (`/camera`, `/camera/:id/snap`, `/camera/:id/live/*`, `/camera/:id/state`) — unchanged
- `CameraControls.jsx` — unchanged (floodlight/siren, only in Viewport)
- `usePanZoom.js` — unchanged (only used by Viewport)
- Screen framework widget registry — still registers `CameraOverlay` as `'camera'`
- HomeApp route, grid layout — unchanged (just removes Live button)
