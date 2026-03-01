# Screen Framework Phase 3: Office Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat grid layout with a recursive flex panel system, coordinated data fetching, and CSS custom property theming — all under `/screen/office`.

**Architecture:** YAML config drives a recursive `PanelRenderer` (flexbox tree), a `ScreenDataProvider` (deduplicates API calls), and a simplified widget registry (name→component map). Theme via `--screen-*` CSS variables.

**Tech Stack:** React, CSS custom properties, vitest

**Design doc:** `docs/plans/2026-03-01-screen-framework-phase3-design.md`

---

### Task 1: Create ScreenDataProvider

The coordinated data layer. Fetches each declared data source once, refreshes on interval, distributes via React context.

**Files:**
- Create: `frontend/src/screen-framework/data/ScreenDataProvider.jsx`
- Test: `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`

**Step 1: Write the failing test**

```jsx
// frontend/src/screen-framework/data/ScreenDataProvider.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ScreenDataProvider, useScreenData } from './ScreenDataProvider.jsx';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function wrapper(sources) {
  return ({ children }) => (
    <ScreenDataProvider sources={sources}>{children}</ScreenDataProvider>
  );
}

describe('ScreenDataProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides fetched data via useScreenData hook', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ temp: 72 }),
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    const { result } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });

    expect(result.current).toBeNull(); // initially null

    await waitFor(() => {
      expect(result.current).toEqual({ temp: 72 });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/home/weather');
  });

  it('deduplicates calls when two widgets use the same source key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ temp: 72 }),
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    const { result: r1 } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });
    const { result: r2 } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });

    await waitFor(() => {
      expect(r1.current).toEqual({ temp: 72 });
      expect(r2.current).toEqual({ temp: 72 });
    });

    // Only one fetch, not two
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown data key', () => {
    const sources = {};
    const { result } = renderHook(() => useScreenData('nonexistent'), {
      wrapper: wrapper(sources),
    });

    expect(result.current).toBeNull();
  });

  it('refreshes data on interval', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ temp: 70 + callCount }),
      });
    });

    const sources = {
      weather: { source: '/api/v1/home/weather', refresh: 60 },
    };

    const { result } = renderHook(() => useScreenData('weather'), {
      wrapper: wrapper(sources),
    });

    await waitFor(() => {
      expect(result.current).toEqual({ temp: 71 });
    });

    // Advance past refresh interval (60 seconds)
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    await waitFor(() => {
      expect(result.current).toEqual({ temp: 72 });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`
Expected: FAIL — module not found

**Step 3: Write implementation**

```jsx
// frontend/src/screen-framework/data/ScreenDataProvider.jsx
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const ScreenDataContext = createContext({});

/**
 * ScreenDataProvider - Fetches declared data sources once, refreshes on interval,
 * distributes via context. Two widgets referencing the same key share one fetch.
 *
 * @param {Object} props.sources - { [key]: { source: string, refresh: number (seconds) } }
 */
export function ScreenDataProvider({ sources = {}, children }) {
  const [store, setStore] = useState({});
  const intervalsRef = useRef([]);

  useEffect(() => {
    const entries = Object.entries(sources);
    if (entries.length === 0) return;

    const fetchSource = async (key, url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setStore(prev => ({ ...prev, [key]: data }));
      } catch {
        // silent — widget shows its own loading/error state
      }
    };

    // Initial fetch for all sources
    entries.forEach(([key, { source }]) => fetchSource(key, source));

    // Set up refresh intervals
    const ids = entries
      .filter(([, { refresh }]) => refresh)
      .map(([key, { source, refresh }]) =>
        setInterval(() => fetchSource(key, source), refresh * 1000)
      );
    intervalsRef.current = ids;

    return () => ids.forEach(clearInterval);
  }, [sources]);

  return (
    <ScreenDataContext.Provider value={store}>
      {children}
    </ScreenDataContext.Provider>
  );
}

/**
 * useScreenData - Consume a coordinated data source by key.
 * Returns the fetched data or null if not yet available.
 */
export function useScreenData(key) {
  const store = useContext(ScreenDataContext);
  return store[key] ?? null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/data/ScreenDataProvider.jsx frontend/src/screen-framework/data/ScreenDataProvider.test.jsx
git commit -m "feat(screen-framework): add ScreenDataProvider with coordinated data fetching"
```

---

### Task 2: Simplify Widget Registry

Replace the lazy-loading metadata registry with a direct name→component map. Register all dashboard widgets.

**Files:**
- Modify: `frontend/src/screen-framework/widgets/registry.js`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`
- Modify: `frontend/src/screen-framework/widgets/registry.test.js`

**Step 1: Update the test to match the new simpler API**

The registry drops metadata — it's just `register(name, component)` and `get(name)`.

```js
// frontend/src/screen-framework/widgets/registry.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from './registry.js';

const MockClock = () => 'clock';
const MockWeather = () => 'weather';

describe('WidgetRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it('should register and retrieve a widget', () => {
    registry.register('clock', MockClock);

    expect(registry.has('clock')).toBe(true);
    expect(registry.get('clock')).toBe(MockClock);
  });

  it('should return null for unregistered widget', () => {
    expect(registry.get('nonexistent')).toBe(null);
  });

  it('should list all registered widget names', () => {
    registry.register('clock', MockClock);
    registry.register('weather', MockWeather);

    const names = registry.list();

    expect(names).toContain('clock');
    expect(names).toContain('weather');
    expect(names.length).toBe(2);
  });

  it('should clear all registrations', () => {
    registry.register('clock', MockClock);
    registry.clear();

    expect(registry.has('clock')).toBe(false);
    expect(registry.list().length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails (metadata test gone)**

Run: `npx vitest run frontend/src/screen-framework/widgets/registry.test.js`
Expected: PASS — the simplified tests should still pass against the old registry since we're removing tests, not adding incompatible ones. But run to confirm.

**Step 3: Simplify registry.js**

```js
// frontend/src/screen-framework/widgets/registry.js
/**
 * WidgetRegistry - Simple name→component map for screen framework widgets
 */
export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
  }

  register(name, component) {
    this.widgets.set(name, component);
  }

  has(name) {
    return this.widgets.has(name);
  }

  get(name) {
    return this.widgets.get(name) || null;
  }

  list() {
    return Array.from(this.widgets.keys());
  }

  clear() {
    this.widgets.clear();
  }
}

// Singleton
let defaultRegistry = null;

export function getWidgetRegistry() {
  if (!defaultRegistry) {
    defaultRegistry = new WidgetRegistry();
  }
  return defaultRegistry;
}

export function resetWidgetRegistry() {
  defaultRegistry = null;
}
```

**Step 4: Rewrite builtins.js with direct imports**

```js
// frontend/src/screen-framework/widgets/builtins.js
/**
 * Built-in widget registrations — direct component imports
 */
import { getWidgetRegistry } from './registry.js';
import Time from '../../modules/Time/Time.jsx';
import Weather from '../../modules/Weather/Weather.jsx';
import WeatherForecast from '../../modules/Weather/WeatherForecast.jsx';
import Upcoming from '../../modules/Upcoming/Upcoming.jsx';
import { FinanceChart } from '../../modules/Finance/Finance.jsx';
import Weight from '../../modules/Health/Weight.jsx';
import EntropyPanel from '../../modules/Entropy/EntropyPanel.jsx';

export function registerBuiltinWidgets() {
  const registry = getWidgetRegistry();
  registry.register('clock', Time);
  registry.register('weather', Weather);
  registry.register('weather-forecast', WeatherForecast);
  registry.register('calendar', Upcoming);
  registry.register('finance', FinanceChart);
  registry.register('health', Weight);
  registry.register('entropy', EntropyPanel);
  return registry;
}
```

**Step 5: Run tests**

Run: `npx vitest run frontend/src/screen-framework/widgets/registry.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/screen-framework/widgets/registry.js frontend/src/screen-framework/widgets/builtins.js frontend/src/screen-framework/widgets/registry.test.js
git commit -m "refactor(screen-framework): simplify widget registry to name-component map"
```

---

### Task 3: Create PanelRenderer + Theme CSS

The recursive flex layout renderer and base panel styles.

**Files:**
- Create: `frontend/src/screen-framework/panels/PanelRenderer.jsx`
- Create: `frontend/src/screen-framework/panels/PanelRenderer.css`
- Test: `frontend/src/screen-framework/panels/PanelRenderer.test.jsx`

**Step 1: Write the failing test**

```jsx
// frontend/src/screen-framework/panels/PanelRenderer.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PanelRenderer } from './PanelRenderer.jsx';

// Mock widget registry
vi.mock('../widgets/registry.js', () => {
  const MockClock = () => <div data-testid="widget-clock">Clock</div>;
  const MockWeather = () => <div data-testid="widget-weather">Weather</div>;
  const MockFinance = () => <div data-testid="widget-finance">Finance</div>;

  const widgets = new Map([
    ['clock', MockClock],
    ['weather', MockWeather],
    ['finance', MockFinance],
  ]);

  return {
    getWidgetRegistry: () => ({
      get: (name) => widgets.get(name) || null,
      has: (name) => widgets.has(name),
    }),
  };
});

describe('PanelRenderer', () => {
  it('renders a single widget leaf node', () => {
    const node = { widget: 'clock', grow: 0 };

    render(<PanelRenderer node={node} />);

    expect(screen.getByTestId('widget-clock')).toBeTruthy();
  });

  it('renders nested panels with children', () => {
    const node = {
      direction: 'row',
      gap: '1rem',
      children: [
        { widget: 'clock', grow: 0 },
        { widget: 'weather', grow: 1 },
      ],
    };

    render(<PanelRenderer node={node} />);

    expect(screen.getByTestId('widget-clock')).toBeTruthy();
    expect(screen.getByTestId('widget-weather')).toBeTruthy();
  });

  it('applies flex properties to panel container', () => {
    const node = {
      direction: 'column',
      gap: '0.5rem',
      justify: 'center',
      align: 'flex-start',
      children: [{ widget: 'clock' }],
    };

    const { container } = render(<PanelRenderer node={node} />);
    const panel = container.firstChild;

    expect(panel.style.flexDirection).toBe('column');
    expect(panel.style.gap).toBe('0.5rem');
    expect(panel.style.justifyContent).toBe('center');
    expect(panel.style.alignItems).toBe('flex-start');
  });

  it('applies flex-grow/shrink/basis to widget wrapper', () => {
    const node = { widget: 'clock', grow: 0, shrink: 0, basis: '25%' };

    const { container } = render(<PanelRenderer node={node} />);
    const wrapper = container.firstChild;

    expect(wrapper.style.flexGrow).toBe('0');
    expect(wrapper.style.flexShrink).toBe('0');
    expect(wrapper.style.flexBasis).toBe('25%');
  });

  it('renders deeply nested panels (3 levels)', () => {
    const node = {
      direction: 'row',
      children: [
        {
          direction: 'column',
          children: [
            { widget: 'clock' },
            { widget: 'weather' },
          ],
        },
        { widget: 'finance' },
      ],
    };

    render(<PanelRenderer node={node} />);

    expect(screen.getByTestId('widget-clock')).toBeTruthy();
    expect(screen.getByTestId('widget-weather')).toBeTruthy();
    expect(screen.getByTestId('widget-finance')).toBeTruthy();
  });

  it('applies per-panel theme overrides as CSS custom properties', () => {
    const node = {
      widget: 'clock',
      theme: {
        'panel-bg': 'rgba(0, 40, 0, 0.6)',
        'accent-color': '#66bb6a',
      },
    };

    const { container } = render(<PanelRenderer node={node} />);
    const wrapper = container.firstChild;

    expect(wrapper.style.getPropertyValue('--screen-panel-bg')).toBe('rgba(0, 40, 0, 0.6)');
    expect(wrapper.style.getPropertyValue('--screen-accent-color')).toBe('#66bb6a');
  });

  it('skips unregistered widgets without crashing', () => {
    const node = {
      direction: 'row',
      children: [
        { widget: 'clock' },
        { widget: 'nonexistent' },
      ],
    };

    render(<PanelRenderer node={node} />);

    expect(screen.getByTestId('widget-clock')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/panels/PanelRenderer.test.jsx`
Expected: FAIL — module not found

**Step 3: Write PanelRenderer.css**

```css
/* frontend/src/screen-framework/panels/PanelRenderer.css */

/* Base panel: pure layout, no visuals */
.screen-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
}

/* Widget panel: themed visuals via CSS custom properties */
.screen-panel--widget {
  background: var(--screen-panel-bg, transparent);
  border-radius: var(--screen-panel-radius, 0);
  box-shadow: var(--screen-panel-shadow, none);
  padding: var(--screen-panel-padding, 0);
  font-family: var(--screen-font-family, inherit);
  color: var(--screen-font-color, inherit);
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
```

**Step 4: Write PanelRenderer.jsx**

```jsx
// frontend/src/screen-framework/panels/PanelRenderer.jsx
import React from 'react';
import { getWidgetRegistry } from '../widgets/registry.js';
import './PanelRenderer.css';

/**
 * Convert a node's theme object to --screen-* CSS custom properties.
 */
function themeVars(theme) {
  if (!theme) return {};
  return Object.fromEntries(
    Object.entries(theme).map(([k, v]) => [`--screen-${k}`, v])
  );
}

/**
 * Build inline flex style from a node's layout properties.
 */
function flexItemStyle(node) {
  return {
    flexGrow: node.grow ?? 1,
    flexShrink: node.shrink ?? 1,
    flexBasis: node.basis || 'auto',
    overflow: node.overflow || undefined,
  };
}

/**
 * PanelRenderer — Recursive flex layout renderer.
 *
 * Each node is either:
 * - A widget leaf (has `widget` key) → resolves from registry, wrapped in themed div
 * - A panel branch (has `children`) → flex container, recurses
 */
export function PanelRenderer({ node }) {
  if (!node) return null;

  const theme = themeVars(node.theme);

  // Leaf node — render widget
  if (node.widget) {
    const registry = getWidgetRegistry();
    const Component = registry.get(node.widget);
    if (!Component) return null;

    return (
      <div
        className="screen-panel screen-panel--widget"
        style={{ ...flexItemStyle(node), ...theme }}
      >
        <Component />
      </div>
    );
  }

  // Branch node — flex container
  if (node.children) {
    return (
      <div
        className="screen-panel"
        style={{
          flexDirection: node.direction || 'row',
          justifyContent: node.justify || undefined,
          alignItems: node.align || 'stretch',
          gap: node.gap || undefined,
          ...flexItemStyle(node),
          ...theme,
        }}
      >
        {node.children.map((child, i) => (
          <PanelRenderer key={child.widget || `panel-${i}`} node={child} />
        ))}
      </div>
    );
  }

  return null;
}
```

**Step 5: Run tests**

Run: `npx vitest run frontend/src/screen-framework/panels/PanelRenderer.test.jsx`
Expected: PASS (all 7 tests)

**Step 6: Commit**

```bash
git add frontend/src/screen-framework/panels/PanelRenderer.jsx frontend/src/screen-framework/panels/PanelRenderer.css frontend/src/screen-framework/panels/PanelRenderer.test.jsx
git commit -m "feat(screen-framework): add recursive PanelRenderer with flex layout and theme CSS vars"
```

---

### Task 4: Rewrite ScreenRenderer

Wire PanelRenderer, ScreenDataProvider, and theme variables into the main entry point.

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

**Step 1: Rewrite ScreenRenderer.jsx**

```jsx
// frontend/src/screen-framework/ScreenRenderer.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { DaylightAPI } from '../lib/api.mjs';
import { PanelRenderer } from './panels/PanelRenderer.jsx';
import { ScreenDataProvider } from './data/ScreenDataProvider.jsx';
import { registerBuiltinWidgets } from './widgets/builtins.js';
import { getActionBus } from './input/ActionBus.js';
import { createInputManager } from './input/InputManager.js';

// Register built-ins on module load
registerBuiltinWidgets();

/**
 * ScreenRenderer - Config-driven kiosk screen.
 * Fetches YAML config, sets up theme + data + input, renders panel tree.
 */
export function ScreenRenderer({ screenId: propScreenId }) {
  const params = useParams();
  const screenId = propScreenId || params.screenId;

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch screen configuration
  useEffect(() => {
    if (!screenId) {
      setError('No screen ID provided');
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const data = await DaylightAPI(`api/v1/screens/${screenId}`);
        setConfig(data);
      } catch (err) {
        setError(`Failed to load screen "${screenId}": ${err.message}`);
      }
      setLoading(false);
    };

    fetchConfig();
  }, [screenId]);

  // Initialize input system
  useEffect(() => {
    if (!config?.input) return;
    const manager = createInputManager(getActionBus(), config.input);
    return () => manager.destroy();
  }, [config]);

  // Convert theme to --screen-* CSS custom properties
  const themeStyle = useMemo(() => {
    if (!config?.theme) return {};
    return Object.fromEntries(
      Object.entries(config.theme).map(([k, v]) => [`--screen-${k}`, String(v)])
    );
  }, [config]);

  if (loading) {
    return <div className="screen-root screen-root--loading">Loading screen: {screenId}...</div>;
  }

  if (error) {
    return <div className="screen-root screen-root--error"><h2>Screen Error</h2><p>{error}</p></div>;
  }

  if (!config) {
    return <div className="screen-root screen-root--not-found">Screen not found: {screenId}</div>;
  }

  return (
    <ScreenDataProvider sources={config.data}>
      <div className={`screen-root screen-root--${screenId}`} style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        ...themeStyle,
      }}>
        <PanelRenderer node={config.layout} />
      </div>
    </ScreenDataProvider>
  );
}

export default ScreenRenderer;
```

**Step 2: Run existing ScreenRenderer tests (if any) + new tests**

Run: `npx vitest run frontend/src/screen-framework/`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "refactor(screen-framework): wire PanelRenderer, ScreenDataProvider, and theme into ScreenRenderer"
```

---

### Task 5: Refactor Weather Widgets to Use useScreenData

Make Weather and WeatherForecast self-fetch via `useScreenData` hook when rendered inside the screen framework. Preserve backward compatibility with the `weatherData` prop for OfficeApp.

**Files:**
- Modify: `frontend/src/modules/Weather/Weather.jsx`
- Modify: `frontend/src/modules/Weather/WeatherForecast.jsx`

**Step 1: Modify Weather.jsx**

Add at the top of the file, after existing imports:

```jsx
import { useScreenData } from '../../screen-framework/data/ScreenDataProvider.jsx';
```

Change the function signature and data sourcing (line 292):

```jsx
export default function Weather({ weatherData: weatherDataProp }) {
  const screenData = useScreenData('weather');
  const weatherData = weatherDataProp || screenData;
  // ... rest unchanged
```

This way:
- In OfficeApp: `<Weather weatherData={data} />` — uses prop, ignores hook (hook returns null outside provider)
- In screen framework: `<Weather />` — no prop, hook provides data

**Step 2: Modify WeatherForecast.jsx**

Same pattern. Add import at top:

```jsx
import { useScreenData } from '../../screen-framework/data/ScreenDataProvider.jsx';
```

Change line 8:

```jsx
export default function WeatherForecast({ weatherData: weatherDataProp }) {
  const screenData = useScreenData('weather');
  const weatherData = weatherDataProp || screenData;
  // ... rest unchanged
```

**Step 3: Verify OfficeApp still works**

The OfficeApp passes `weatherData` as a prop. The hook returns `null` outside a `ScreenDataProvider` — so the prop takes precedence. No changes to OfficeApp needed.

Run: `npx vitest run frontend/src/screen-framework/` (to ensure no import breaks)
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/modules/Weather/Weather.jsx frontend/src/modules/Weather/WeatherForecast.jsx
git commit -m "feat(weather): support useScreenData hook with prop fallback for backward compat"
```

---

### Task 6: Update YAML Config

Rewrite `office.yml` with recursive flex layout, data sources, and theme.

**Files:**
- Modify: `data/household/screens/office.yml` (on Dropbox at `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/screens/office.yml`)

**Step 1: Rewrite office.yml**

```yaml
# Office Dashboard Screen
# Recursive flex layout with coordinated data and theme

screen: office
route: /screen/office
input:
  type: numpad
  keyboard_id: officekeypad

theme:
  panel-bg: rgba(0, 0, 0, 0.6)
  panel-radius: 8px
  panel-shadow: 0 2px 8px rgba(0,0,0,0.3)
  panel-padding: 1rem
  font-family: Roboto Condensed, sans-serif
  font-color: "#e0e0e0"
  accent-color: "#4fc3f7"

data:
  weather:
    source: /api/v1/home/weather
    refresh: 60

layout:
  direction: row
  gap: 1rem
  children:
    - direction: column
      basis: 25%
      shrink: 0
      gap: 0.5rem
      children:
        - widget: clock
          grow: 0
        - widget: weather
          grow: 0
        - widget: weather-forecast
          grow: 1
        - widget: entropy
          grow: 1
    - direction: column
      grow: 1
      gap: 0.5rem
      children:
        - widget: calendar
          grow: 2
        - direction: row
          grow: 1
          gap: 0.5rem
          children:
            - widget: finance
              grow: 1
            - widget: health
              grow: 1
```

Note: `calendar` (Upcoming), `finance` (FinanceChart), `health` (Weight), `entropy` (EntropyPanel), and `clock` (Time) are all self-contained — they fetch their own data internally. Only `weather` and `weather-forecast` use the coordinated `data.weather` source.

**Step 2: Verify the backend serves it**

Run: `curl -s http://localhost:3112/api/v1/screens/office | head -5`
Expected: JSON with `screen: "office"` and `layout` object

**Step 3: Commit**

Note: This file is on Dropbox, not in the git repo. No git commit needed.

---

### Task 7: Update Barrel Exports

Update `index.js` to export new modules and remove old ones.

**Files:**
- Modify: `frontend/src/screen-framework/index.js`

**Step 1: Update index.js**

```js
/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.2.0';

// Main renderer
export { ScreenRenderer } from './ScreenRenderer.jsx';

// Panel layout
export { PanelRenderer } from './panels/PanelRenderer.jsx';

// Data coordination
export { ScreenDataProvider, useScreenData } from './data/ScreenDataProvider.jsx';

// Input system
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';
export { createInputManager } from './input/InputManager.js';
export { useScreenAction } from './input/useScreenAction.js';
export { translateAction, translateSecondary, ACTION_MAP } from './input/actionMap.js';
export { KeyboardAdapter } from './input/adapters/KeyboardAdapter.js';
export { NumpadAdapter } from './input/adapters/NumpadAdapter.js';
export { RemoteAdapter } from './input/adapters/RemoteAdapter.js';
export { GamepadAdapter } from './input/adapters/GamepadAdapter.js';

// Widget system
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { registerBuiltinWidgets } from './widgets/builtins.js';
```

Removed: `GridLayout`, `DataManager`, `WidgetWrapper` (no longer part of the public API).

**Step 2: Run all framework tests**

Run: `npx vitest run frontend/src/screen-framework/`
Expected: All PASS. If `GridLayout.test.jsx` fails because GridLayout is no longer imported elsewhere, that's expected — the test file still imports directly from the module path and should still pass independently.

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/index.js
git commit -m "refactor(screen-framework): update barrel exports for panel layout system"
```

---

### Task 8: Smoke Test

Verify `/screen/office` loads in the browser with real data.

**Files:** None — manual verification

**Step 1: Ensure dev server is running**

Run: `lsof -i :3111` — check if Vite is up. If not, start with `npm run dev`.

**Step 2: Open in browser**

Navigate to `http://localhost:3111/screen/office`

**Expected behavior:**
- Page loads without errors
- Flex layout renders: sidebar (25% left) with clock, weather, forecast, entropy; main content (75% right) with calendar, finance, health
- Theme applied: dark semi-transparent backgrounds, rounded corners, shadows
- Weather data loads (shared between weather + weather-forecast widgets)
- Self-contained widgets (clock, calendar, finance, health, entropy) load their own data
- No console errors

**Step 3: Compare with existing OfficeApp**

Navigate to `http://localhost:3111/office` — verify it still works identically, unaffected by changes.

**Step 4: Final commit (if any adjustments needed)**

Fix any visual issues found during smoke test, then commit.

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | ScreenDataProvider | 1 create, 1 test | 4 |
| 2 | Simplify Widget Registry | 3 modify | 4 |
| 3 | PanelRenderer + CSS | 2 create, 1 test | 7 |
| 4 | Rewrite ScreenRenderer | 1 modify | existing |
| 5 | Weather hook refactor | 2 modify | — |
| 6 | YAML config | 1 modify (Dropbox) | curl |
| 7 | Barrel exports | 1 modify | existing |
| 8 | Smoke test | — | manual |
