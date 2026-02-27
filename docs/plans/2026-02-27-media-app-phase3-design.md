# MediaApp Phase 3 Design — Device Monitoring, Casting & Cross-Device Sync

**Date:** 2026-02-27
**Requirements:** Sections 4.1–4.2, 5.1–5.2, 7.1–7.2 from `docs/roadmap/2026-02-26-media-app-requirements.md`
**Status:** Design approved

---

## Scope

Phase 3 adds three capabilities to the MediaApp:

1. **Device Monitoring** — See what's playing on every device/browser tab in real-time
2. **Casting** — Send content to registered devices (wake-if-needed)
3. **Cross-Device Sync** — Already implemented in Phase 2; verify and close out

### Pre-existing Infrastructure (no changes needed)

| Component | Location | Phase 3 Role |
|-----------|----------|-------------|
| Device REST API | `backend/src/4_api/v1/routers/device.mjs` | Device list, power, volume, load |
| WakeAndLoadService | `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Wake-before-cast flow |
| WebSocket EventBus | `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | Playback broadcast routing |
| WebSocket hooks | `frontend/src/hooks/useWebSocket.js` | Predicate-based subscriptions |
| useWakeProgress | `frontend/src/modules/Input/hooks/useWakeProgress.js` | Cast progress tracking |
| DeviceService | `backend/src/3_applications/devices/services/DeviceService.mjs` | Device registry |
| devices.yml | Household config | Capability flags |

---

## 1. Playback Broadcast System

### useMediaClientId() hook (4.2.7)

Generates a persistent 8-char hex ID stored in localStorage. Auto-generates display name from user-agent shortname (e.g. "Chrome on MacBook"). Identifies browser tabs as distinct sources.

### usePlaybackBroadcast(playerRef, identifiers) hook (4.2.1)

Reads the Player imperative handle every 5 seconds while playing, plus immediately on state change (play/pause/stop/skip). Sends `playback_state` WebSocket message:

```javascript
{
  topic: 'playback_state',
  clientId,     // from useMediaClientId (browser) or deviceId (kiosk)
  deviceId,     // from useDeviceIdentity (kiosk only, null for browser)
  contentId,
  title,
  format,       // audio, video, singalong, readalong
  position,     // seconds
  duration,     // seconds
  state,        // playing, paused, stopped
  thumbnail
}
```

No broadcast when idle. Shared by MediaApp, TVApp, OfficeApp.

### useDeviceIdentity() hook (4.2.3)

Reads `deviceId` from URL query params (injected by WakeAndLoadService when loading content onto kiosk devices). Returns `{ deviceId, isKiosk }`. Browser MediaApp: deviceId is null, isKiosk is false.

### Backend playback_state handler (4.2.8)

New `eventBus.onClientMessage` listener in `app.mjs`:
- Catches incoming `playback_state` messages
- Rebroadcasts on `playback:{clientId}` (or `playback:{deviceId}` if present)
- No mutation, pure routing

---

## 2. Device Monitor & Aggregation

### useDeviceMonitor() hook (4.2.9)

Two data sources:

1. **Registered devices**: Fetches `GET /api/v1/device` on mount. Static config, always shown.
2. **Live playback state**: Subscribes to WebSocket with predicate `msg => msg.topic?.startsWith('playback:')`. Maintains `Map<id, playbackState>` that updates on each broadcast. Entries expire after 30s of silence.

Returns `{ devices, playbackStates, isLoading }`.

**Matching**: Registered devices matched by deviceId from their broadcasts. Unmatched playbackState entries = browser clients ("also playing" cards).

**Online/offline**: Device is "online" if broadcast received in last 30s. Otherwise "offline."

---

## 3. DevicePanel & DeviceCard UI

### DevicePanel.jsx (4.2.10)

Right-edge drawer (slides from right on mobile, fixed sidebar on desktop). Consumes useDeviceMonitor().

Layout:
- Header: "Devices" title + close button
- Registered devices section (always visible, ordered by config)
- "Also Playing" divider + browser client cards (dynamic)

### DeviceCard.jsx (4.2.11)

**Registered device (full controls):**
- Name + online/offline indicator (green/gray dot)
- Now-playing: thumbnail, title, progress bar
- Transport: play/pause, skip (via device load API)
- Volume slider (via `/device/:id/volume/:level`)
- Power button (via `/device/:id/on` or `/off`)
- Cast button
- When offline/idle: grayed, only power-on active

**Browser client (read-only):**
- Auto-generated name from user-agent
- Now-playing info only (thumbnail, title, progress)
- No controls, muted styling, "Browser" badge

---

## 4. Casting System

### CastButton.jsx (5.2.1)

Small icon button appearing in:
- NowPlaying transport controls (cast current item)
- QueueItem rows (cast any queued item)
- ContentBrowser search results (cast without adding to queue)

Tap opens DevicePicker bottom sheet.

### DevicePicker.jsx (5.1.4)

Bottom sheet modal:
- Lists devices with `content_control` capability (from useDeviceMonitor)
- Each row: device name + online status + currently playing
- Offline devices tappable (auto-wake)
- Tap device triggers cast flow

### Cast Flow (5.1.1, 5.1.5, 5.1.6)

1. User taps CastButton -> DevicePicker opens
2. User selects target device
3. Frontend calls `GET /api/v1/device/:deviceId/load?open=/media&play={contentId}`
4. WakeAndLoadService handles wake-if-needed
5. useWakeProgress shows: Power -> Verify -> Prepare -> Load
6. On completion, DeviceCard updates to show new content

### ?device= URL param (5.2.3)

In useMediaUrlParams: when `?device=` present, content sent to device instead of local player. Combined with `?play=` or aliases. Example: `?hymn=198&device=living-room-tv`

---

## 5. Cross-Device Sync (Section 7)

Already implemented in Phase 2 via useMediaQueue:
- Multi-tab queue sync (7.1.1-7.1.5): media:queue WebSocket broadcasts
- Optimistic updates (7.1.6): apply local, POST, rollback on failure
- Rollback with toast (7.1.7): revert to last-known-good
- Auto-retry (7.1.8): retry after 2s
- Playback during outage (7.1.9): player only needs current item
- No duplicates (7.1.10): Node event loop serialization
- Self-echo suppression (7.1.11): mutationId matching

Phase 3 action: verify these work and mark Done in traceability doc.

---

## 6. Deferred Items to Resolve

| ID | Description | Fix |
|----|-------------|-----|
| 6.1.4 | WebSocket `queue` command | Wire contentIdResolver into WS handler scope in app.mjs |
| 6.2.2 | Content resolution for WS commands | Same scope fix enables full metadata resolve |
| 6.1.12 | URL `?shuffle=true` | Wire in URL command handler after queue load |
| 3.1.13 | Cast from search result | Now buildable with CastButton |

---

## New Files

| File | Type | Requirements |
|------|------|-------------|
| `frontend/src/hooks/media/useMediaClientId.js` | Hook | 4.2.7 |
| `frontend/src/hooks/media/usePlaybackBroadcast.js` | Hook | 4.2.1 |
| `frontend/src/hooks/media/useDeviceIdentity.js` | Hook | 4.2.3 |
| `frontend/src/hooks/media/useDeviceMonitor.js` | Hook | 4.2.9 |
| `frontend/src/modules/Media/DevicePanel.jsx` | Component | 4.2.10 |
| `frontend/src/modules/Media/DeviceCard.jsx` | Component | 4.2.11 |
| `frontend/src/modules/Media/CastButton.jsx` | Component | 5.2.1 |
| `frontend/src/modules/Media/DevicePicker.jsx` | Component | 5.1.4 |

## Modified Files

| File | Change | Requirements |
|------|--------|-------------|
| `backend/src/app.mjs` | Add playback_state handler + fix WS command scope | 4.2.8, 6.1.4, 6.2.2 |
| `frontend/src/Apps/MediaApp.jsx` | Add usePlaybackBroadcast, DevicePanel toggle, CastButton | 4.2.2, 5.2.1 |
| `frontend/src/Apps/TVApp.jsx` | Add usePlaybackBroadcast + useDeviceIdentity | 4.2.5 |
| `frontend/src/Apps/OfficeApp.jsx` | Add usePlaybackBroadcast + useDeviceIdentity | 4.2.6 |
| `frontend/src/modules/Media/NowPlaying.jsx` | Add CastButton to transport | 5.2.1 |
| `frontend/src/modules/Media/QueueItem.jsx` | Add CastButton per item | 5.1.3 |
| `frontend/src/modules/Media/ContentBrowser.jsx` | Add CastButton per result | 5.1.2 |
| `frontend/src/hooks/media/useMediaUrlParams.js` | Add ?device= param handling | 5.2.3 |
| `frontend/src/Apps/MediaApp.scss` | DevicePanel, DeviceCard, CastButton, DevicePicker styles | — |
| `docs/roadmap/2026-02-26-media-app-requirements.md` | Mark 7.1.x done, update Phase 3 status | — |
