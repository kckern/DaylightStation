# PIP Overlay Design

Generic picture-in-picture overlay system for the screen framework. Primary use case: doorbell rings, camera shows PIP feed of who is at the door. Designed to support future PIP content (live maps, notifications, etc.).

---

## Scope

- **In scope:** PipManager provider, state machine, configurable position/size/margin/timeout, promote-to-fullscreen, escape chain integration, subscription system integration, action system integration, screen YAML config, camera PIP via existing CameraOverlay, backend webhook endpoint for HA doorbell events, WebSocket broadcast
- **Out of scope:** Two-way audio, interactive PIP controls, non-kiosk PIP UX (HomeApp etc.), HA automation YAML (user configures HA side)

---

## State Machine

```
                  ┌──────────────────────────┐
                  │                          │
        show()    ▼         dismiss()        │  show() while visible
  IDLE ────────► VISIBLE ──────────────► IDLE │  (resets timer, updates
                  │                          │   content if different)
                  │ promote()                │
                  ▼                          │
              FULLSCREEN ──────────────► IDLE
                         dismiss()
```

### States

| State | Description |
|-------|-------------|
| IDLE | No PIP showing. PIP container not rendered. |
| VISIBLE | PIP rendered in configured corner. Dismiss timer running. Input actions routed to PIP (promote, dismiss). |
| FULLSCREEN | PIP content promoted to fullscreen overlay via existing `showOverlay('fullscreen')`. PIP container hidden. Dismissing fullscreen returns to IDLE (not back to PIP). |

### Transitions

| From | Event | To | Side Effects |
|------|-------|----|-------------|
| IDLE | `show(component, props, config)` | VISIBLE | Start dismiss timer, render PIP, animate in |
| VISIBLE | `show(...)` | VISIBLE | Reset dismiss timer, update content if changed |
| VISIBLE | `dismiss()` | IDLE | Clear timer, animate out |
| VISIBLE | `promote()` | FULLSCREEN | Clear PIP timer, show fullscreen overlay |
| VISIBLE | timer expires | IDLE | Animate out |
| FULLSCREEN | `dismiss()` | IDLE | Dismiss fullscreen overlay |

---

## Architecture

### PipManager Provider

**New file:** `frontend/src/screen-framework/pip/PipManager.jsx`

Provider component in the existing hierarchy:

```
ScreenOverlayProvider
  └── PipManager              ← NEW
        └── ScreenProvider
              └── PanelRenderer
```

PipManager sits between ScreenOverlayProvider and ScreenProvider. It needs `useScreenOverlay()` for promote-to-fullscreen and must be available to ScreenSubscriptionHandler and ScreenActionHandler.

### Context API

```javascript
usePip() → {
  show(Component, props, config),  // Show PIP with content
  dismiss(),                        // Dismiss PIP
  promote(),                        // Promote PIP to fullscreen
  state,                            // 'idle' | 'visible' | 'fullscreen'
  hasPip,                           // boolean shorthand
}
```

### Config Shape

```javascript
{
  position: 'bottom-right',   // top-right | top-left | bottom-right | bottom-left
  size: 25,                    // percentage of screen width (default 25)
  margin: 16,                  // pixels from screen edge (default 16)
  timeout: 30,                 // auto-dismiss seconds (0 = no auto-dismiss)
}
```

### Rendering

PipManager renders its own absolutely-positioned container with configurable sizing via CSS custom properties. It replaces the current `screen-overlay--pip` rendering path in ScreenOverlayProvider. The overlay provider's `pip` state becomes unused.

Animations: CSS transitions on the container — slide-in from the nearest edge on show, slide-out on dismiss.

---

## Configuration

### Screen-Level Defaults (YAML)

Per-screen PIP defaults in the screen config:

```yaml
pip:
  position: bottom-right
  size: 25
  margin: 16
```

### Subscription-Level Overrides

Subscriptions can override per-screen defaults:

```yaml
subscriptions:
  doorbell:
    on:
      event: ring
    response:
      overlay: camera
      mode: pip
      pip:
        position: bottom-right
        size: 25
        margin: 16
        timeout: 30
    dismiss:
      event: answered
      inactivity: 30
```

The `response.pip` block is optional — screen-level defaults apply if omitted.

### Input Bindings

```yaml
actions:
  pip:
    promote: Enter
    dismiss: Escape
```

If `actions.pip` is not configured, promote has no binding (PIP is dismiss-only via escape chain or timeout).

---

## Integration Points

### 1. Subscription System

`useScreenSubscriptions` currently calls `showOverlay()` for all modes. When `mode: pip`, it calls `pip.show()` instead.

When `mode: pip`, the subscription handler defers dismiss lifecycle to PipManager — it skips its own inactivity timer and lets PipManager own the timeout. The existing `dismiss.event` handling still works (subscription handler calls `pip.dismiss()` on the dismiss event). Repeated trigger events (second doorbell ring) reset PipManager's dismiss timer.

The subscription message from the backend:

```json
{
  "topic": "doorbell",
  "event": "ring",
  "cameraId": "doorbell-camera"
}
```

Message data is spread into component props, so CameraOverlay receives `cameraId` directly.

### 2. Action System

Two new actions in ScreenActionHandler:

| Action | Effect |
|--------|--------|
| `pip:promote` | Calls `pip.promote()` — PIP content goes fullscreen (only when `pip.state === 'visible'`) |
| `pip:dismiss` | Calls `pip.dismiss()` |

### 3. Escape Chain

PIP gets priority in the escape chain:

```
escape pressed
  → pip visible?           → dismiss pip, STOP
  → escape interceptor?    → let it handle (MenuStack etc.), STOP if handled
  → shader active?         → clear shader, STOP
  → overlay active?        → dismiss overlay, STOP
  → idle fallback          → reload (if configured)
```

If a fullscreen overlay AND PIP are both visible, escape dismisses PIP first. Second escape dismisses the fullscreen overlay.

---

## Camera Integration

### CameraOverlay Tweak

`CameraOverlay` currently fetches the camera list and renders the first available camera. Small change: if `cameraId` is passed as a prop, use it directly instead of fetching the list. This allows the doorbell subscription to target a specific camera.

### Promote-to-Fullscreen

When the user promotes PIP, PipManager calls:

```javascript
showOverlay(CameraViewport, { cameraId }, { mode: 'fullscreen' })
```

This reuses the existing fullscreen viewport with full pan/zoom/controls. PIP disappears, CameraViewport takes over. Escape from CameraViewport returns to IDLE (no PIP restoration).

---

## WebSocket Integration

### Backend: Webhook Endpoint

New route in the camera or HA router that receives doorbell events from Home Assistant and broadcasts them to WebSocket clients.

**Endpoint:** `POST /api/v1/camera/:id/event`

```json
// Request body from HA automation
{
  "event": "ring"
}
```

**Handler logic:**
1. Validate `cameraId` exists in device config
2. Broadcast via `broadcastEvent`:
   ```javascript
   broadcastEvent('doorbell', {
     event: 'ring',
     cameraId: req.params.id,
     timestamp: Date.now()
   })
   ```

This follows the existing pattern used by media queue updates (`backend/src/4_api/v1/routers/media.mjs` calls `broadcastEvent`).

### HA Automation (User-Configured)

The user configures an HA automation to POST to the webhook when the doorbell rings:

```yaml
# HA automation (out of scope — user configures this)
trigger:
  - platform: state
    entity_id: binary_sensor.doorbell_press
    to: "on"
action:
  - service: rest_command.daylight_doorbell
    data:
      camera_id: doorbell-camera
```

### Topic Naming

The WebSocket topic is `doorbell` (matching the subscription config key). This is a dedicated topic — not namespaced under `ha:` — because it's a first-class screen framework event, not a raw HA state change.

### Frontend Subscription Flow

```
HA automation → POST /api/v1/camera/doorbell-camera/event
  → broadcastEvent('doorbell', { event: 'ring', cameraId: 'doorbell-camera' })
    → WebSocket clients subscribed to 'doorbell' topic
      → useScreenSubscriptions matches topic + event
        → pip.show(CameraOverlay, { cameraId: 'doorbell-camera' }, pipConfig)
```

---

## Doorbell Example (Complete Config)

```yaml
# Screen config: data/household/screens/office.yml
pip:
  position: bottom-right
  size: 25
  margin: 16

subscriptions:
  doorbell:
    on:
      event: ring
    response:
      overlay: camera
      mode: pip
      pip:
        timeout: 30
    dismiss:
      event: answered
      inactivity: 30

actions:
  pip:
    promote: Enter
    dismiss: Escape
```

Backend sends `{ topic: "doorbell", event: "ring", cameraId: "doorbell-camera" }` via WebSocket. PIP appears in bottom-right corner showing the doorbell camera feed. Auto-dismisses after 30 seconds of inactivity. User can press Enter to promote to fullscreen CameraViewport, or Escape to dismiss early.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `frontend/src/screen-framework/pip/PipManager.jsx` | **NEW** — Provider, state machine, context, rendering |
| `frontend/src/screen-framework/pip/PipManager.css` | **NEW** — PIP container positioning, sizing, animations |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Insert PipManager into provider hierarchy |
| `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js` | Route `mode: pip` to PipManager instead of overlay provider |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Add `pip:promote` and `pip:dismiss` action handlers, update escape chain |
| `frontend/src/modules/CameraFeed/CameraOverlay.jsx` | Accept optional `cameraId` prop to skip camera list fetch |
| `frontend/src/screen-framework/overlays/ScreenOverlayProvider.css` | Remove hardcoded pip styles (moved to PipManager.css) |
| `backend/src/4_api/v1/routers/camera.mjs` | Add `POST /:id/event` webhook endpoint for HA doorbell events |
