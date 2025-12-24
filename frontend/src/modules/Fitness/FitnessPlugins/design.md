# Fitness Apps Framework - Design Specification

## Overview

The Fitness Apps framework introduces a modular app system within the Fitness module. Apps are self-contained interactive components that can be:
1. **Launched standalone** from the `FitnessAppMenu` (sibling to `FitnessMenu`)
2. **Embedded inline** within `FitnessPlayerOverlay` as mini-games during video playback
3. **Displayed in sidebar** as compact widgets

All apps operate within the `FitnessContext`, with full access to session data, participant roster, heart rate zones, governance state, and real-time vitals.

### Key Design Decisions

| Decision | Resolution |
|----------|------------|
| Configuration Persistence | localStorage per app, with reset/clear UI |
| App-to-App Communication | Via FitnessContext event bus (`appEvents`) |
| Overlay Concurrency | One overlay app at a time |
| Governance Integration | Games can satisfy governance challenges via performance metrics |
| Sidebar Compatibility | Sidebar imports app components in `sidebar` mode (unified codebase) |
| Lifecycle Events | Full lifecycle callbacks: mount, unmount, pause, resume, sessionEnd |
| Error Handling | Error boundaries with fallback UI + session logging |
| Permissions | Pre-approved; browser-level permissions on root load |
| Loading States | Spinner overlay default, with custom loader option |
| Config Evolution | Categories and conditional availability in future iterations |

---

## Architecture

### Directory Structure

```
frontend/src/modules/Fitness/
├── FitnessApps/
│   ├── index.js                      # App registry & exports
│   ├── FitnessAppMenu.jsx            # App launcher menu (sibling to FitnessMenu)
│   ├── FitnessAppMenu.scss
│   ├── FitnessAppContainer.jsx       # Wrapper for standalone app rendering
│   ├── FitnessAppContainer.scss
│   ├── FitnessAppErrorBoundary.jsx   # Error boundary with fallback UI
│   ├── FitnessAppLoader.jsx          # Default spinner loader
│   ├── useFitnessApp.js              # App lifecycle hook
│   ├── useAppStorage.js              # localStorage persistence hook
│   ├── apps/
│   │   ├── FitnessChartApp/
│   │   │   ├── index.jsx             # App entry point
│   │   │   ├── FitnessChartApp.jsx   # Main component (refactored from FitnessSidebar/FitnessChart.jsx)
│   │   │   ├── FitnessChartApp.scss
│   │   │   └── manifest.js           # App metadata & capabilities
│   │   ├── CameraViewApp/
│   │   │   ├── index.jsx
│   │   │   ├── CameraViewApp.jsx     # Refactored from FitnessCamStage.jsx
│   │   │   ├── CameraViewApp.scss
│   │   │   └── manifest.js
│   │   ├── JumpingJackGame/
│   │   │   ├── index.jsx
│   │   │   ├── JumpingJackGame.jsx
│   │   │   ├── JumpingJackGame.scss
│   │   │   └── manifest.js
│   │   └── ... (future apps)
│   └── design.md                     # This file
├── FitnessMenu.jsx                   # Existing media menu
└── ...
```

---

## App Manifest Schema

Each app defines a `manifest.js` that declares its capabilities and metadata:

```javascript
// manifest.js
export default {
  // Required
  id: 'fitness_chart',                    // Unique identifier (matches config.yml)
  name: 'Fitness Chart',                  // Display name
  version: '1.0.0',
  
  // Display
  icon: 'chart',                          // Icon key for menu display
  description: 'Real-time heart rate race chart',
  thumbnail: '/apps/fitness_chart/thumbnail.png',
  
  // Capabilities
  modes: {
    standalone: true,                     // Can run as full app from menu
    overlay: true,                        // Can embed in FitnessPlayerOverlay
    sidebar: true,                        // Can render as sidebar widget
    mini: true                            // Supports compact mini mode
  },
  
  // Size hints
  dimensions: {
    standalone: { minWidth: 400, minHeight: 300, preferredAspect: '4:3' },
    overlay: { width: 320, height: 240, position: 'bottom-right' },
    sidebar: { width: '100%', height: 400 },
    mini: { width: 200, height: 150 }
  },
  
  // Context requirements (for validation)
  requires: {
    sessionActive: false,                 // Requires active fitness session?
    participants: true,                   // Requires participant roster?
    heartRate: true,                      // Requires heart rate data?
    governance: false                     // Requires governance state?
  },
  
  // Governance integration (for game apps)
  governance: {
    canSatisfyChallenge: false,          // Can this app satisfy governance challenges?
    challengeTypes: [],                   // e.g., ['activity', 'heart_rate', 'custom']
    metricReporter: null                  // Function name to report metrics
  },
  
  // Lifecycle
  pauseVideoOnLaunch: false,             // Should video pause when app opens?
  exitOnVideoEnd: false,                 // Auto-close when video ends?
  
  // Overlay behavior (single overlay at a time enforced by framework)
  overlay: {
    dismissible: true,                   // Can user close the overlay?
    timeout: null,                       // Auto-dismiss after N ms (null = never)
    backdrop: 'blur',                    // 'blur' | 'dim' | 'none'
    position: 'center'                   // 'center' | 'bottom-right' | 'top-left' etc.
  },
  
  // Loading (spinner overlay by default)
  loading: {
    custom: false,                       // Use custom loader instead of default spinner?
    component: null                      // Custom loader component (if custom: true)
  }
};
```

---

## App Registry

`FitnessApps/index.js` maintains the registry of available apps:

```javascript
// index.js
import FitnessChartApp from './apps/FitnessChartApp';
import CameraViewApp from './apps/CameraViewApp';
import JumpingJackGame from './apps/JumpingJackGame';

export const APP_REGISTRY = {
  fitness_chart: FitnessChartApp,
  camera_view: CameraViewApp,
  jumping_jack_game: JumpingJackGame,
};

export const getApp = (appId) => APP_REGISTRY[appId] || null;
export const getAppManifest = (appId) => APP_REGISTRY[appId]?.manifest || null;
export const listApps = () => Object.keys(APP_REGISTRY).map(id => ({
  id,
  ...APP_REGISTRY[id].manifest
}));
```

---

## Core Components

### 1. FitnessAppMenu.jsx

Menu component for launching apps (sibling to `FitnessMenu.jsx`):

```jsx
const FitnessAppMenu = ({ 
  activeAppMenuId,    // ID from config.yml app_menus
  onAppSelect,        // Callback: (appId, manifest) => void
  onBack              // Return to collection menu
}) => {
  // Loads app list from config.yml app_menus matching activeAppMenuId
  // Displays app cards with icons, names, thumbnails
  // Validates app availability against session state
  // Handles app launch via onAppSelect
};
```

**Integration with config.yml:**
```yaml
plex:
  collections:
    - id: app_menu1
      name: Fitness Apps
      icon: apps
  app_menus:
    - id: app_menu1
      name: Fitness Apps
      items:
        - name: Fitness Chart
          id: fitness_chart
        - name: Camera View
          id: camera_view
```

When a collection with `id` matching an `app_menus` entry is selected, `FitnessAppMenu` renders instead of `FitnessMenu`.

---

### 2. FitnessAppContainer.jsx

Wrapper component that handles app lifecycle:

```jsx
const FitnessAppContainer = ({
  appId,
  mode = 'standalone',    // 'standalone' | 'overlay' | 'sidebar' | 'mini'
  onClose,                // Exit callback
  config = {},            // App-specific config
  className
}) => {
  const fitnessCtx = useFitnessContext();
  const AppComponent = getApp(appId);
  const manifest = getAppManifest(appId);
  
  // Validates requirements
  // Provides close/minimize controls
  // Handles app state persistence
  // Passes standardized props to app
  
  return (
    <div className={`fitness-app-container mode-${mode}`}>
      <AppHeader manifest={manifest} onClose={onClose} mode={mode} />
      <AppComponent 
        mode={mode}
        onClose={onClose}
        fitnessContext={fitnessCtx}
        config={config}
      />
    </div>
  );
};
```

---

### 3. useFitnessApp Hook

Hook for apps to access common functionality, including lifecycle events and localStorage persistence:

```javascript
const useFitnessApp = (appId) => {
  const fitnessCtx = useFitnessContext();
  const storage = useAppStorage(appId);
  
  // Lifecycle event handlers (registered via useEffect in app)
  const lifecycleRef = useRef({
    onMount: null,
    onUnmount: null,
    onPause: null,
    onResume: null,
    onSessionEnd: null
  });
  
  // Register lifecycle callbacks
  const registerLifecycle = useCallback((callbacks) => {
    Object.assign(lifecycleRef.current, callbacks);
  }, []);
  
  // Listen for video pause/resume
  useEffect(() => {
    if (fitnessCtx.videoPlayerPaused) {
      lifecycleRef.current.onPause?.();
    } else {
      lifecycleRef.current.onResume?.();
    }
  }, [fitnessCtx.videoPlayerPaused]);
  
  // Listen for session end
  useEffect(() => {
    if (!fitnessCtx.fitnessSession?.sessionId && lifecycleRef.current.onSessionEnd) {
      lifecycleRef.current.onSessionEnd();
    }
  }, [fitnessCtx.fitnessSession?.sessionId]);
  
  return {
    // Session data
    sessionId: fitnessCtx.fitnessSession?.sessionId,
    sessionActive: Boolean(fitnessCtx.fitnessSession?.sessionId),
    sessionInstance: fitnessCtx.fitnessSessionInstance,
    
    // Participants & vitals
    participants: fitnessCtx.participantRoster,
    getUserVitals: fitnessCtx.getUserVitals,
    getUserTimelineSeries: fitnessCtx.getUserTimelineSeries,
    
    // Zone & governance
    zones: fitnessCtx.zones,
    governanceState: fitnessCtx.governanceState,
    reportGovernanceMetric: fitnessCtx.reportGovernanceMetric,
    
    // Timeline
    timebase: fitnessCtx.timelineTimebase,
    
    // App events (inter-app communication)
    emitAppEvent: fitnessCtx.emitAppEvent,
    subscribeToAppEvent: fitnessCtx.subscribeToAppEvent,
    
    // App actions
    logAppEvent: (event, payload) => {
      fitnessCtx.fitnessSessionInstance?.logEvent?.(`app_${appId}_${event}`, payload);
    },
    
    // Video control (for overlay apps)
    pauseVideo: fitnessCtx.setVideoPlayerPaused,
    videoPlayerPaused: fitnessCtx.videoPlayerPaused,
    
    // Lifecycle registration
    registerLifecycle,
    
    // localStorage persistence
    storage: {
      get: storage.get,
      set: storage.set,
      clear: storage.clear,
      clearAll: storage.clearAll  // Reset all app settings
    }
  };
};
```

---

## App Storage (localStorage Persistence)

Apps persist settings to localStorage with a standardized key pattern and reset capability:

```javascript
// useAppStorage.js
const APP_STORAGE_PREFIX = 'fitness_app_';

const useAppStorage = (appId) => {
  const storageKey = `${APP_STORAGE_PREFIX}${appId}`;
  
  const get = useCallback((key, defaultValue = null) => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return data[key] ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }, [storageKey]);
  
  const set = useCallback((key, value) => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      data[key] = value;
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save app setting: ${key}`, e);
    }
  }, [storageKey]);
  
  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);
  
  const clearAll = useCallback(() => {
    // Clear all fitness app storage
    Object.keys(localStorage)
      .filter(key => key.startsWith(APP_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }, []);
  
  return { get, set, clear, clearAll };
};

export default useAppStorage;
```

### Storage Reset UI

The `FitnessAppMenu` includes a "Reset All App Settings" option in its settings menu that calls `clearAll()`.

---

## App Event Bus (Inter-App Communication)

Apps communicate via the FitnessContext event system:

```javascript
// Add to FitnessContext.jsx
const [appEventQueue, setAppEventQueue] = useState([]);
const appEventListeners = useRef(new Map());

const emitAppEvent = useCallback((eventType, payload, sourceAppId) => {
  const event = {
    type: eventType,
    payload,
    source: sourceAppId,
    timestamp: Date.now()
  };
  
  // Notify all subscribers
  const listeners = appEventListeners.current.get(eventType) || [];
  listeners.forEach(callback => {
    try {
      callback(event);
    } catch (e) {
      console.error(`App event handler error for ${eventType}:`, e);
    }
  });
  
  // Log to session
  fitnessSessionRef.current?.logEvent?.('app_event', event);
}, []);

const subscribeToAppEvent = useCallback((eventType, callback) => {
  if (!appEventListeners.current.has(eventType)) {
    appEventListeners.current.set(eventType, []);
  }
  appEventListeners.current.get(eventType).push(callback);
  
  // Return unsubscribe function
  return () => {
    const listeners = appEventListeners.current.get(eventType) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) listeners.splice(index, 1);
  };
}, []);
```

### Event Types

| Event Type | Payload | Use Case |
|------------|---------|----------|
| `game:score` | `{ score, userId, gameId }` | Chart app shows game scores |
| `game:complete` | `{ result, metrics }` | Governance checks game completion |
| `camera:snapshot` | `{ timestamp, index }` | Sync snapshots with game events |
| `chart:milestone` | `{ userId, milestone }` | Trigger game bonus on chart milestone |

---

## App Interface Contract

Every app component must conform to this interface:

```typescript
interface FitnessAppProps {
  // Mode the app is rendering in
  mode: 'standalone' | 'overlay' | 'sidebar' | 'mini';
  
  // Close/exit callback
  onClose: () => void;
  
  // Full fitness context (prefer useFitnessApp hook)
  fitnessContext: FitnessContextValue;
  
  // App-specific configuration from launch
  config?: Record<string, unknown>;
  
  // For overlay mode: position hints
  overlayPosition?: { x: number; y: number };
  
  // Lifecycle callbacks (called by container)
  onMount?: () => void;
  onUnmount?: () => void;
}

// App module export structure
interface FitnessAppModule {
  default: React.ComponentType<FitnessAppProps>;
  manifest: AppManifest;
}
```

---

## Error Handling

### FitnessAppErrorBoundary

All apps are wrapped in an error boundary that displays a fallback UI and logs errors:

```jsx
// FitnessAppErrorBoundary.jsx
class FitnessAppErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    const { appId, sessionInstance } = this.props;
    
    // Log to session
    sessionInstance?.logEvent?.('app_error', {
      appId,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
    
    console.error(`Fitness App Error [${appId}]:`, error, errorInfo);
  }
  
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="fitness-app-error">
          <div className="error-icon">⚠️</div>
          <div className="error-title">App Error</div>
          <div className="error-message">
            {this.props.manifest?.name || 'This app'} encountered an error.
          </div>
          <div className="error-actions">
            <button onClick={this.handleRetry}>Retry</button>
            <button onClick={this.props.onClose}>Close</button>
          </div>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

### Usage in FitnessAppContainer

```jsx
const FitnessAppContainer = ({ appId, mode, onClose, config }) => {
  const fitnessCtx = useFitnessContext();
  const AppComponent = getApp(appId);
  const manifest = getAppManifest(appId);
  const [loading, setLoading] = useState(true);
  
  // Use custom loader or default spinner
  const LoaderComponent = manifest?.loading?.custom 
    ? manifest.loading.component 
    : FitnessAppLoader;
  
  return (
    <div className={`fitness-app-container mode-${mode}`}>
      <FitnessAppErrorBoundary
        appId={appId}
        manifest={manifest}
        sessionInstance={fitnessCtx.fitnessSessionInstance}
        onClose={onClose}
      >
        {loading && <LoaderComponent />}
        <AppComponent
          mode={mode}
          onClose={onClose}
          fitnessContext={fitnessCtx}
          config={config}
          onMount={() => setLoading(false)}
        />
      </FitnessAppErrorBoundary>
    </div>
  );
};
```

---

## Loading States

### Default Spinner Loader

```jsx
// FitnessAppLoader.jsx
const FitnessAppLoader = ({ message = 'Loading...' }) => (
  <div className="fitness-app-loader">
    <div className="loader-spinner" />
    <div className="loader-message">{message}</div>
  </div>
);
```

### Custom Loader (per manifest)

Apps can define custom loaders in their manifest:

```javascript
// manifest.js for an app with custom loader
export default {
  id: 'jumping_jack_game',
  // ...
  loading: {
    custom: true,
    component: JumpingJackLoader  // Animated character loading screen
  }
};
```

---

## Overlay Integration

### Single Overlay Constraint

**Only one overlay app can be active at a time.** If a new overlay is launched while one is active, the existing overlay is dismissed first. This simplifies the UI and prevents overlay stacking issues.

### Embedding Apps in FitnessPlayerOverlay

`FitnessPlayerOverlay.jsx` will support rendering embedded apps:

```jsx
// In FitnessPlayerOverlay.jsx
const FitnessPlayerOverlay = ({ overlay, playerRef, showFullscreenVitals }) => {
  const fitnessCtx = useFitnessContext();
  const { overlayApp, dismissOverlayApp } = fitnessCtx;
  
  // Governance or external trigger can launch an app
  useEffect(() => {
    if (overlay?.type === 'app' && overlay.appId) {
      fitnessCtx.launchOverlayApp(overlay.appId, overlay.appConfig || {});
    }
  }, [overlay]);
  
  return (
    <div className="fitness-player-overlay">
      {/* Existing overlay content */}
      
      {overlayApp && (
        <FitnessAppContainer
          appId={overlayApp.appId}
          mode="overlay"
          config={overlayApp.config}
          onClose={dismissOverlayApp}
        />
      )}
    </div>
  );
};
```

### Overlay Trigger API

Apps can be triggered programmatically via FitnessContext:

```javascript
// Add to FitnessContext
const launchOverlayApp = useCallback((appId, config = {}) => {
  // Dismiss any existing overlay first (single overlay constraint)
  setOverlayApp({ appId, config });
}, []);

const dismissOverlayApp = useCallback(() => {
  setOverlayApp(null);
}, []);
```

---

## Governance Integration

### Games Can Satisfy Governance Challenges

Game apps can report performance metrics that satisfy governance requirements. This allows interactive challenges to unlock content similar to heart rate zone requirements.

### Governance Metric Reporting

```javascript
// In useFitnessApp hook
const reportGovernanceMetric = useCallback((metric) => {
  fitnessCtx.reportGovernanceMetric({
    source: 'app',
    appId,
    type: metric.type,        // 'activity', 'completion', 'score', 'custom'
    value: metric.value,
    userId: metric.userId,
    timestamp: Date.now()
  });
}, [appId, fitnessCtx]);
```

### Example: Jumping Jack Game Satisfying Challenge

```javascript
// JumpingJackGame.jsx
const JumpingJackGame = ({ mode, onClose }) => {
  const { reportGovernanceMetric, emitAppEvent } = useFitnessApp('jumping_jack_game');
  
  const handleGameComplete = (score, userId) => {
    // Report to governance system
    reportGovernanceMetric({
      type: 'activity',
      value: score,
      userId,
      metadata: { gameType: 'jumping_jack', reps: score }
    });
    
    // Emit event for other apps (e.g., chart)
    emitAppEvent('game:complete', {
      gameId: 'jumping_jack_game',
      score,
      userId,
      result: score >= 10 ? 'success' : 'partial'
    }, 'jumping_jack_game');
  };
  
  // ...
};
```

### Governance Policy Extension

```yaml
# config.yml governance section
governance:
  policies:
    default:
      base_requirement:
        - active: all
        - app_challenge:            # New: app-based challenges
            app: jumping_jack_game
            min_score: 10
            users: any
```

---

## Converting Existing Components to Apps

### FitnessChart → FitnessChartApp

**Current:** `FitnessSidebar/FitnessChart.jsx` (547 lines)

**Conversion strategy (Option B - Unified Codebase):**
1. Extract core chart logic into `FitnessChartApp.jsx`
2. Update existing `FitnessSidebar/FitnessChart.jsx` to import and render the app in `sidebar` mode
3. Add mode-aware rendering (different layouts for sidebar vs standalone vs overlay)

```jsx
// FitnessSidebar/FitnessChart.jsx (thin wrapper)
import FitnessChartApp from '../FitnessApps/apps/FitnessChartApp';

const FitnessChart = () => {
  return <FitnessChartApp mode="sidebar" onClose={() => {}} />;
};

export default FitnessChart;
```

```jsx
// apps/FitnessChartApp/FitnessChartApp.jsx
const FitnessChartApp = ({ mode, onClose, config }) => {
  const { participants, getUserTimelineSeries, timebase, registerLifecycle } = useFitnessApp('fitness_chart');
  
  // Register lifecycle callbacks
  useEffect(() => {
    registerLifecycle({
      onPause: () => { /* Pause animations */ },
      onResume: () => { /* Resume animations */ },
      onSessionEnd: () => { /* Cleanup */ }
    });
  }, [registerLifecycle]);
  
  const layoutClass = {
    standalone: 'chart-layout-full',
    sidebar: 'chart-layout-sidebar',
    overlay: 'chart-layout-overlay',
    mini: 'chart-layout-mini'
  }[mode];
  
  return (
    <div className={`fitness-chart-app ${layoutClass}`}>
      <RaceChartSvg {...chartProps} />
      {mode === 'standalone' && <ChartControls />}
    </div>
  );
};
```

### FitnessCamStage → CameraViewApp

**Current:** `FitnessCamStage.jsx` (204 lines)

**Conversion strategy (Option B - Unified Codebase):**
1. Refactor webcam capture logic into `CameraViewApp.jsx`
2. Update existing `FitnessCamStage.jsx` to import and render the app
3. Support different capture modes based on app mode
4. Add settings panel for standalone mode

```jsx
// FitnessCamStage.jsx (thin wrapper)
import CameraViewApp from './FitnessApps/apps/CameraViewApp';

const FitnessCamStage = ({ onOpenSettings }) => {
  return <CameraViewApp mode="sidebar" onClose={() => {}} onOpenSettings={onOpenSettings} />;
};

export default FitnessCamStage;
```

```jsx
// apps/CameraViewApp/CameraViewApp.jsx
const CameraViewApp = ({ mode, onClose, onOpenSettings }) => {
  const { sessionId, sessionInstance, registerLifecycle, emitAppEvent } = useFitnessApp('camera_view');
  
  // Adjust capture interval based on mode
  const captureIntervalMs = mode === 'mini' ? 10000 : 5000;
  
  const handleSnapshot = useCallback((meta, blob) => {
    // Upload snapshot...
    
    // Emit event for other apps
    emitAppEvent('camera:snapshot', {
      timestamp: meta.takenAt,
      index: meta.index
    }, 'camera_view');
  }, [emitAppEvent]);
  
  return (
    <div className={`camera-view-app mode-${mode}`}>
      <FitnessWebcam
        enabled={mode !== 'mini'}
        captureIntervalMs={captureIntervalMs}
        onSnapshot={handleSnapshot}
        // ...
      />
      {mode === 'standalone' && (
        <CameraControls onSettings={onOpenSettings} />
      )}
    </div>
  );
};
```

---

## State Management

### App State in FitnessContext

Add app-related state to `FitnessContext.jsx`:

```javascript
// New state in FitnessProvider
const [activeApp, setActiveApp] = useState(null);          // Current standalone app
const [overlayApp, setOverlayApp] = useState(null);        // Current overlay app
const [appHistory, setAppHistory] = useState([]);          // Navigation history

// App lifecycle methods
const launchApp = useCallback((appId, options = {}) => {
  const manifest = getAppManifest(appId);
  if (!manifest) return false;
  
  if (options.mode === 'overlay') {
    setOverlayApp({ appId, config: options.config || {} });
  } else {
    setAppHistory(prev => [...prev, activeApp].filter(Boolean));
    setActiveApp({ appId, config: options.config || {} });
  }
  return true;
}, [activeApp]);

const closeApp = useCallback((returnToMenu = true) => {
  if (overlayApp) {
    setOverlayApp(null);
  } else if (activeApp) {
    const previous = appHistory[appHistory.length - 1];
    setAppHistory(prev => prev.slice(0, -1));
    setActiveApp(returnToMenu ? null : previous);
  }
}, [activeApp, overlayApp, appHistory]);
```

### Context Additions

```javascript
// Add to context value
const contextValue = {
  // ... existing values
  
  // App state
  activeApp,
  overlayApp,          // Single overlay app at a time
  
  // App actions
  launchApp,
  closeApp,
  launchOverlayApp: (appId, config) => launchApp(appId, { mode: 'overlay', config }),
  dismissOverlayApp: () => setOverlayApp(null),
  
  // App utilities
  getAppManifest,
  listApps,
  
  // App events (inter-app communication)
  emitAppEvent,
  subscribeToAppEvent,
  
  // Governance integration
  reportGovernanceMetric
};
```

---

## Navigation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      FitnessNavbar                          │
│  [Favorites] [Strength] [Cardio] ... [Apps]                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
      ┌───────────────┐              ┌───────────────┐
      │  FitnessMenu  │              │FitnessAppMenu │
      │ (Plex shows)  │              │  (App list)   │
      └───────────────┘              └───────────────┘
              │                               │
              ▼                               ▼
      ┌───────────────┐              ┌───────────────────┐
      │ FitnessPlayer │              │FitnessAppContainer│
      │  (Video)      │◄─────────────│   (Active App)    │
      └───────────────┘  can embed   └───────────────────┘
              │            apps               │
              ▼                               │
      ┌───────────────┐                       │
      │FitnessPlayer  │◄──────────────────────┘
      │   Overlay     │   overlay apps
      │  (+ mini app) │
      └───────────────┘
```

---

## Styling Guidelines

### CSS Class Conventions

```scss
// Base app container
.fitness-app-container {
  &.mode-standalone { /* Full-screen app */ }
  &.mode-overlay { /* Floating overlay */ }
  &.mode-sidebar { /* Sidebar widget */ }
  &.mode-mini { /* Compact thumbnail */ }
}

// Individual app styling
.fitness-chart-app {
  &.chart-layout-full { /* Full app layout */ }
  &.chart-layout-overlay { /* Compact overlay */ }
}
```

### Theme Variables

Apps should use existing CSS variables from the fitness module:

```scss
--fitness-bg-primary
--fitness-bg-secondary
--fitness-text-primary
--fitness-accent-color
--fitness-zone-{zone}-color
```

---

## Design Decisions Summary

The following design decisions were made for the Fitness Apps framework:

### 1. App Configuration Persistence
**Decision:** localStorage per app with reset/clear UI flow.

- Each app stores settings under `fitness_app_{appId}` key
- `useAppStorage` hook provides `get`, `set`, `clear`, and `clearAll` methods
- FitnessAppMenu includes "Reset All App Settings" option

### 2. App-to-App Communication
**Decision:** Via FitnessContext event system (`appEvents`).

- `emitAppEvent(type, payload, sourceAppId)` to broadcast events
- `subscribeToAppEvent(type, callback)` to listen
- Events logged to session for debugging
- Standard event types: `game:score`, `game:complete`, `camera:snapshot`, `chart:milestone`

### 3. Overlay App Concurrency
**Decision:** One overlay app at a time for simplicity.

- Launching a new overlay dismisses the current one
- No queue or stack management needed
- Simplifies UI and prevents z-index/focus issues

### 4. Mini-Game Integration with Governance
**Decision:** Games can contribute to governance challenges via performance metrics.

- Apps with `governance.canSatisfyChallenge: true` in manifest can report metrics
- `reportGovernanceMetric()` API sends scores/completions to governance engine
- Governance policies can specify app-based challenges alongside heart rate requirements

### 5. Backward Compatibility for Sidebar Components
**Decision:** Option B - Sidebar imports app components in `sidebar` mode.

- Unified codebase: one implementation for all modes
- Existing `FitnessChart.jsx` becomes thin wrapper importing `FitnessChartApp`
- Existing `FitnessCamStage.jsx` becomes thin wrapper importing `CameraViewApp`
- No duplicate code maintenance

### 6. App Lifecycle Events
**Decision:** Full lifecycle callbacks provided.

- `onMount()` - App rendered and ready
- `onUnmount()` - App closing, cleanup
- `onPause()` - Video paused or app backgrounded
- `onResume()` - Video resumed or app foregrounded
- `onSessionEnd()` - Fitness session ended
- Registered via `registerLifecycle()` from `useFitnessApp` hook

### 7. Error Boundaries
**Decision:** Error boundaries with fallback UI and session logging.

- `FitnessAppErrorBoundary` wraps all apps in `FitnessAppContainer`
- Displays friendly error UI with Retry and Close buttons
- Logs error details to session via `logEvent('app_error', ...)`
- Prevents single app crash from breaking entire fitness module

### 8. App Permissions Model
**Decision:** All apps pre-approved; browser permissions handled at root load.

- No in-app permission prompts
- Camera/microphone permissions requested during fitness module initialization
- Apps assume permissions are granted or gracefully degrade

### 9. Loading States
**Decision:** Spinner overlay by default, with option for custom loaders.

- `FitnessAppLoader` component shows centered spinner with message
- Apps can specify `loading.custom: true` and `loading.component` in manifest
- Loading state managed by `FitnessAppContainer`, cleared on `onMount`

### 10. Config.yml Schema Evolution
**Decision:** Support categories and conditional availability in future iterations.

- Current: Simple flat list of apps in `app_menus.items`
- Future: Add `category`, `conditions` (user role, session state), `config` per app
- Extensible schema allows gradual enhancement

---

## Implementation Phases

---

### Phase 1: Core Framework

**Goal:** Establish the app infrastructure so apps can be registered, launched, and rendered.

#### 1.1 Create Directory Structure
```bash
mkdir -p frontend/src/modules/Fitness/FitnessApps/apps/FitnessChartApp
mkdir -p frontend/src/modules/Fitness/FitnessApps/apps/CameraViewApp
mkdir -p frontend/src/modules/Fitness/FitnessApps/apps/JumpingJackGame
```

#### 1.2 Implement App Registry (`index.js`)
```javascript
// FitnessApps/index.js
export const APP_REGISTRY = {};

export const registerApp = (appModule) => {
  if (appModule?.manifest?.id) {
    APP_REGISTRY[appModule.manifest.id] = appModule;
  }
};

export const getApp = (appId) => APP_REGISTRY[appId]?.default || null;
export const getAppManifest = (appId) => APP_REGISTRY[appId]?.manifest || null;
export const listApps = () => Object.entries(APP_REGISTRY).map(([id, mod]) => ({
  id,
  ...mod.manifest
}));

// Auto-register apps (lazy load in future)
import * as FitnessChartApp from './apps/FitnessChartApp';
import * as CameraViewApp from './apps/CameraViewApp';
registerApp(FitnessChartApp);
registerApp(CameraViewApp);
```

#### 1.3 Build `useAppStorage.js`
- Implement `get(key, defaultValue)`, `set(key, value)`, `clear()`, `clearAll()`
- Key format: `fitness_app_{appId}`
- Handle JSON parse errors gracefully

#### 1.4 Build `useFitnessApp.js`
- Import `useFitnessContext` and `useAppStorage`
- Implement lifecycle registration via `useRef`
- Wire up `onPause`/`onResume` to `videoPlayerPaused` changes
- Wire up `onSessionEnd` to `sessionId` becoming null
- Return standardized API object

#### 1.5 Build `FitnessAppLoader.jsx`
```jsx
// FitnessApps/FitnessAppLoader.jsx
import './FitnessAppLoader.scss';

const FitnessAppLoader = ({ message = 'Loading...' }) => (
  <div className="fitness-app-loader">
    <div className="loader-spinner" />
    <div className="loader-message">{message}</div>
  </div>
);

export default FitnessAppLoader;
```

#### 1.6 Build `FitnessAppErrorBoundary.jsx`
- Class component with `getDerivedStateFromError` and `componentDidCatch`
- Log errors via `sessionInstance.logEvent('app_error', ...)`
- Render fallback UI with Retry/Close buttons
- Accept `appId`, `manifest`, `sessionInstance`, `onClose` props

#### 1.7 Build `FitnessAppContainer.jsx`
```jsx
// FitnessApps/FitnessAppContainer.jsx
import { useState } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext';
import { getApp, getAppManifest } from './index';
import FitnessAppErrorBoundary from './FitnessAppErrorBoundary';
import FitnessAppLoader from './FitnessAppLoader';
import './FitnessAppContainer.scss';

const FitnessAppContainer = ({ appId, mode = 'standalone', onClose, config = {} }) => {
  const fitnessCtx = useFitnessContext();
  const AppComponent = getApp(appId);
  const manifest = getAppManifest(appId);
  const [loading, setLoading] = useState(true);

  if (!AppComponent) {
    return <div className="fitness-app-not-found">App not found: {appId}</div>;
  }

  const LoaderComponent = manifest?.loading?.custom
    ? manifest.loading.component
    : FitnessAppLoader;

  return (
    <div className={`fitness-app-container mode-${mode}`}>
      {mode !== 'sidebar' && (
        <div className="fitness-app-header">
          <span className="app-title">{manifest?.name || appId}</span>
          <button className="app-close-btn" onClick={onClose}>×</button>
        </div>
      )}
      <FitnessAppErrorBoundary
        appId={appId}
        manifest={manifest}
        sessionInstance={fitnessCtx.fitnessSessionInstance}
        onClose={onClose}
      >
        {loading && <LoaderComponent />}
        <AppComponent
          mode={mode}
          onClose={onClose}
          fitnessContext={fitnessCtx}
          config={config}
          onMount={() => setLoading(false)}
        />
      </FitnessAppErrorBoundary>
    </div>
  );
};

export default FitnessAppContainer;
```

#### 1.8 Build `FitnessAppMenu.jsx`
```jsx
// FitnessApps/FitnessAppMenu.jsx
import { useState, useEffect, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { listApps, getAppManifest } from './index';
import './FitnessAppMenu.scss';

const FitnessAppMenu = ({ activeAppMenuId, onAppSelect, onBack }) => {
  const [menuConfig, setMenuConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        const config = await DaylightAPI('/api/fitness');
        const menus = config?.fitness?.plex?.app_menus || [];
        const menu = menus.find(m => m.id === activeAppMenuId);
        setMenuConfig(menu);
      } catch (err) {
        console.error('Failed to load app menu:', err);
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [activeAppMenuId]);

  const availableApps = useMemo(() => {
    if (!menuConfig?.items) return [];
    return menuConfig.items
      .map(item => ({ ...item, manifest: getAppManifest(item.id) }))
      .filter(item => item.manifest); // Only show registered apps
  }, [menuConfig]);

  if (loading) return <div className="fitness-app-menu loading">Loading apps...</div>;

  return (
    <div className="fitness-app-menu">
      <div className="app-menu-header">
        <button onClick={onBack} className="back-btn">← Back</button>
        <h2>{menuConfig?.name || 'Fitness Apps'}</h2>
      </div>
      <div className="app-grid">
        {availableApps.map(app => (
          <button
            key={app.id}
            className="app-card"
            onClick={() => onAppSelect(app.id, app.manifest)}
          >
            <div className="app-icon">{app.manifest.icon || '📱'}</div>
            <div className="app-name">{app.name}</div>
            <div className="app-description">{app.manifest.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default FitnessAppMenu;
```

#### 1.9 Add App State to `FitnessContext.jsx`

Add these state variables and methods to `FitnessProvider`:

```javascript
// New state
const [activeApp, setActiveApp] = useState(null);
const [overlayApp, setOverlayApp] = useState(null);
const [appHistory, setAppHistory] = useState([]);
const appEventListeners = useRef(new Map());

// App launch/close methods
const launchApp = useCallback((appId, options = {}) => {
  const manifest = getAppManifest(appId);
  if (!manifest) return false;
  
  if (options.mode === 'overlay') {
    setOverlayApp({ appId, config: options.config || {} });
  } else {
    setAppHistory(prev => [...prev, activeApp].filter(Boolean));
    setActiveApp({ appId, config: options.config || {} });
  }
  return true;
}, [activeApp]);

const closeApp = useCallback(() => {
  if (overlayApp) {
    setOverlayApp(null);
  } else if (activeApp) {
    const previous = appHistory[appHistory.length - 1];
    setAppHistory(prev => prev.slice(0, -1));
    setActiveApp(previous || null);
  }
}, [activeApp, overlayApp, appHistory]);

const launchOverlayApp = useCallback((appId, config = {}) => {
  setOverlayApp({ appId, config });
}, []);

const dismissOverlayApp = useCallback(() => {
  setOverlayApp(null);
}, []);

// App event bus
const emitAppEvent = useCallback((eventType, payload, sourceAppId) => {
  const event = { type: eventType, payload, source: sourceAppId, timestamp: Date.now() };
  const listeners = appEventListeners.current.get(eventType) || [];
  listeners.forEach(cb => { try { cb(event); } catch (e) { console.error(e); } });
  fitnessSessionRef.current?.logEvent?.('app_event', event);
}, []);

const subscribeToAppEvent = useCallback((eventType, callback) => {
  if (!appEventListeners.current.has(eventType)) {
    appEventListeners.current.set(eventType, []);
  }
  appEventListeners.current.get(eventType).push(callback);
  return () => {
    const listeners = appEventListeners.current.get(eventType) || [];
    const idx = listeners.indexOf(callback);
    if (idx > -1) listeners.splice(idx, 1);
  };
}, []);

// Add to contextValue
// activeApp, overlayApp, launchApp, closeApp, launchOverlayApp, dismissOverlayApp,
// emitAppEvent, subscribeToAppEvent
```

#### 1.10 Create SCSS Files
- `FitnessAppContainer.scss` - Container styles for all modes
- `FitnessAppMenu.scss` - App grid and card styles
- `FitnessAppLoader.scss` - Spinner animation

**Phase 1 Deliverables:**
- [ ] `FitnessApps/index.js`
- [ ] `FitnessApps/useAppStorage.js`
- [ ] `FitnessApps/useFitnessApp.js`
- [ ] `FitnessApps/FitnessAppLoader.jsx` + `.scss`
- [ ] `FitnessApps/FitnessAppErrorBoundary.jsx`
- [ ] `FitnessApps/FitnessAppContainer.jsx` + `.scss`
- [ ] `FitnessApps/FitnessAppMenu.jsx` + `.scss`
- [ ] Updated `FitnessContext.jsx` with app state/methods

---

### Phase 2: Convert Existing Components

**Goal:** Refactor `FitnessChart` and `FitnessCamStage` into apps while maintaining backward compatibility.

#### 2.1 Create FitnessChartApp Manifest
```javascript
// FitnessApps/apps/FitnessChartApp/manifest.js
export default {
  id: 'fitness_chart',
  name: 'Fitness Chart',
  version: '1.0.0',
  icon: '📊',
  description: 'Real-time heart rate race chart showing participant progress',
  modes: {
    standalone: true,
    overlay: true,
    sidebar: true,
    mini: true
  },
  dimensions: {
    standalone: { minWidth: 400, minHeight: 300, preferredAspect: '4:3' },
    overlay: { width: 320, height: 240, position: 'bottom-right' },
    sidebar: { width: '100%', height: 400 },
    mini: { width: 200, height: 150 }
  },
  requires: {
    sessionActive: false,
    participants: true,
    heartRate: true,
    governance: false
  },
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false,
  overlay: {
    dismissible: true,
    timeout: null,
    backdrop: 'none',
    position: 'bottom-right'
  }
};
```

#### 2.2 Create FitnessChartApp Component
```javascript
// FitnessApps/apps/FitnessChartApp/index.jsx
export { default } from './FitnessChartApp';
export { default as manifest } from './manifest';
```

```jsx
// FitnessApps/apps/FitnessChartApp/FitnessChartApp.jsx
import { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useFitnessApp } from '../../useFitnessApp';
// Import chart helpers from original FitnessChart.jsx
import {
  MIN_VISIBLE_TICKS,
  ZONE_COLOR_MAP,
  buildBeatsSeries,
  buildSegments,
  createPaths
} from '../../../FitnessSidebar/FitnessChart.jsx';
import './FitnessChartApp.scss';

const FitnessChartApp = ({ mode, onClose, config, onMount }) => {
  const {
    participants,
    getUserTimelineSeries,
    timebase,
    registerLifecycle,
    subscribeToAppEvent
  } = useFitnessApp('fitness_chart');
  
  const containerRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 420, height: 390 });
  
  // Signal loaded
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  
  // Register lifecycle
  useEffect(() => {
    registerLifecycle({
      onPause: () => console.log('Chart paused'),
      onResume: () => console.log('Chart resumed'),
      onSessionEnd: () => console.log('Session ended')
    });
  }, [registerLifecycle]);
  
  // Listen for game events to show scores
  useEffect(() => {
    const unsub = subscribeToAppEvent('game:score', (event) => {
      console.log('Game score received:', event.payload);
      // Could display score markers on chart
    });
    return unsub;
  }, [subscribeToAppEvent]);
  
  // Resize observer
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setChartSize({
        width: Math.max(240, rect.width),
        height: Math.max(200, rect.height)
      });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  
  // Mode-specific layout class
  const layoutClass = {
    standalone: 'chart-layout-full',
    sidebar: 'chart-layout-sidebar',
    overlay: 'chart-layout-overlay',
    mini: 'chart-layout-mini'
  }[mode] || 'chart-layout-sidebar';
  
  // ... rest of chart rendering logic from FitnessChart.jsx
  
  return (
    <div ref={containerRef} className={`fitness-chart-app ${layoutClass}`}>
      {/* Chart SVG rendering */}
      {mode === 'standalone' && (
        <div className="chart-controls">
          {/* Zoom, pan, settings */}
        </div>
      )}
    </div>
  );
};

export default FitnessChartApp;
```

#### 2.3 Update FitnessSidebar/FitnessChart.jsx as Thin Wrapper
```jsx
// FitnessSidebar/FitnessChart.jsx
import FitnessChartApp from '../FitnessApps/apps/FitnessChartApp';

// Re-export helpers for backward compatibility
export {
  MIN_VISIBLE_TICKS,
  ZONE_COLOR_MAP,
  buildBeatsSeries,
  buildSegments,
  createPaths
} from './FitnessChart.helpers.js';

const FitnessChart = () => {
  return <FitnessChartApp mode="sidebar" onClose={() => {}} />;
};

export default FitnessChart;
```

#### 2.4 Extract Chart Helpers
Move pure functions from `FitnessChart.jsx` to `FitnessChart.helpers.js`:
- `buildBeatsSeries`
- `buildSegments`
- `createPaths`
- `formatCompactNumber`
- `formatDuration`
- Scale calculation functions

#### 2.5 Create CameraViewApp (Same Pattern)
```javascript
// FitnessApps/apps/CameraViewApp/manifest.js
export default {
  id: 'camera_view',
  name: 'Camera View',
  version: '1.0.0',
  icon: '📷',
  description: 'Webcam view with session snapshots',
  modes: { standalone: true, overlay: false, sidebar: true, mini: true },
  requires: { sessionActive: true, participants: false, heartRate: false, governance: false },
  pauseVideoOnLaunch: false
};
```

#### 2.6 Update FitnessCamStage.jsx as Thin Wrapper
```jsx
// FitnessCamStage.jsx
import CameraViewApp from './FitnessApps/apps/CameraViewApp';

const FitnessCamStage = ({ onOpenSettings }) => {
  return <CameraViewApp mode="sidebar" onClose={() => {}} onOpenSettings={onOpenSettings} />;
};

export default FitnessCamStage;
```

**Phase 2 Deliverables:**
- [ ] `FitnessApps/apps/FitnessChartApp/manifest.js`
- [ ] `FitnessApps/apps/FitnessChartApp/index.jsx`
- [ ] `FitnessApps/apps/FitnessChartApp/FitnessChartApp.jsx`
- [ ] `FitnessApps/apps/FitnessChartApp/FitnessChartApp.scss`
- [ ] `FitnessSidebar/FitnessChart.helpers.js` (extracted)
- [ ] Updated `FitnessSidebar/FitnessChart.jsx` (thin wrapper)
- [ ] `FitnessApps/apps/CameraViewApp/manifest.js`
- [ ] `FitnessApps/apps/CameraViewApp/index.jsx`
- [ ] `FitnessApps/apps/CameraViewApp/CameraViewApp.jsx`
- [ ] `FitnessApps/apps/CameraViewApp/CameraViewApp.scss`
- [ ] Updated `FitnessCamStage.jsx` (thin wrapper)
- [ ] Verify sidebar still renders correctly

---

### Phase 3: Overlay Integration

**Goal:** Enable apps to run as overlays during video playback.

#### 3.1 Update FitnessPlayerOverlay.jsx

Add overlay app rendering after existing overlay content:

```jsx
// In FitnessPlayerOverlay.jsx
import FitnessAppContainer from './FitnessApps/FitnessAppContainer';

const FitnessPlayerOverlay = ({ overlay, playerRef, showFullscreenVitals }) => {
  const fitnessCtx = useFitnessContext();
  const { overlayApp, dismissOverlayApp } = fitnessCtx;
  
  // Handle app overlay triggers from governance
  useEffect(() => {
    if (overlay?.type === 'app' && overlay.appId && !overlayApp) {
      fitnessCtx.launchOverlayApp(overlay.appId, overlay.appConfig || {});
    }
  }, [overlay, overlayApp, fitnessCtx]);
  
  return (
    <div className="fitness-player-overlay">
      {/* ... existing overlay content (governance, vitals, etc.) ... */}
      
      {/* App Overlay Layer */}
      {overlayApp && (
        <div className="fitness-app-overlay-layer">
          <FitnessAppContainer
            appId={overlayApp.appId}
            mode="overlay"
            config={overlayApp.config}
            onClose={dismissOverlayApp}
          />
        </div>
      )}
    </div>
  );
};
```

#### 3.2 Add Overlay Styles
```scss
// FitnessPlayerOverlay.scss additions
.fitness-app-overlay-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
  
  .fitness-app-container {
    pointer-events: auto;
    
    &.mode-overlay {
      max-width: 90%;
      max-height: 80%;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      background: var(--fitness-bg-primary);
    }
  }
}
```

#### 3.3 Test Overlay Launch Methods
```javascript
// Test from console or component:
fitnessCtx.launchOverlayApp('fitness_chart', { showControls: true });

// Test dismissal:
fitnessCtx.dismissOverlayApp();

// Verify single-overlay constraint:
fitnessCtx.launchOverlayApp('camera_view'); // Should replace fitness_chart
```

**Phase 3 Deliverables:**
- [ ] Updated `FitnessPlayerOverlay.jsx` with app overlay layer
- [ ] Updated `FitnessPlayerOverlay.scss` with overlay styles
- [ ] Test: Launch overlay via `launchOverlayApp`
- [ ] Test: Dismiss overlay via `dismissOverlayApp`
- [ ] Test: Single overlay constraint (new overlay replaces old)
- [ ] Test: Overlay doesn't block video controls when dismissed

---

### Phase 4: Governance Integration

**Goal:** Allow apps to report metrics that satisfy governance challenges.

#### 4.1 Add `reportGovernanceMetric` to FitnessContext

```javascript
// In FitnessContext.jsx
const reportGovernanceMetric = useCallback((metric) => {
  const normalized = {
    source: 'app',
    appId: metric.appId,
    type: metric.type,           // 'activity', 'completion', 'score'
    value: metric.value,
    userId: metric.userId || null,
    timestamp: Date.now(),
    metadata: metric.metadata || {}
  };
  
  // Log to session
  fitnessSessionRef.current?.logEvent?.('app_governance_metric', normalized);
  
  // Forward to governance engine
  session.governanceEngine?.processAppMetric?.(normalized);
}, [session]);

// Add to contextValue
```

#### 4.2 Update Governance Engine

In `useFitnessSession.js` or governance engine file:

```javascript
// Add method to GovernanceEngine class
processAppMetric(metric) {
  if (!this.activeChallenge) return;
  
  // Check if current challenge accepts app metrics
  const challengeConfig = this.activeChallenge.config;
  if (challengeConfig?.app_challenge?.app !== metric.appId) return;
  
  // Check if metric meets requirements
  const minScore = challengeConfig.app_challenge.min_score || 0;
  if (metric.type === 'score' && metric.value >= minScore) {
    this.satisfyChallenge(metric.userId, 'app_completion', metric);
  }
}
```

#### 4.3 Extend Config Schema

Update config.yml to support app challenges:

```yaml
governance:
  policies:
    kids_content:
      base_requirement:
        - active: all
      challenge_options:
        - type: heart_rate
          zone: active
          duration: 60
        - type: app_challenge        # New
          app: jumping_jack_game
          min_score: 10
          timeout: 120
```

#### 4.4 Update `useFitnessApp` Hook

```javascript
// In useFitnessApp.js
const reportGovernanceMetric = useCallback((metric) => {
  fitnessCtx.reportGovernanceMetric({
    ...metric,
    appId
  });
}, [fitnessCtx, appId]);

// Add to return object
```

**Phase 4 Deliverables:**
- [ ] `reportGovernanceMetric` method in FitnessContext
- [ ] `processAppMetric` method in governance engine
- [ ] Updated governance policy schema for app challenges
- [ ] Updated `useFitnessApp` to expose `reportGovernanceMetric`
- [ ] Test: App metric satisfies challenge
- [ ] Test: App metric logged to session

---

### Phase 5: Sample Game App

**Goal:** Create JumpingJackGame as a proof-of-concept game app.

#### 5.1 Create Manifest
```javascript
// FitnessApps/apps/JumpingJackGame/manifest.js
export default {
  id: 'jumping_jack_game',
  name: 'Jumping Jacks',
  version: '1.0.0',
  icon: '🏃',
  description: 'Complete jumping jacks to unlock content!',
  modes: { standalone: true, overlay: true, sidebar: false, mini: false },
  dimensions: {
    standalone: { minWidth: 500, minHeight: 400 },
    overlay: { width: 400, height: 350, position: 'center' }
  },
  requires: { sessionActive: true, participants: true, heartRate: true, governance: true },
  governance: {
    canSatisfyChallenge: true,
    challengeTypes: ['activity', 'completion'],
    metricReporter: 'reportScore'
  },
  pauseVideoOnLaunch: true,
  exitOnVideoEnd: false,
  overlay: {
    dismissible: false,
    timeout: 120000,
    backdrop: 'blur',
    position: 'center'
  }
};
```

#### 5.2 Create Game Component
```jsx
// FitnessApps/apps/JumpingJackGame/JumpingJackGame.jsx
import { useState, useEffect, useCallback } from 'react';
import { useFitnessApp } from '../../useFitnessApp';
import './JumpingJackGame.scss';

const TARGET_SCORE = 10;
const GAME_DURATION = 60; // seconds

const JumpingJackGame = ({ mode, onClose, config, onMount }) => {
  const {
    participants,
    getUserVitals,
    reportGovernanceMetric,
    emitAppEvent,
    logAppEvent,
    registerLifecycle
  } = useFitnessApp('jumping_jack_game');
  
  const [gameState, setGameState] = useState('ready'); // ready, playing, complete
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [activeUser, setActiveUser] = useState(null);
  
  // Signal loaded
  useEffect(() => {
    onMount?.();
    logAppEvent('game_loaded', { mode });
  }, [onMount, logAppEvent, mode]);
  
  // Game timer
  useEffect(() => {
    if (gameState !== 'playing') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleGameEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameState]);
  
  // Heart rate spike detection (simplified)
  useEffect(() => {
    if (gameState !== 'playing' || !activeUser) return;
    
    const checkHeartRate = () => {
      const vitals = getUserVitals(activeUser);
      const hr = vitals?.heartRate || 0;
      const baseline = vitals?.baselineHr || 80;
      
      // Detect "jump" as HR spike above threshold
      if (hr > baseline * 1.3) {
        setScore(prev => prev + 1);
        emitAppEvent('game:score', { score: score + 1, userId: activeUser, gameId: 'jumping_jack_game' }, 'jumping_jack_game');
      }
    };
    
    const interval = setInterval(checkHeartRate, 500);
    return () => clearInterval(interval);
  }, [gameState, activeUser, getUserVitals, score, emitAppEvent]);
  
  const handleStart = useCallback((userId) => {
    setActiveUser(userId);
    setGameState('playing');
    setScore(0);
    setTimeLeft(GAME_DURATION);
    logAppEvent('game_started', { userId });
  }, [logAppEvent]);
  
  const handleGameEnd = useCallback(() => {
    setGameState('complete');
    logAppEvent('game_ended', { score, userId: activeUser });
    
    // Report to governance
    reportGovernanceMetric({
      type: score >= TARGET_SCORE ? 'completion' : 'score',
      value: score,
      userId: activeUser,
      metadata: { target: TARGET_SCORE, achieved: score >= TARGET_SCORE }
    });
    
    // Emit completion event
    emitAppEvent('game:complete', {
      gameId: 'jumping_jack_game',
      score,
      userId: activeUser,
      result: score >= TARGET_SCORE ? 'success' : 'partial'
    }, 'jumping_jack_game');
  }, [score, activeUser, reportGovernanceMetric, emitAppEvent, logAppEvent]);
  
  return (
    <div className={`jumping-jack-game mode-${mode}`}>
      {gameState === 'ready' && (
        <div className="game-ready">
          <h2>🏃 Jumping Jacks Challenge</h2>
          <p>Complete {TARGET_SCORE} jumping jacks in {GAME_DURATION} seconds!</p>
          <div className="player-select">
            {participants.map(p => (
              <button key={p.id} onClick={() => handleStart(p.id)}>
                {p.displayLabel || p.id}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {gameState === 'playing' && (
        <div className="game-playing">
          <div className="game-timer">{timeLeft}s</div>
          <div className="game-score">{score} / {TARGET_SCORE}</div>
          <div className="game-instruction">Jump!</div>
          <div className="progress-bar">
            <div className="progress" style={{ width: `${(score / TARGET_SCORE) * 100}%` }} />
          </div>
        </div>
      )}
      
      {gameState === 'complete' && (
        <div className="game-complete">
          <h2>{score >= TARGET_SCORE ? '🎉 Success!' : '💪 Good try!'}</h2>
          <div className="final-score">Score: {score} / {TARGET_SCORE}</div>
          <button onClick={onClose}>
            {score >= TARGET_SCORE ? 'Continue' : 'Close'}
          </button>
        </div>
      )}
    </div>
  );
};

export default JumpingJackGame;
```

#### 5.3 Create Index and Styles
```javascript
// FitnessApps/apps/JumpingJackGame/index.jsx
export { default } from './JumpingJackGame';
export { default as manifest } from './manifest';
```

```scss
// FitnessApps/apps/JumpingJackGame/JumpingJackGame.scss
.jumping-jack-game {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  
  .game-timer { font-size: 48px; font-weight: bold; }
  .game-score { font-size: 36px; margin: 16px 0; }
  .progress-bar { width: 100%; height: 20px; background: #333; border-radius: 10px; }
  .progress { height: 100%; background: var(--fitness-zone-active-color); border-radius: 10px; transition: width 0.3s; }
  
  button {
    padding: 12px 24px;
    font-size: 18px;
    border-radius: 8px;
    background: var(--fitness-accent-color);
    border: none;
    cursor: pointer;
    margin: 8px;
  }
}
```

#### 5.4 Register App
```javascript
// In FitnessApps/index.js
import * as JumpingJackGame from './apps/JumpingJackGame';
registerApp(JumpingJackGame);
```

**Phase 5 Deliverables:**
- [ ] `FitnessApps/apps/JumpingJackGame/manifest.js`
- [ ] `FitnessApps/apps/JumpingJackGame/index.jsx`
- [ ] `FitnessApps/apps/JumpingJackGame/JumpingJackGame.jsx`
- [ ] `FitnessApps/apps/JumpingJackGame/JumpingJackGame.scss`
- [ ] Registered in `FitnessApps/index.js`
- [ ] Test: Launch as standalone from menu
- [ ] Test: Launch as overlay during video
- [ ] Test: Score events received by chart app
- [ ] Test: Completion satisfies governance challenge

---

### Phase 6: Polish & Documentation

**Goal:** Production-ready quality with accessibility and developer docs.

#### 6.1 CSS Transitions & Animations
```scss
// FitnessAppContainer.scss additions
.fitness-app-container {
  animation: appFadeIn 0.2s ease-out;
  
  &.mode-overlay {
    animation: appSlideIn 0.3s ease-out;
  }
}

@keyframes appFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes appSlideIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
```

#### 6.2 Accessibility Audit
- [ ] Add `role="dialog"` and `aria-modal="true"` to overlay container
- [ ] Implement focus trap for overlay apps
- [ ] Add `aria-label` to app header and close buttons
- [ ] Ensure keyboard navigation (Escape to close)
- [ ] Test with screen reader

#### 6.3 Settings Reset UI
```jsx
// Add to FitnessAppMenu.jsx
import { useAppStorage } from './useAppStorage';

const FitnessAppMenu = ({ ... }) => {
  const { clearAll } = useAppStorage('_menu');
  const [showSettings, setShowSettings] = useState(false);
  
  const handleResetAll = () => {
    if (confirm('Reset all app settings? This cannot be undone.')) {
      clearAll();
      setShowSettings(false);
    }
  };
  
  return (
    <div className="fitness-app-menu">
      <div className="app-menu-header">
        {/* ... */}
        <button onClick={() => setShowSettings(true)} className="settings-btn">⚙️</button>
      </div>
      
      {showSettings && (
        <div className="settings-panel">
          <h3>App Settings</h3>
          <button onClick={handleResetAll} className="reset-btn">
            Reset All App Settings
          </button>
          <button onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
      {/* ... */}
    </div>
  );
};
```

#### 6.4 Developer Documentation
Create `FitnessApps/CONTRIBUTING.md`:
```markdown
# Creating a New Fitness App

## Quick Start
1. Create folder: `FitnessApps/apps/YourAppName/`
2. Create files: `manifest.js`, `index.jsx`, `YourAppName.jsx`, `YourAppName.scss`
3. Register in `FitnessApps/index.js`

## Manifest Required Fields
- `id`: Unique string matching config.yml
- `name`: Display name
- `version`: Semver string
- `modes`: Object with boolean flags for each mode

## Using useFitnessApp Hook
```jsx
const { participants, getUserVitals, emitAppEvent } = useFitnessApp('your_app_id');
```

## Lifecycle Events
Register callbacks via `registerLifecycle({ onPause, onResume, onSessionEnd })`.

## Testing
1. Add app to config.yml `app_menus`
2. Navigate to Apps collection
3. Test all supported modes
```

#### 6.5 Unit Tests
```javascript
// FitnessApps/__tests__/useFitnessApp.test.js
import { renderHook, act } from '@testing-library/react';
import { useFitnessApp } from '../useFitnessApp';
import { FitnessProvider } from '../../../context/FitnessContext';

describe('useFitnessApp', () => {
  it('returns session data', () => {
    const wrapper = ({ children }) => <FitnessProvider>{children}</FitnessProvider>;
    const { result } = renderHook(() => useFitnessApp('test_app'), { wrapper });
    
    expect(result.current.sessionActive).toBe(false);
    expect(result.current.participants).toEqual([]);
  });
  
  it('registers lifecycle callbacks', () => {
    const wrapper = ({ children }) => <FitnessProvider>{children}</FitnessProvider>;
    const { result } = renderHook(() => useFitnessApp('test_app'), { wrapper });
    
    const onPause = jest.fn();
    act(() => {
      result.current.registerLifecycle({ onPause });
    });
    
    // Simulate video pause...
  });
});
```

**Phase 6 Deliverables:**
- [ ] CSS transitions for app mount/unmount
- [ ] Overlay fade/slide animations
- [ ] Focus trap implementation for overlays
- [ ] ARIA attributes on all interactive elements
- [ ] Keyboard navigation (Escape to close)
- [ ] Settings panel with reset option
- [ ] `FitnessApps/CONTRIBUTING.md`
- [ ] Unit tests for `useFitnessApp`
- [ ] Unit tests for `useAppStorage`
- [ ] Unit tests for `FitnessAppErrorBoundary`
- [ ] Integration test: Full app lifecycle

---

## Future Enhancements

### Config.yml Evolution (Future)

```yaml
plex:
  app_menus:
    - id: app_menu1
      name: Fitness Apps
      items:
        - id: fitness_chart
          name: Fitness Chart
          category: tools
          
        - id: jumping_jack_game
          name: Jumping Jacks
          category: games
          conditions:
            - users: [felix, milo, alan, soren]  # Kids only
            - session_active: true
          config:
            difficulty: easy
            target_reps: 10
```

### Additional App Ideas

| App | Mode Support | Description |
|-----|--------------|-------------|
| Heart Zone Trainer | standalone, overlay | Guided heart rate zone training |
| Workout Timer | overlay, mini | Interval timer with audio cues |
| Achievement Board | standalone, sidebar | Session achievements and badges |
| Leaderboard | standalone, overlay | Multi-user competition display |
| Form Coach | overlay | Pose detection feedback (future) |

---

## References

- [FitnessMenu.jsx](../FitnessMenu.jsx) - Existing media menu pattern
- [FitnessCamStage.jsx](../FitnessCamStage.jsx) - Webcam component to convert
- [FitnessChart.jsx](../FitnessSidebar/FitnessChart.jsx) - Chart component to convert
- [FitnessPlayerOverlay.jsx](../FitnessPlayerOverlay.jsx) - Overlay integration target
- [FitnessContext.jsx](../../../context/FitnessContext.jsx) - Shared state management
- [config.yml](/data/households/default/apps/fitness/config.yml) - App menu configuration
