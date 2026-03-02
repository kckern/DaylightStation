# Screen Framework Phase 4: Overlays, Subscriptions & Input Wiring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire numpad input and WebSocket events to overlays so Menu, Player, and Piano launch from `/screen/office`.

**Architecture:** Upgrade ScreenOverlayProvider to three render slots (fullscreen/pip/toast). Create ScreenActionHandler to bridge ActionBus → overlays. Add WS subscription processing to ScreenRenderer from YAML config.

**Tech Stack:** React context, ActionBus, useWebSocketSubscription, MenuStack, Player, PianoVisualizer

---

## Context

**Design doc:** `docs/plans/2026-03-02-screen-framework-phase4-design.md`

**Key existing files:**
- `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx` — current single-overlay provider
- `frontend/src/screen-framework/ScreenRenderer.jsx` — main entry, fetches config, mounts providers
- `frontend/src/screen-framework/input/ActionBus.js` — event bus singleton
- `frontend/src/screen-framework/input/useScreenAction.js` — widget subscription hook
- `frontend/src/screen-framework/input/actionMap.js` — action translations
- `frontend/src/screen-framework/widgets/builtins.js` — widget registry registrations
- `frontend/src/modules/Menu/MenuStack.jsx` — menu navigation controller
- `frontend/src/modules/Player/Player.jsx` — media player (forwardRef)
- `frontend/src/modules/Piano/index.js` — exports PianoVisualizer
- `frontend/src/hooks/useWebSocket.js` — `useWebSocketSubscription(filter, callback, deps)`
- `data/household/screens/office.yml` — office screen YAML config (on Dropbox at `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/screens/office.yml`)

**Testing:** Vitest + React Testing Library. Run tests with `npx vitest run <path>`.

---

### Task 1: Upgrade ScreenOverlayProvider to Three Slots

**Files:**
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx`
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.css`
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx`

**Step 1: Write failing tests**

Add these tests to the existing test file `frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx`:

```jsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScreenOverlayProvider, useScreenOverlay } from './ScreenOverlayProvider.jsx';

// Helper to access overlay API
function TestHarness({ onApi }) {
  const api = useScreenOverlay();
  onApi(api);
  return <div data-testid="dashboard">Dashboard</div>;
}

describe('ScreenOverlayProvider - Phase 4', () => {
  it('supports fullscreen mode (default)', () => {
    let api;
    render(
      <ScreenOverlayProvider>
        <TestHarness onApi={a => api = a} />
      </ScreenOverlayProvider>
    );
    act(() => api.showOverlay(() => <div data-testid="fs">Fullscreen</div>, {}));
    expect(screen.getByTestId('fs')).toBeTruthy();
    expect(screen.getByTestId('dashboard')).toBeTruthy();
  });

  it('supports pip mode alongside fullscreen', () => {
    let api;
    render(
      <ScreenOverlayProvider>
        <TestHarness onApi={a => api = a} />
      </ScreenOverlayProvider>
    );
    act(() => api.showOverlay(() => <div data-testid="fs">FS</div>, {}));
    act(() => api.showOverlay(() => <div data-testid="pip">PIP</div>, {}, { mode: 'pip', position: 'top-right' }));
    expect(screen.getByTestId('fs')).toBeTruthy();
    expect(screen.getByTestId('pip')).toBeTruthy();
  });

  it('supports toast mode with auto-dismiss', async () => {
    let api;
    render(
      <ScreenOverlayProvider>
        <TestHarness onApi={a => api = a} />
      </ScreenOverlayProvider>
    );
    act(() => api.showOverlay(() => <div data-testid="toast1">Toast</div>, {}, { mode: 'toast', timeout: 100 }));
    expect(screen.getByTestId('toast1')).toBeTruthy();
    // After timeout, toast should be gone
    await act(async () => await new Promise(r => setTimeout(r, 150)));
    expect(screen.queryByTestId('toast1')).toBeNull();
  });

  it('dismissOverlay targets specific mode', () => {
    let api;
    render(
      <ScreenOverlayProvider>
        <TestHarness onApi={a => api = a} />
      </ScreenOverlayProvider>
    );
    act(() => api.showOverlay(() => <div data-testid="fs">FS</div>, {}));
    act(() => api.showOverlay(() => <div data-testid="pip">PIP</div>, {}, { mode: 'pip' }));
    act(() => api.dismissOverlay('pip'));
    expect(screen.getByTestId('fs')).toBeTruthy();
    expect(screen.queryByTestId('pip')).toBeNull();
  });

  it('high priority fullscreen replaces existing fullscreen', () => {
    let api;
    render(
      <ScreenOverlayProvider>
        <TestHarness onApi={a => api = a} />
      </ScreenOverlayProvider>
    );
    act(() => api.showOverlay(() => <div data-testid="player">Player</div>, {}));
    act(() => api.showOverlay(() => <div data-testid="piano">Piano</div>, {}, { mode: 'fullscreen', priority: 'high' }));
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByTestId('piano')).toBeTruthy();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx`
Expected: FAIL — current API doesn't accept mode/position/priority options.

**Step 3: Implement the three-slot overlay provider**

Replace `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx`:

```jsx
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import './ScreenOverlayProvider.css';

const ScreenOverlayContext = createContext(null);

export function ScreenOverlayProvider({ children }) {
  const [fullscreen, setFullscreen] = useState(null);
  const [pip, setPip] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const showOverlay = useCallback((Component, props = {}, options = {}) => {
    const { mode = 'fullscreen', position, priority, timeout } = options;

    if (mode === 'fullscreen') {
      setFullscreen(prev => {
        if (prev && priority !== 'high') return prev;
        return { Component, props };
      });
    } else if (mode === 'pip') {
      setPip({ Component, props, position: position || 'top-right' });
    } else if (mode === 'toast') {
      const id = ++toastIdRef.current;
      setToasts(prev => [...prev, { id, Component, props, timeout: timeout || 5000 }]);
    }
  }, []);

  const dismissOverlay = useCallback((mode = 'fullscreen') => {
    if (mode === 'fullscreen') setFullscreen(null);
    else if (mode === 'pip') setPip(null);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ScreenOverlayContext.Provider value={{
      showOverlay,
      dismissOverlay,
      hasOverlay: fullscreen !== null,
    }}>
      {children}

      {fullscreen && (
        <div className="screen-overlay-layer screen-overlay--fullscreen">
          <fullscreen.Component {...fullscreen.props} dismiss={() => dismissOverlay('fullscreen')} />
        </div>
      )}

      {pip && (
        <div className={`screen-overlay-layer screen-overlay--pip screen-overlay--pip-${pip.position}`}>
          <pip.Component {...pip.props} dismiss={() => dismissOverlay('pip')} />
        </div>
      )}

      {toasts.length > 0 && (
        <div className="screen-overlay-layer screen-overlay--toast-stack">
          {toasts.map(toast => (
            <ToastWrapper key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ScreenOverlayContext.Provider>
  );
}

function ToastWrapper({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.timeout);
    return () => clearTimeout(timer);
  }, [toast.id, toast.timeout, onDismiss]);

  return (
    <div className="screen-overlay--toast">
      <toast.Component {...toast.props} dismiss={() => onDismiss(toast.id)} />
    </div>
  );
}

export function useScreenOverlay() {
  const ctx = useContext(ScreenOverlayContext);
  if (!ctx) {
    return {
      showOverlay: () => {},
      dismissOverlay: () => {},
      hasOverlay: false,
    };
  }
  return ctx;
}
```

**Step 4: Update CSS**

Replace `frontend/src/screen-framework/overlays/ScreenOverlayProvider.css`:

```css
.screen-overlay--fullscreen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1000;
}

.screen-overlay--pip {
  position: absolute;
  z-index: 1001;
  width: 320px;
  height: 240px;
}

.screen-overlay--pip-top-right { top: 1rem; right: 1rem; }
.screen-overlay--pip-top-left { top: 1rem; left: 1rem; }
.screen-overlay--pip-bottom-right { bottom: 1rem; right: 1rem; }
.screen-overlay--pip-bottom-left { bottom: 1rem; left: 1rem; }

.screen-overlay--toast-stack {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  z-index: 1002;
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
  pointer-events: none;
}

.screen-overlay--toast {
  pointer-events: auto;
  max-width: 320px;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx`
Expected: PASS (all tests)

**Step 6: Commit**

```bash
git add frontend/src/screen-framework/overlays/
git commit -m "feat(screen-framework): upgrade overlay provider to three slots (fullscreen/pip/toast)"
```

---

### Task 2: Create ScreenActionHandler

**Files:**
- Create: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Create: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

**Step 1: Write failing tests**

Create `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`:

```jsx
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActionBus, resetActionBus } from '../input/ActionBus.js';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';
import { ScreenActionHandler } from './ScreenActionHandler.jsx';

// Mock MenuStack
vi.mock('../../modules/Menu/MenuStack.jsx', () => ({
  MenuStack: (props) => <div data-testid="menu-stack" data-menu={props.rootMenu}>MenuStack</div>,
}));

describe('ScreenActionHandler', () => {
  beforeEach(() => {
    resetActionBus();
  });

  it('opens MenuStack overlay on menu:open action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
        <div data-testid="dashboard">Dashboard</div>
      </ScreenOverlayProvider>
    );
    expect(queryByTestId('menu-stack')).toBeNull();
    act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
    expect(getByTestId('menu-stack')).toBeTruthy();
    expect(getByTestId('menu-stack').dataset.menu).toBe('music');
  });

  it('dismisses overlay on escape action when no overlay', () => {
    const { queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    // Should not throw
    act(() => getActionBus().emit('escape', {}));
    expect(queryByTestId('menu-stack')).toBeNull();
  });

  it('dismisses fullscreen overlay on escape action', () => {
    const { getByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    act(() => getActionBus().emit('menu:open', { menuId: 'tv' }));
    expect(getByTestId('menu-stack')).toBeTruthy();
    act(() => getActionBus().emit('escape', {}));
    expect(queryByTestId('menu-stack')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: FAIL — file doesn't exist.

**Step 3: Implement ScreenActionHandler**

Create `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`:

```jsx
import { useCallback } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from '../widgets/registry.js';
import { MenuStack } from '../../modules/Menu/MenuStack.jsx';
import Player from '../../modules/Player/Player.jsx';

export function ScreenActionHandler() {
  const { showOverlay, dismissOverlay } = useScreenOverlay();

  const handleMenuOpen = useCallback((payload) => {
    showOverlay(MenuStack, {
      rootMenu: payload.menuId,
    });
  }, [showOverlay]);

  const handleMediaPlay = useCallback((payload) => {
    showOverlay(Player, {
      play: payload.contentId,
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  const handleMediaQueue = useCallback((payload) => {
    showOverlay(Player, {
      queue: [payload.contentId],
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  const handleEscape = useCallback(() => {
    dismissOverlay();
  }, [dismissOverlay]);

  const handlePlayback = useCallback(() => {
    // No-op at handler level. Player subscribes directly via useScreenAction.
  }, []);

  useScreenAction('menu:open', handleMenuOpen);
  useScreenAction('media:play', handleMediaPlay);
  useScreenAction('media:queue', handleMediaQueue);
  useScreenAction('escape', handleEscape);
  useScreenAction('media:playback', handlePlayback);

  return null; // Renderless component
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/actions/
git commit -m "feat(screen-framework): add ScreenActionHandler bridging ActionBus to overlays"
```

---

### Task 3: Mount ScreenActionHandler in ScreenRenderer

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

**Step 1: Import and mount ScreenActionHandler**

In `frontend/src/screen-framework/ScreenRenderer.jsx`, add import:

```jsx
import { ScreenActionHandler } from './actions/ScreenActionHandler.jsx';
```

Then inside the `ScreenOverlayProvider`, add `<ScreenActionHandler />` before `<PanelRenderer>`:

```jsx
<ScreenOverlayProvider>
  <ScreenActionHandler />
  <PanelRenderer node={config.layout} />
</ScreenOverlayProvider>
```

**Step 2: Verify build**

Run: `cd frontend && npx vite build`
Expected: Build succeeds.

**Step 3: Manual test**

Open `http://localhost:3111/screen/office`, press a numpad key mapped to `menu` (e.g., key `c` for scripture). MenuStack should appear as fullscreen overlay. Press escape (key `4`) to dismiss.

**Step 4: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen-framework): mount ScreenActionHandler in ScreenRenderer"
```

---

### Task 4: Add WS Subscription Processing to ScreenRenderer

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`
- Create: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- Create: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.test.jsx`

**Step 1: Write failing test**

Create `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.test.jsx`:

```jsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScreenSubscriptions } from './useScreenSubscriptions.js';

// Mock useWebSocketSubscription
const mockSubscriptions = {};
vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, callback) => {
    mockSubscriptions[filter] = callback;
  },
}));

describe('useScreenSubscriptions', () => {
  beforeEach(() => {
    Object.keys(mockSubscriptions).forEach(k => delete mockSubscriptions[k]);
  });

  it('subscribes to topics declared in config', () => {
    const showOverlay = vi.fn();
    const dismissOverlay = vi.fn();
    const registry = { get: vi.fn(() => () => null) };
    const subscriptions = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen', priority: 'high' },
      },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, { showOverlay, dismissOverlay }, registry));
    expect(mockSubscriptions['midi']).toBeDefined();
  });

  it('filters by on.event when present', () => {
    const showOverlay = vi.fn();
    const dismissOverlay = vi.fn();
    const PianoMock = () => null;
    const registry = { get: vi.fn(() => PianoMock) };
    const subscriptions = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen', priority: 'high' },
      },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, { showOverlay, dismissOverlay }, registry));

    // Wrong event — should not trigger
    act(() => mockSubscriptions['midi']({ topic: 'midi', type: 'note', data: { event: 'note_on' } }));
    expect(showOverlay).not.toHaveBeenCalled();

    // Correct event — should trigger
    act(() => mockSubscriptions['midi']({ topic: 'midi', type: 'session', data: { event: 'session_start' } }));
    expect(showOverlay).toHaveBeenCalledWith(
      PianoMock,
      expect.objectContaining({ wsData: expect.any(Object) }),
      expect.objectContaining({ mode: 'fullscreen', priority: 'high' }),
    );
  });

  it('triggers on any message when no on.event filter', () => {
    const showOverlay = vi.fn();
    const dismissOverlay = vi.fn();
    const DoorbellMock = () => null;
    const registry = { get: vi.fn(() => DoorbellMock) };
    const subscriptions = {
      doorbell: {
        response: { overlay: 'doorbell-camera', mode: 'pip', position: 'top-right' },
        dismiss: { timeout: 30 },
      },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, { showOverlay, dismissOverlay }, registry));
    act(() => mockSubscriptions['doorbell']({ topic: 'doorbell', data: {} }));
    expect(showOverlay).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/screen-framework/subscriptions/useScreenSubscriptions.test.jsx`
Expected: FAIL — file doesn't exist.

**Step 3: Implement useScreenSubscriptions hook**

Create `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`:

```js
import { useCallback, useEffect, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';

export function useScreenSubscriptions(subscriptions, overlayApi, registry) {
  if (!subscriptions) return;

  const entries = Object.entries(subscriptions);

  for (const [topic, config] of entries) {
    useScreenSubscription(topic, config, overlayApi, registry);
  }
}

function useScreenSubscription(topic, config, { showOverlay, dismissOverlay }, registry) {
  const dismissTimerRef = useRef(null);
  const inactivityTimerRef = useRef(null);

  const handler = useCallback((data) => {
    const { on, response, dismiss } = config;

    // Check dismiss event
    if (dismiss?.event && data.data?.event === dismiss.event) {
      dismissOverlay(response.mode || 'fullscreen');
      return;
    }

    // Check trigger filter
    if (on?.event) {
      const eventMatch = data.data?.event === on.event || data.type === on.event;
      if (!eventMatch) return;
    }

    // Resolve overlay component
    const Component = registry.get(response.overlay);
    if (!Component) return;

    // Show overlay
    showOverlay(
      Component,
      { wsData: data, dismiss: () => dismissOverlay(response.mode || 'fullscreen') },
      {
        mode: response.mode || 'fullscreen',
        position: response.position,
        priority: response.priority,
      }
    );

    // Set up dismiss timeout
    if (dismiss?.timeout) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        dismissOverlay(response.mode || 'fullscreen');
      }, dismiss.timeout * 1000);
    }

    // Set up inactivity timer (resets on each message)
    if (dismiss?.inactivity) {
      clearTimeout(inactivityTimerRef.current);
      const ms = typeof dismiss.inactivity === 'string'
        ? parseInt(dismiss.inactivity) * 1000
        : dismiss.inactivity * 1000;
      inactivityTimerRef.current = setTimeout(() => {
        dismissOverlay(response.mode || 'fullscreen');
      }, ms);
    }
  }, [config, showOverlay, dismissOverlay, registry]);

  useWebSocketSubscription(topic, handler, [handler]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearTimeout(dismissTimerRef.current);
      clearTimeout(inactivityTimerRef.current);
    };
  }, []);
}
```

**Step 4: Wire into ScreenRenderer**

In `frontend/src/screen-framework/ScreenRenderer.jsx`, add import:

```jsx
import { useScreenSubscriptions } from './subscriptions/useScreenSubscriptions.js';
```

Inside the ScreenRenderer component, after the overlay provider setup, add a new component `ScreenSubscriptionHandler` that lives inside the overlay provider:

```jsx
function ScreenSubscriptionHandler({ subscriptions }) {
  const overlayApi = useScreenOverlay();
  const registry = getWidgetRegistry();
  useScreenSubscriptions(subscriptions, overlayApi, registry);
  return null;
}
```

Mount it inside `ScreenOverlayProvider`:

```jsx
<ScreenOverlayProvider>
  <ScreenActionHandler />
  <ScreenSubscriptionHandler subscriptions={config.subscriptions} />
  <PanelRenderer node={config.layout} />
</ScreenOverlayProvider>
```

**Step 5: Run tests**

Run: `npx vitest run frontend/src/screen-framework/subscriptions/useScreenSubscriptions.test.jsx`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/screen-framework/subscriptions/ frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen-framework): add WS subscription processing from YAML config"
```

---

### Task 5: Register Overlay Components

**Files:**
- Modify: `frontend/src/screen-framework/widgets/builtins.js`

**Step 1: Add overlay component registrations**

In `frontend/src/screen-framework/widgets/builtins.js`, add imports and registrations:

```jsx
import { PianoVisualizer } from '../../modules/Piano/index.js';
```

Add registration inside `registerBuiltinWidgets()`:

```jsx
registry.register('piano', PianoVisualizer);
```

Don't register `doorbell-camera` or `toast` yet — those components don't exist and aren't needed for the office screen.

**Step 2: Verify build**

Run: `cd frontend && npx vite build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/widgets/builtins.js
git commit -m "feat(screen-framework): register PianoVisualizer in widget registry"
```

---

### Task 6: Add Subscriptions to office.yml

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/screens/office.yml`

**Step 1: Add subscriptions section**

Append to the end of office.yml:

```yaml
subscriptions:
  midi:
    on:
      event: session_start
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```

**Step 2: Verify API serves it**

Run: `curl -s http://localhost:3112/api/v1/screens/office | python3 -c "import sys,json; d=json.load(sys.stdin); print('subscriptions:', d.get('subscriptions', 'MISSING'))"`
Expected: Shows the subscriptions object.

**Step 3: Commit**

```bash
git add /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/screens/office.yml
git commit -m "feat(screen-framework): add MIDI subscription to office screen config"
```

---

### Task 7: Update Barrel Exports

**Files:**
- Modify: `frontend/src/screen-framework/index.js`

**Step 1: Add new exports**

Add to `frontend/src/screen-framework/index.js`:

```js
// Actions
export { ScreenActionHandler } from './actions/ScreenActionHandler.jsx';

// Subscriptions
export { useScreenSubscriptions } from './subscriptions/useScreenSubscriptions.js';
```

Update version to `0.3.0`.

**Step 2: Commit**

```bash
git add frontend/src/screen-framework/index.js
git commit -m "refactor(screen-framework): update barrel exports for v0.3.0"
```

---

### Task 8: Update Reference Docs

**Files:**
- Modify: `docs/reference/core/screen-framework.md`

**Step 1: Update the reference doc**

Update the status line to reflect Phase 4 completion. Update the overlay system section to document three render modes. Add the subscriptions section with YAML examples. Add ScreenActionHandler to the architecture diagram and file tree.

**Step 2: Commit**

```bash
git add docs/reference/core/screen-framework.md
git commit -m "docs: update screen framework reference for Phase 4"
```

---

### Task 9: Smoke Test

**Step 1: Build**

Run: `cd frontend && npx vite build`
Expected: Build succeeds with no errors.

**Step 2: Manual verification**

Open `http://localhost:3111/screen/office` in browser:

1. Press numpad key `c` (scripture menu) → MenuStack should appear as fullscreen overlay
2. Press numpad key `4` (escape) → overlay should dismiss, dashboard visible
3. Press numpad key `h` (movie menu) → movie MenuStack should appear
4. Select a menu item → Player should launch within the overlay
5. Press numpad key `4` (escape) → should return to dashboard

If MIDI keyboard is available:
6. Start playing → PianoVisualizer should appear as fullscreen overlay
7. Stop playing → after 30s inactivity, overlay should auto-dismiss

**Step 3: Screenshot**

```bash
npx playwright screenshot --viewport-size="1280,720" --wait-for-timeout=3000 http://localhost:3111/screen/office /tmp/phase4-smoke.png
```
