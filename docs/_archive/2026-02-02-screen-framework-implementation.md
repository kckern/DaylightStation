# Screen Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded OfficeApp and TVApp with a config-driven screen framework that reads YAML definitions and renders layouts, widgets, and input handling dynamically.

**Architecture:** A ScreenRenderer component reads screen config from `/api/v1/screens/:id`, assembles the appropriate layout engine (grid/regions/flex), instantiates widgets from a registry, and wires input adapters to an action bus. Widgets receive data via the DataManager which handles API fetching and WebSocket subscriptions.

**Tech Stack:** React 18, React Router, Vite, YAML configs (backend-served), existing modules (Clock, Weather, Calendar, etc.)

---

## Phase 1: Foundation

### Task 1: Create Screen Framework Directory Structure

**Files:**
- Create: `frontend/src/screen-framework/` directory
- Create: `frontend/src/screen-framework/index.js`

**Step 1: Create directory and index**

```bash
mkdir -p frontend/src/screen-framework/{layouts,input,data,widgets}
```

**Step 2: Create index.js with placeholder exports**

Create `frontend/src/screen-framework/index.js`:

```javascript
/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

// Will export: ScreenRenderer, layouts, input adapters, data manager, widget registry
export const VERSION = '0.1.0';
```

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/
git commit -m "chore: scaffold screen-framework directory structure"
```

---

### Task 2: Create ActionBus for Input/Widget Communication

**Files:**
- Create: `frontend/src/screen-framework/input/ActionBus.js`
- Create: `frontend/src/screen-framework/input/ActionBus.test.js`

**Step 1: Write the failing test**

Create `frontend/src/screen-framework/input/ActionBus.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionBus } from './ActionBus.js';

describe('ActionBus', () => {
  let bus;

  beforeEach(() => {
    bus = new ActionBus();
  });

  it('should allow subscribing to actions', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);

    bus.emit('select', { target: 'widget-1' });

    expect(handler).toHaveBeenCalledWith({ target: 'widget-1' });
  });

  it('should allow unsubscribing from actions', () => {
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('select', handler);

    unsubscribe();
    bus.emit('select', { target: 'widget-1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple subscribers for same action', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe('navigate', handler1);
    bus.subscribe('navigate', handler2);

    bus.emit('navigate', { direction: 'up' });

    expect(handler1).toHaveBeenCalledWith({ direction: 'up' });
    expect(handler2).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should support wildcard subscriptions', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);

    bus.emit('any-action', { data: 'test' });

    expect(handler).toHaveBeenCalledWith('any-action', { data: 'test' });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/screen-framework/input/ActionBus.test.js
```

Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `frontend/src/screen-framework/input/ActionBus.js`:

```javascript
/**
 * ActionBus - Central event bus for screen framework
 *
 * Input adapters emit actions, widgets subscribe to actions they handle.
 * Supports wildcard subscriptions for logging/debugging.
 */
export class ActionBus {
  constructor() {
    this.subscribers = new Map();
    this.wildcardSubscribers = new Set();
  }

  /**
   * Subscribe to an action type
   * @param {string} action - Action name or '*' for all actions
   * @param {Function} handler - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(action, handler) {
    if (action === '*') {
      this.wildcardSubscribers.add(handler);
      return () => this.wildcardSubscribers.delete(handler);
    }

    if (!this.subscribers.has(action)) {
      this.subscribers.set(action, new Set());
    }
    this.subscribers.get(action).add(handler);

    return () => {
      const handlers = this.subscribers.get(action);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /**
   * Emit an action to all subscribers
   * @param {string} action - Action name
   * @param {*} payload - Action payload
   */
  emit(action, payload) {
    // Notify specific subscribers
    const handlers = this.subscribers.get(action);
    if (handlers) {
      handlers.forEach(handler => handler(payload));
    }

    // Notify wildcard subscribers
    this.wildcardSubscribers.forEach(handler => handler(action, payload));
  }

  /**
   * Clear all subscribers (useful for testing/cleanup)
   */
  clear() {
    this.subscribers.clear();
    this.wildcardSubscribers.clear();
  }
}

// Singleton instance for app-wide use
let defaultBus = null;

export function getActionBus() {
  if (!defaultBus) {
    defaultBus = new ActionBus();
  }
  return defaultBus;
}

export function resetActionBus() {
  defaultBus = null;
}
```

**Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/screen-framework/input/ActionBus.test.js
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/
git commit -m "feat(screen-framework): add ActionBus for input/widget communication"
```

---

### Task 3: Create Widget Registry

**Files:**
- Create: `frontend/src/screen-framework/widgets/registry.js`
- Create: `frontend/src/screen-framework/widgets/registry.test.js`

**Step 1: Write the failing test**

Create `frontend/src/screen-framework/widgets/registry.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from './registry.js';

// Mock widget components
const MockClock = () => 'clock';
const MockWeather = () => 'weather';

describe('WidgetRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it('should register a widget', () => {
    registry.register('clock', MockClock);

    expect(registry.has('clock')).toBe(true);
  });

  it('should retrieve a registered widget', () => {
    registry.register('clock', MockClock);

    const widget = registry.get('clock');

    expect(widget).toBe(MockClock);
  });

  it('should return null for unregistered widget', () => {
    expect(registry.get('nonexistent')).toBe(null);
  });

  it('should register widget with metadata', () => {
    registry.register('weather', MockWeather, {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 60000,
      actions: ['select', 'refresh']
    });

    const meta = registry.getMetadata('weather');

    expect(meta.defaultSource).toBe('/api/v1/home/weather');
    expect(meta.refreshInterval).toBe(60000);
    expect(meta.actions).toContain('refresh');
  });

  it('should list all registered widgets', () => {
    registry.register('clock', MockClock);
    registry.register('weather', MockWeather);

    const widgets = registry.list();

    expect(widgets).toContain('clock');
    expect(widgets).toContain('weather');
    expect(widgets.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/screen-framework/widgets/registry.test.js
```

Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `frontend/src/screen-framework/widgets/registry.js`:

```javascript
/**
 * WidgetRegistry - Central registry for screen framework widgets
 *
 * Built-in widgets are auto-registered at startup.
 * Custom widgets can be registered via config.
 */
export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
    this.metadata = new Map();
  }

  /**
   * Register a widget component
   * @param {string} name - Widget identifier
   * @param {React.Component} component - React component
   * @param {Object} meta - Widget metadata (defaultSource, refreshInterval, actions)
   */
  register(name, component, meta = {}) {
    this.widgets.set(name, component);
    this.metadata.set(name, {
      defaultSource: null,
      refreshInterval: null,
      actions: [],
      ...meta
    });
  }

  /**
   * Check if a widget is registered
   * @param {string} name - Widget identifier
   * @returns {boolean}
   */
  has(name) {
    return this.widgets.has(name);
  }

  /**
   * Get a widget component
   * @param {string} name - Widget identifier
   * @returns {React.Component|null}
   */
  get(name) {
    return this.widgets.get(name) || null;
  }

  /**
   * Get widget metadata
   * @param {string} name - Widget identifier
   * @returns {Object|null}
   */
  getMetadata(name) {
    return this.metadata.get(name) || null;
  }

  /**
   * List all registered widget names
   * @returns {string[]}
   */
  list() {
    return Array.from(this.widgets.keys());
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear() {
    this.widgets.clear();
    this.metadata.clear();
  }
}

// Singleton instance
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

**Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/screen-framework/widgets/registry.test.js
```

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/
git commit -m "feat(screen-framework): add WidgetRegistry for component discovery"
```

---

### Task 4: Register Built-in Widgets

**Files:**
- Create: `frontend/src/screen-framework/widgets/builtins.js`
- Modify: `frontend/src/screen-framework/index.js`

**Step 1: Create builtins.js that registers existing modules**

Create `frontend/src/screen-framework/widgets/builtins.js`:

```javascript
/**
 * Built-in widget registrations
 * Maps existing modules to the screen framework registry
 */
import { getWidgetRegistry } from './registry.js';

// Lazy imports to avoid circular dependencies
const lazyImport = (importFn) => {
  let component = null;
  return () => {
    if (!component) {
      component = importFn();
    }
    return component;
  };
};

/**
 * Register all built-in widgets with the registry
 */
export function registerBuiltinWidgets() {
  const registry = getWidgetRegistry();

  // Time/Clock widget
  registry.register('clock',
    () => import('../../modules/Time/Time.jsx').then(m => m.default),
    {
      defaultSource: null, // Clock uses local time
      refreshInterval: null,
      actions: []
    }
  );

  // Weather widget
  registry.register('weather',
    () => import('../../modules/Weather/Weather.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 60000,
      actions: ['select', 'refresh']
    }
  );

  // Weather Forecast widget
  registry.register('weather-forecast',
    () => import('../../modules/Weather/WeatherForecast.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/home/weather',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Calendar/Upcoming widget
  registry.register('calendar',
    () => import('../../modules/Upcoming/Upcoming.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/calendar',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Finance chart widget
  registry.register('finance',
    () => import('../../modules/Finance/Finance.jsx').then(m => m.FinanceChart),
    {
      defaultSource: '/api/v1/finance/chart',
      refreshInterval: 3600000,
      actions: ['select']
    }
  );

  // Entropy panel widget
  registry.register('entropy',
    () => import('../../modules/Entropy/EntropyPanel.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/entropy',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Health widget
  registry.register('health',
    () => import('../../modules/Health/Health.jsx').then(m => m.default),
    {
      defaultSource: '/api/v1/health',
      refreshInterval: 300000,
      actions: ['select']
    }
  );

  // Menu widget (for TV-style navigation)
  registry.register('menu',
    () => import('../../modules/Menu/Menu.jsx').then(m => m.TVMenu),
    {
      defaultSource: null, // Configured per-instance
      refreshInterval: null,
      actions: ['select', 'navigate', 'escape']
    }
  );

  // Player widget
  registry.register('player',
    () => import('../../modules/Player/Player.jsx').then(m => m.default),
    {
      defaultSource: null, // Receives queue via actions
      refreshInterval: null,
      actions: ['play', 'pause', 'seek', 'next', 'previous', 'escape']
    }
  );

  return registry;
}
```

**Step 2: Update index.js to export and auto-register**

Update `frontend/src/screen-framework/index.js`:

```javascript
/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.1.0';

// Core exports
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { registerBuiltinWidgets } from './widgets/builtins.js';
```

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/
git commit -m "feat(screen-framework): register built-in widgets from existing modules"
```

---

### Task 5: Create DataManager for API Fetching

**Files:**
- Create: `frontend/src/screen-framework/data/DataManager.js`
- Create: `frontend/src/screen-framework/data/DataManager.test.js`

**Step 1: Write the failing test**

Create `frontend/src/screen-framework/data/DataManager.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataManager } from './DataManager.js';

// Mock fetch
global.fetch = vi.fn();

describe('DataManager', () => {
  let manager;

  beforeEach(() => {
    manager = new DataManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('should fetch data from a source', async () => {
    const mockData = { temperature: 72, condition: 'sunny' };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const data = await manager.fetch('/api/v1/home/weather');

    expect(fetch).toHaveBeenCalledWith('/api/v1/home/weather');
    expect(data).toEqual(mockData);
  });

  it('should cache fetched data', async () => {
    const mockData = { temperature: 72 };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    await manager.fetch('/api/v1/home/weather');
    const cached = manager.getCached('/api/v1/home/weather');

    expect(cached).toEqual(mockData);
  });

  it('should subscribe to a source with refresh interval', async () => {
    vi.useFakeTimers();
    const mockData = { count: 1 };
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const callback = vi.fn();
    manager.subscribe('/api/v1/test', callback, { refreshInterval: 1000 });

    // Initial fetch
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    // After refresh interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should unsubscribe and stop refreshing', async () => {
    vi.useFakeTimers();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' })
    });

    const callback = vi.fn();
    const unsubscribe = manager.subscribe('/api/v1/test', callback, { refreshInterval: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(2000);

    expect(callback).toHaveBeenCalledTimes(1); // Only initial fetch

    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/screen-framework/data/DataManager.test.js
```

Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `frontend/src/screen-framework/data/DataManager.js`:

```javascript
/**
 * DataManager - Handles data fetching, caching, and subscriptions
 *
 * Widgets declare data sources in config. DataManager handles:
 * - Initial fetch on mount
 * - Periodic refresh based on interval
 * - Caching to avoid duplicate requests
 * - WebSocket subscriptions (future)
 */
export class DataManager {
  constructor() {
    this.cache = new Map();
    this.subscriptions = new Map();
    this.intervals = new Map();
  }

  /**
   * Fetch data from a source
   * @param {string} source - API endpoint
   * @returns {Promise<*>} Fetched data
   */
  async fetch(source) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }
    const data = await response.json();
    this.cache.set(source, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Get cached data for a source
   * @param {string} source - API endpoint
   * @returns {*|null} Cached data or null
   */
  getCached(source) {
    const cached = this.cache.get(source);
    return cached ? cached.data : null;
  }

  /**
   * Subscribe to a data source with optional refresh
   * @param {string} source - API endpoint
   * @param {Function} callback - Called with data on each fetch
   * @param {Object} options - { refreshInterval: ms }
   * @returns {Function} Unsubscribe function
   */
  subscribe(source, callback, options = {}) {
    const { refreshInterval } = options;

    // Track subscription
    if (!this.subscriptions.has(source)) {
      this.subscriptions.set(source, new Set());
    }
    this.subscriptions.get(source).add(callback);

    // Initial fetch
    this.fetch(source)
      .then(data => callback(data))
      .catch(err => console.error(`DataManager fetch error: ${source}`, err));

    // Set up refresh interval if specified
    if (refreshInterval && !this.intervals.has(source)) {
      const intervalId = setInterval(() => {
        this.fetch(source)
          .then(data => {
            const subscribers = this.subscriptions.get(source);
            if (subscribers) {
              subscribers.forEach(cb => cb(data));
            }
          })
          .catch(err => console.error(`DataManager refresh error: ${source}`, err));
      }, refreshInterval);
      this.intervals.set(source, intervalId);
    }

    // Return unsubscribe function
    return () => {
      const subscribers = this.subscriptions.get(source);
      if (subscribers) {
        subscribers.delete(callback);
        // Clean up interval if no more subscribers
        if (subscribers.size === 0) {
          const intervalId = this.intervals.get(source);
          if (intervalId) {
            clearInterval(intervalId);
            this.intervals.delete(source);
          }
          this.subscriptions.delete(source);
        }
      }
    };
  }

  /**
   * Clear all subscriptions and intervals
   */
  destroy() {
    this.intervals.forEach(intervalId => clearInterval(intervalId));
    this.intervals.clear();
    this.subscriptions.clear();
    this.cache.clear();
  }
}

// Singleton instance
let defaultManager = null;

export function getDataManager() {
  if (!defaultManager) {
    defaultManager = new DataManager();
  }
  return defaultManager;
}

export function resetDataManager() {
  if (defaultManager) {
    defaultManager.destroy();
  }
  defaultManager = null;
}
```

**Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/screen-framework/data/DataManager.test.js
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/data/
git commit -m "feat(screen-framework): add DataManager for API fetching and caching"
```

---

### Task 6: Create GridLayout Component

**Files:**
- Create: `frontend/src/screen-framework/layouts/GridLayout.jsx`
- Create: `frontend/src/screen-framework/layouts/GridLayout.test.jsx`

**Step 1: Write the failing test**

Create `frontend/src/screen-framework/layouts/GridLayout.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GridLayout } from './GridLayout.jsx';

describe('GridLayout', () => {
  it('should render a grid container', () => {
    render(
      <GridLayout columns={2} rows={2} gap="1rem">
        <div data-testid="widget-1">Widget 1</div>
      </GridLayout>
    );

    const grid = screen.getByTestId('widget-1').parentElement;
    expect(grid).toHaveStyle({ display: 'grid' });
  });

  it('should apply correct grid template', () => {
    render(
      <GridLayout columns={3} rows={2} gap="1rem">
        <div>Widget</div>
      </GridLayout>
    );

    const grid = document.querySelector('.screen-grid-layout');
    const styles = window.getComputedStyle(grid);

    // Check that grid-template-columns is set (3 columns)
    expect(grid.style.gridTemplateColumns).toContain('1fr');
  });

  it('should position widgets according to row/col props', () => {
    render(
      <GridLayout columns={2} rows={2}>
        <div data-testid="widget" data-row={1} data-col={2}>Widget</div>
      </GridLayout>
    );

    const widget = screen.getByTestId('widget');
    // GridLayout should wrap children and apply positioning
    expect(widget.parentElement.style.gridRow).toBe('1');
    expect(widget.parentElement.style.gridColumn).toBe('2');
  });

  it('should handle colspan and rowspan', () => {
    render(
      <GridLayout columns={3} rows={3}>
        <div data-testid="widget" data-row={1} data-col={1} data-colspan={2} data-rowspan={2}>
          Widget
        </div>
      </GridLayout>
    );

    const wrapper = screen.getByTestId('widget').parentElement;
    expect(wrapper.style.gridColumn).toBe('1 / span 2');
    expect(wrapper.style.gridRow).toBe('1 / span 2');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/screen-framework/layouts/GridLayout.test.jsx
```

Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `frontend/src/screen-framework/layouts/GridLayout.jsx`:

```javascript
import React from 'react';

/**
 * GridLayout - CSS Grid-based layout engine
 *
 * Children should have data-row, data-col, data-colspan, data-rowspan attributes
 * for positioning, or be wrapped with position config.
 */
export function GridLayout({
  columns = 2,
  rows = 2,
  gap = '1rem',
  children,
  className = ''
}) {
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap,
    width: '100%',
    height: '100%'
  };

  // Wrap each child with positioning
  const positionedChildren = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;

    const row = child.props['data-row'] || 1;
    const col = child.props['data-col'] || 1;
    const colspan = child.props['data-colspan'] || 1;
    const rowspan = child.props['data-rowspan'] || 1;

    const wrapperStyle = {
      gridColumn: colspan > 1 ? `${col} / span ${colspan}` : `${col}`,
      gridRow: rowspan > 1 ? `${row} / span ${rowspan}` : `${row}`
    };

    return (
      <div className="screen-grid-cell" style={wrapperStyle}>
        {child}
      </div>
    );
  });

  return (
    <div className={`screen-grid-layout ${className}`} style={gridStyle}>
      {positionedChildren}
    </div>
  );
}

export default GridLayout;
```

**Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/screen-framework/layouts/GridLayout.test.jsx
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/layouts/
git commit -m "feat(screen-framework): add GridLayout component for dashboard screens"
```

---

### Task 7: Create WidgetWrapper Component

**Files:**
- Create: `frontend/src/screen-framework/widgets/WidgetWrapper.jsx`

**Step 1: Create the component**

Create `frontend/src/screen-framework/widgets/WidgetWrapper.jsx`:

```javascript
import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import { getDataManager } from '../data/DataManager.js';
import { getWidgetRegistry } from './registry.js';

/**
 * WidgetWrapper - Loads widget component, manages data, wires actions
 *
 * Handles:
 * - Lazy loading widget component from registry
 * - Subscribing to data source
 * - Connecting to action bus
 * - Passing standardized props to widget
 */
export function WidgetWrapper({
  name,
  config = {},
  position = {},
  children
}) {
  const [WidgetComponent, setWidgetComponent] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const registry = getWidgetRegistry();
  const dataManager = getDataManager();
  const actionBus = getActionBus();

  // Load widget component
  useEffect(() => {
    const loadWidget = async () => {
      const componentLoader = registry.get(name);
      if (!componentLoader) {
        setError(`Widget "${name}" not found in registry`);
        setLoading(false);
        return;
      }

      try {
        // Handle both sync and async (lazy) components
        const component = typeof componentLoader === 'function'
          ? await componentLoader()
          : componentLoader;
        setWidgetComponent(() => component);
      } catch (err) {
        setError(`Failed to load widget "${name}": ${err.message}`);
      }
      setLoading(false);
    };

    loadWidget();
  }, [name, registry]);

  // Subscribe to data source
  useEffect(() => {
    const metadata = registry.getMetadata(name);
    const source = config.source || metadata?.defaultSource;
    const refreshInterval = config.refresh || metadata?.refreshInterval;

    if (!source) return;

    const unsubscribe = dataManager.subscribe(source, setData, { refreshInterval });
    return unsubscribe;
  }, [name, config.source, config.refresh, registry, dataManager]);

  // Dispatch action helper
  const dispatch = useCallback((action, payload) => {
    actionBus.emit(action, { widget: name, ...payload });
  }, [actionBus, name]);

  // Build position data attributes
  const positionAttrs = {
    'data-row': position.row,
    'data-col': position.col,
    'data-colspan': position.colspan,
    'data-rowspan': position.rowspan
  };

  if (loading) {
    return (
      <div className="screen-widget screen-widget--loading" {...positionAttrs}>
        Loading {name}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-widget screen-widget--error" {...positionAttrs}>
        {error}
      </div>
    );
  }

  if (!WidgetComponent) {
    return (
      <div className="screen-widget screen-widget--missing" {...positionAttrs}>
        Widget not found: {name}
      </div>
    );
  }

  return (
    <div className={`screen-widget screen-widget--${name}`} {...positionAttrs}>
      <Suspense fallback={<div>Loading...</div>}>
        <WidgetComponent
          data={data}
          config={config}
          dispatch={dispatch}
          {...config}
        />
      </Suspense>
    </div>
  );
}

export default WidgetWrapper;
```

**Step 2: Commit**

```bash
git add frontend/src/screen-framework/widgets/WidgetWrapper.jsx
git commit -m "feat(screen-framework): add WidgetWrapper for widget lifecycle management"
```

---

### Task 8: Create ScreenRenderer Component

**Files:**
- Create: `frontend/src/screen-framework/ScreenRenderer.jsx`

**Step 1: Create the main renderer**

Create `frontend/src/screen-framework/ScreenRenderer.jsx`:

```javascript
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DaylightAPI } from '../lib/api.mjs';
import { GridLayout } from './layouts/GridLayout.jsx';
import { WidgetWrapper } from './widgets/WidgetWrapper.jsx';
import { registerBuiltinWidgets } from './widgets/builtins.js';
import { getActionBus } from './input/ActionBus.js';

// Register built-ins on module load
registerBuiltinWidgets();

/**
 * ScreenRenderer - Main entry point for config-driven screens
 *
 * Fetches screen config from API, selects layout engine,
 * instantiates widgets, and wires input handling.
 */
export function ScreenRenderer({ screenId: propScreenId }) {
  const params = useParams();
  const screenId = propScreenId || params.screenId;

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch screen configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const data = await DaylightAPI(`/api/v1/screens/${screenId}`);
        setConfig(data);
      } catch (err) {
        setError(`Failed to load screen "${screenId}": ${err.message}`);
      }
      setLoading(false);
    };

    if (screenId) {
      fetchConfig();
    } else {
      setError('No screen ID provided');
      setLoading(false);
    }
  }, [screenId]);

  if (loading) {
    return (
      <div className="screen-renderer screen-renderer--loading">
        Loading screen: {screenId}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-renderer screen-renderer--error">
        <h2>Screen Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="screen-renderer screen-renderer--not-found">
        Screen not found: {screenId}
      </div>
    );
  }

  // Select layout engine based on config
  const Layout = selectLayout(config.layout?.type);
  const layoutProps = {
    columns: config.layout?.columns,
    rows: config.layout?.rows,
    gap: config.layout?.gap
  };

  // Build widget list from config
  const widgets = Object.entries(config.widgets || {}).map(([name, widgetConfig]) => {
    // Handle shorthand (just position) vs full config
    const normalizedConfig = typeof widgetConfig === 'object'
      ? widgetConfig
      : {};

    const position = {
      row: normalizedConfig.row || 1,
      col: normalizedConfig.col || 1,
      colspan: normalizedConfig.colspan || 1,
      rowspan: normalizedConfig.rowspan || 1
    };

    return (
      <WidgetWrapper
        key={name}
        name={name}
        config={normalizedConfig}
        position={position}
      />
    );
  });

  return (
    <div className={`screen-renderer screen-renderer--${screenId}`}>
      <Layout {...layoutProps}>
        {widgets}
      </Layout>
    </div>
  );
}

/**
 * Select layout component based on type
 */
function selectLayout(type) {
  switch (type) {
    case 'grid':
    default:
      return GridLayout;
    // Future: case 'regions': return RegionsLayout;
    // Future: case 'flex': return FlexLayout;
  }
}

export default ScreenRenderer;
```

**Step 2: Update index.js exports**

Update `frontend/src/screen-framework/index.js`:

```javascript
/**
 * Screen Framework
 * Config-driven kiosk interfaces for room-based displays
 */

export const VERSION = '0.1.0';

// Main renderer
export { ScreenRenderer } from './ScreenRenderer.jsx';

// Layouts
export { GridLayout } from './layouts/GridLayout.jsx';

// Input system
export { ActionBus, getActionBus, resetActionBus } from './input/ActionBus.js';

// Data layer
export { DataManager, getDataManager, resetDataManager } from './data/DataManager.js';

// Widget system
export { WidgetRegistry, getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
export { WidgetWrapper } from './widgets/WidgetWrapper.jsx';
export { registerBuiltinWidgets } from './widgets/builtins.js';
```

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/
git commit -m "feat(screen-framework): add ScreenRenderer as main entry point"
```

---

### Task 9: Create Backend API for Screen Configs

**Files:**
- Create: `backend/src/4_api/v1/routers/screens.mjs`
- Modify: `backend/src/4_api/v1/routers/index.mjs`

**Step 1: Create screens router**

Create `backend/src/4_api/v1/routers/screens.mjs`:

```javascript
/**
 * Screens API Router
 * Serves screen configurations from YAML files
 */
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const router = express.Router();

/**
 * Get screen configuration by ID
 * GET /api/v1/screens/:screenId
 */
router.get('/:screenId', async (req, res) => {
  const { screenId } = req.params;

  try {
    // Load from household screens directory
    const dataPath = process.env.DAYLIGHT_DATA_PATH || '/data';
    const screenPath = path.join(dataPath, 'household', 'screens', `${screenId}.yml`);

    const content = await fs.readFile(screenPath, 'utf-8');
    const config = yaml.load(content);

    // Validate required fields
    if (!config.screen) {
      return res.status(400).json({
        error: 'Invalid screen config',
        message: 'Missing required "screen" field'
      });
    }

    res.json(config);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Screen not found',
        screenId
      });
    }
    console.error(`Error loading screen ${screenId}:`, err);
    res.status(500).json({
      error: 'Failed to load screen config',
      message: err.message
    });
  }
});

/**
 * List available screens
 * GET /api/v1/screens
 */
router.get('/', async (req, res) => {
  try {
    const dataPath = process.env.DAYLIGHT_DATA_PATH || '/data';
    const screensDir = path.join(dataPath, 'household', 'screens');

    try {
      const files = await fs.readdir(screensDir);
      const screens = files
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map(f => f.replace(/\.ya?ml$/, ''));

      res.json({ screens });
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Directory doesn't exist yet
        res.json({ screens: [] });
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('Error listing screens:', err);
    res.status(500).json({
      error: 'Failed to list screens',
      message: err.message
    });
  }
});

export default router;
```

**Step 2: Register router in index.mjs**

Add to `backend/src/4_api/v1/routers/index.mjs` (find the router imports section):

```javascript
import screensRouter from './screens.mjs';
```

And in the router registration section:

```javascript
router.use('/screens', screensRouter);
```

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/screens.mjs backend/src/4_api/v1/routers/index.mjs
git commit -m "feat(api): add /api/v1/screens endpoint for screen configs"
```

---

### Task 10: Create Sample Screen Config

**Files:**
- Create: `data/household/screens/` directory (in data mount)
- Create: Sample office.yml config

**Step 1: Document the config location**

The actual config files live in the data mount (outside the repo). Create a README:

Create `docs/reference/screen-configs.md`:

```markdown
# Screen Configuration Reference

Screen configs define room-based displays using YAML.

## Location

Configs are stored in the data mount:
```
{DAYLIGHT_DATA_PATH}/household/screens/*.yml
```

## Example Configuration

```yaml
# office.yml - Office dashboard screen
screen: office
route: /office
profile: dashboard
input: numpad

layout:
  type: grid
  columns: 2
  rows: 3
  gap: 1rem

widgets:
  clock:
    row: 1
    col: 1
  weather:
    row: 1
    col: 2
  calendar:
    row: 2
    col: 1
    colspan: 2
  finance:
    row: 3
    col: 1
  entropy:
    row: 3
    col: 2
```

## Config Fields

### Top-level

| Field | Required | Description |
|-------|----------|-------------|
| screen | Yes | Unique identifier |
| route | No | URL path (defaults to /screen/{id}) |
| profile | No | Base profile (dashboard, media-browser) |
| input | No | Input mode (touch, remote, numpad, keyboard) |
| layout | Yes | Layout configuration |
| widgets | Yes | Widget definitions |

### Layout

| Field | Description |
|-------|-------------|
| type | Layout engine: grid, regions, flex |
| columns | Number of columns (grid) |
| rows | Number of rows (grid) |
| gap | Gap between cells (CSS value) |
| template | Template name (regions) |

### Widgets

Each widget key is the widget name from the registry. Value can be:

**Shorthand (position only):**
```yaml
clock: { row: 1, col: 1 }
```

**Full config:**
```yaml
weather:
  row: 1
  col: 2
  source: /api/v1/home/weather  # Override default
  refresh: 30s                   # Override refresh
  on_tap: open_forecast          # Action override
```

## Available Widgets

| Name | Default Source | Description |
|------|---------------|-------------|
| clock | (local) | Flip clock display |
| weather | /api/v1/home/weather | Current weather |
| weather-forecast | /api/v1/home/weather | Weather forecast |
| calendar | /api/v1/calendar | Upcoming events |
| finance | /api/v1/finance/chart | Spending chart |
| entropy | /api/v1/entropy | Accountability nudges |
| health | /api/v1/health | Health metrics |
| menu | (configured) | Navigation menu |
| player | (actions) | Media player |
```

**Step 2: Commit**

```bash
git add docs/reference/screen-configs.md
git commit -m "docs: add screen configuration reference"
```

---

### Task 11: Add Screen Route to Frontend Router

**Files:**
- Modify: `frontend/src/main.jsx`

**Step 1: Add screen route**

Add import at top of `frontend/src/main.jsx`:

```javascript
import { ScreenRenderer } from './screen-framework/index.js';
```

Add route in the Routes section (before the catch-all):

```javascript
<Route path="/screen/:screenId" element={<ScreenRenderer />} />
```

**Step 2: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "feat: add /screen/:screenId route for config-driven screens"
```

---

## Phase 1 Complete Checkpoint

At this point you should have:

1. Screen framework directory structure
2. ActionBus for input/widget communication
3. WidgetRegistry with built-in widgets registered
4. DataManager for API fetching
5. GridLayout component
6. WidgetWrapper for widget lifecycle
7. ScreenRenderer as main entry point
8. Backend API for screen configs
9. Documentation for config format
10. Frontend route for screens

**Verify by:**

1. Create a test screen config in your data mount:
   ```yaml
   # {DATA_PATH}/household/screens/test.yml
   screen: test
   layout:
     type: grid
     columns: 2
     rows: 2
   widgets:
     clock:
       row: 1
       col: 1
   ```

2. Start the dev server and navigate to `/screen/test`

3. You should see the clock widget rendered in a 2x2 grid

---

## Phase 2: Input System

(Tasks 12-16: Touch adapter, Remote adapter, Numpad adapter, Input mode config, Per-widget overrides)

## Phase 3: Layout Expansion

(Tasks 17-20: RegionsLayout, FlexLayout, Layout switching, Template library)

## Phase 4: Migration

(Tasks 21-24: Migrate OfficeApp config, Migrate TVApp config, Test parity, Remove old apps)

---

## Notes for Implementer

- Run tests after each implementation step
- Commit after each task passes
- If a test fails unexpectedly, investigate before proceeding
- The existing modules (Time, Weather, etc.) should work without modification
- Focus on getting Phase 1 working end-to-end before expanding
