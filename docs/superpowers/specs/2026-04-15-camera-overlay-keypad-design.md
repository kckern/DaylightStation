# Camera Overlay Keypad Trigger — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Summary

Add a generic `overlay` keyboard function to the screen framework, register CameraFeed as a screen overlay widget, and map the office keypad spade button to trigger it. This enables any registered widget to be shown as a fullscreen overlay via a keyboard button — camera is the first use case.

## Problem

The office keypad's spade button (key `n`) currently queues a Plex item. We want it to open a fullscreen camera live feed on the office screen instead. The screen framework has an overlay system (used by the piano visualizer via WS subscriptions) but no way to trigger overlays from keyboard buttons.

## Design

### 1. Generic `overlay` keyboard function

**File:** `frontend/src/screen-framework/input/actionMap.js`

Add to the ACTION_MAP:
```javascript
overlay: (params) => ({ action: 'display:overlay', payload: { overlayId: params } })
```

This translates `function: overlay, params: camera` in the keyboard config into an ActionBus event that any screen can handle.

### 2. Screen action handler for `display:overlay`

**File:** `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`

Add handler that resolves the widget from the registry and shows it as a fullscreen overlay:
- Look up `payload.overlayId` in the widget registry
- Call `showOverlay(Component, { dismiss }, { mode: 'fullscreen' })`
- If widget not found, log a warning and do nothing

### 3. Camera overlay widget wrapper

**File:** `frontend/src/modules/CameraFeed/CameraOverlay.jsx` (new)

Thin wrapper around the existing CameraFeed module adapted for the overlay system:
- Receives `dismiss` prop from the overlay provider
- Renders CameraFeed in live mode for the default camera (or configurable via props)
- Fullscreen layout — fills the overlay container
- Uses the existing CameraViewport pan/zoom UX (the overlay IS the viewport — no need for a card-then-expand flow)
- Fetches camera list from API, uses the first camera (or a configured default)

### 4. Register in widget registry

**File:** `frontend/src/screen-framework/widgets/builtins.js`

```javascript
import CameraOverlay from '../../modules/CameraFeed/CameraOverlay.jsx';
registry.register('camera', CameraOverlay);
```

### 5. Keyboard config change

**File:** `data/household/config/keyboard.yml` (in container)

Change the spade button from:
```yaml
- key: 'n'
  label: spade
  function: queue
  params: '622894'
```

To:
```yaml
- key: 'n'
  label: camera
  function: overlay
  params: camera
```

### Dismissal

The escape/back button (key 4, `function: escape`) already calls `dismissOverlay()` in the ScreenActionHandler. No additional work needed — pressing back closes the camera overlay.

## Out of Scope

- Camera selection UI (hardcoded to first/default camera for now)
- Living room TV integration (office screen only for now)
- Keyboard config UI (YAML edit only)
