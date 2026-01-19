# TV/Player Codebase Reference

**Last Updated:** January 2026

---

## Directory Structure

```
frontend/src/
├── Apps/
│   └── TVApp.jsx                  # TV app entry, menu root
├── modules/
│   ├── Menu/
│   │   ├── TVMenu.jsx             # Menu component
│   │   ├── MenuItems.jsx          # Menu item renderer
│   │   └── Menu.scss              # Menu styles
│   └── Player/
│       ├── Player.jsx             # Main player container
│       ├── SinglePlayer.jsx       # Media type router
│       ├── AudioPlayer.jsx        # Audio playback
│       ├── VideoPlayer.jsx        # Video/DASH playback
│       ├── PlayerOverlayLoading.jsx  # Unified overlay
│       ├── hooks/
│       │   ├── useCommonMediaController.js  # Shared media controls
│       │   ├── useMediaResilience.js        # Stall recovery, overlay state
│       │   ├── useShaderDiagnostics.js      # Dimension logging
│       │   └── useImageUpscaleBlur.js       # Blur filter for images
│       └── lib/
│           └── mediaDiagnostics.js          # Shared diagnostic utilities
└── lib/
    └── logging/                   # Frontend logging framework
        ├── index.js               # Logger factory
        ├── Logger.js              # Singleton instance
        ├── errorHandlers.js       # Global error capture
        └── consoleInterceptor.js  # Console interception
```

---

## Key Files

### Player Components

| File | Purpose |
|------|---------|
| `modules/Player/Player.jsx` | Main player container, creates resilienceBridge, manages playback state |
| `modules/Player/SinglePlayer.jsx` | Routes to AudioPlayer or VideoPlayer based on media type, connects resilienceBridge |
| `modules/Player/AudioPlayer.jsx` | Audio playback with blackout shader, album art display |
| `modules/Player/VideoPlayer.jsx` | Video/DASH playback using dash.js |
| `modules/Player/PlayerOverlayLoading.jsx` | Unified loading/pause/stall overlay with CSS-driven visibility |

### Player Hooks

| File | Purpose |
|------|---------|
| `modules/Player/hooks/useCommonMediaController.js` | Shared media control logic (play/pause/seek), accessor registration |
| `modules/Player/hooks/useMediaResilience.js` | Stall recovery, overlay state derivation, stable callbacks |
| `modules/Player/hooks/useShaderDiagnostics.js` | Logs viewport/layer dimensions for debugging blackout coverage |
| `modules/Player/hooks/useImageUpscaleBlur.js` | Applies blur filter to upscaled images |

### Menu Components

| File | Purpose |
|------|---------|
| `Apps/TVApp.jsx` | TV app entry point, loads menu data, manages navigation stack |
| `modules/Menu/TVMenu.jsx` | Menu rendering with keyboard navigation |
| `modules/Menu/MenuItems.jsx` | Individual menu item rendering |

### Logging Infrastructure

| File | Purpose |
|------|---------|
| `lib/logging/index.js` | Logger factory, transports (console, WebSocket buffered) |
| `lib/logging/Logger.js` | Singleton logger instance, `getLogger()` export |
| `lib/logging/errorHandlers.js` | Captures `window.onerror`, `unhandledrejection` |
| `lib/logging/consoleInterceptor.js` | Intercepts `console.log/warn/error` with rate limiting |

---

## Hook Reference

### useCommonMediaController

**Location:** `modules/Player/hooks/useCommonMediaController.js`

**Purpose:** Shared media control logic for both audio and video players.

```javascript
const { play, pause, seek, getMediaEl, getContainerEl } = useCommonMediaController({
  resilienceBridge,
  mediaRef,
  containerRef,
});
```

**Returns:**
- `play()` - Start playback
- `pause()` - Pause playback
- `seek(time)` - Seek to specified time
- `getMediaEl()` - Get underlying media element
- `getContainerEl()` - Get container element

### useMediaResilience

**Location:** `modules/Player/hooks/useMediaResilience.js`

**Purpose:** Manages playback resilience state and overlay visibility.

```javascript
const {
  overlayProps,      // Props for PlayerOverlayLoading
  state,             // Current resilience state
  onStartupSignal,   // Stable NOOP callback
} = useMediaResilience({
  onPlaybackMetrics, // Callback to report metrics to parent
});
```

**overlayProps structure:**
```javascript
{
  shouldRender: boolean,   // Mount/unmount control
  isVisible: boolean,      // Opacity control
  isPaused: boolean,       // Show pause icon
  stalled: boolean,        // Show stall indicator
  waitingToPlay: boolean,  // Initial loading state
}
```

### useShaderDiagnostics

**Location:** `modules/Player/hooks/useShaderDiagnostics.js`

**Purpose:** Logs dimension data for debugging blackout shader coverage issues.

```javascript
useShaderDiagnostics(containerRef, enabled);
```

**Logs event:** `blackout.dimensions` with viewport, container, and layer dimensions.

### useImageUpscaleBlur

**Location:** `modules/Player/hooks/useImageUpscaleBlur.js`

**Purpose:** Applies blur filter to images that have been upscaled beyond their natural resolution.

```javascript
const { blurStyle } = useImageUpscaleBlur(imageRef, {
  threshold: 1.5, // Blur if upscaled more than 1.5x
});
```

---

## Component Reference

### PlayerOverlayLoading

**Location:** `modules/Player/PlayerOverlayLoading.jsx`

**Purpose:** Unified overlay for loading, paused, and stalled states.

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `shouldRender` | boolean | Mount/unmount control |
| `isVisible` | boolean | Controls CSS opacity |
| `isPaused` | boolean | Shows pause icon when true |
| `stalled` | boolean | Shows stall indicator when true |
| `waitingToPlay` | boolean | Shows loading spinner when true |

**CSS Classes:**
- `.loading-overlay` - Base overlay styles
- `.loading-overlay.visible` - Visible state (opacity: 1)

### SinglePlayer

**Location:** `modules/Player/SinglePlayer.jsx`

**Purpose:** Routes to appropriate player based on media type.

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `mediaType` | string | 'audio' or 'video' |
| `src` | string | Media source URL |
| `resilienceBridge` | object | Cross-component communication bridge |

**Behavior:**
- Routes to AudioPlayer for audio content
- Routes to VideoPlayer for video/DASH content
- Connects resilienceBridge callbacks to useMediaResilience

### AudioPlayer

**Location:** `modules/Player/AudioPlayer.jsx`

**Purpose:** Audio playback with blackout shader and album art.

**Features:**
- Blackout shader for ambient display
- Album art display with blur effect
- Integration with useShaderDiagnostics
- Reports metrics via resilienceBridge

### VideoPlayer

**Location:** `modules/Player/VideoPlayer.jsx`

**Purpose:** Video and DASH stream playback.

**Features:**
- Native HTML5 video playback
- DASH.js integration for adaptive streaming
- Reports metrics via resilienceBridge

---

## ResilienceBridge Interface

The resilienceBridge object enables communication between Player, SinglePlayer, and media players.

### Callbacks (Parent Provides)

| Callback | Signature | Purpose |
|----------|-----------|---------|
| `onPlaybackMetrics` | `(metrics) => void` | Report playback state |
| `onRegisterMediaAccess` | `(accessors) => void` | Register media accessors |
| `onSeekRequestConsumed` | `() => void` | Acknowledge seek completion |
| `onStartupSignal` | `() => void` | Notify playback started |

### Properties (Parent Provides)

| Property | Type | Purpose |
|----------|------|---------|
| `seekToIntentSeconds` | number | Target seek position |

### Registered Accessors

| Accessor | Signature | Purpose |
|----------|-----------|---------|
| `getMediaEl` | `() => HTMLMediaElement` | Access media element |
| `getContainerEl` | `() => HTMLElement` | Access container element |
| `hardReset` | `() => void` | Force reset playback |
| `fetchVideoInfo` | `() => object` | Get video metadata |

---

## Logging Events

### Player Events

| Event | Level | Data | Source |
|-------|-------|------|--------|
| `playback.started` | info | `{ title, mediaKey }` | Logger |
| `playback.stalled` | warn | `{ currentTime, duration }` | Logger |
| `playback.failed` | error | `{ error }` | Logger |
| `playback.cover-loaded` | info | `{ mediaKey }` | Logger |
| `blackout.dimensions` | warn | `{ viewport, container, layers }` | useShaderDiagnostics |

### System Events

| Event | Level | Source |
|-------|-------|--------|
| `frontend-start` | info | main.jsx |
| `error-handlers.initialized` | info | errorHandlers.js |
| `console-interceptor.initialized` | info | consoleInterceptor.js |

---

## Related Documentation

- **Architecture:** `docs/reference/tv/2-architecture.md` - System design and patterns
- **Logging Runbook:** `docs/runbooks/frontend-logging-debugging.md` - Checking and troubleshooting logs
- **Runtime Testing:** `docs/runbooks/runtime-testing.md` - Running Playwright tests
