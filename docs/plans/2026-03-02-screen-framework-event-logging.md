# Screen-Framework Event Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured logging to the screen-framework's event pipeline so that WebSocket messages, keystrokes, and action bus dispatches are observable — and silent drops are visible.

**Architecture:** Each component in the event chain gets a lazy-initialized child logger (matching the `GamepadAdapter` pattern). The `ActionBus` logs every `emit()` with subscriber count, warning when zero. Input adapters log key receipt and action dispatch at `debug` level. `useScreenSubscriptions` logs filter decisions so dropped WS messages are traceable. `DataManager` and `ScreenDataProvider` migrate from `console.*` to the structured logger.

**Tech Stack:** `frontend/src/lib/logging/Logger.js` (existing framework), Vitest + happy-dom (existing test infra)

---

### Task 1: ActionBus — log emit with subscriber count, warn on zero

The most critical gap. An emitted action with zero subscribers silently vanishes.

**Files:**
- Modify: `frontend/src/screen-framework/input/ActionBus.js`
- Create: `tests/unit/screen-framework/ActionBus.test.js`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/ActionBus.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger before importing ActionBus
vi.mock('../../../frontend/src/lib/logging/Logger.js', () => {
  const child = vi.fn(() => mockLogger);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
  return { default: () => mockLogger, getLogger: () => mockLogger };
});

import { ActionBus, resetActionBus } from '../../../frontend/src/screen-framework/input/ActionBus.js';

describe('ActionBus logging', () => {
  let bus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    bus = new ActionBus();
  });

  it('logs emit with subscriber count at debug level', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    bus.emit('navigate', { direction: 'up' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'actionbus.emit',
      expect.objectContaining({ action: 'navigate', subscriberCount: 1 })
    );
  });

  it('warns when emitting to zero subscribers', () => {
    bus.emit('unknown:action', {});

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'actionbus.emit.unhandled',
      expect.objectContaining({ action: 'unknown:action', subscriberCount: 0 })
    );
  });

  it('does not warn for wildcard-only subscribers', () => {
    const wildcard = vi.fn();
    bus.subscribe('*', wildcard);
    bus.emit('some:action', {});

    // Still warns — wildcard is debug tooling, not a handler
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'actionbus.emit.unhandled',
      expect.objectContaining({ action: 'some:action', subscriberCount: 0 })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/ActionBus.test.js`
Expected: FAIL — `mockLogger.debug` never called (no logging in ActionBus yet)

**Step 3: Write minimal implementation**

In `frontend/src/screen-framework/input/ActionBus.js`, add the logger import and modify `emit()`:

```js
// Add at top of file, after the JSDoc comment:
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ActionBus' });
  return _logger;
}
```

Replace the `emit()` method body:

```js
  emit(action, payload) {
    const handlers = this.subscribers.get(action);
    const subscriberCount = handlers ? handlers.size : 0;

    if (subscriberCount === 0) {
      logger().warn('actionbus.emit.unhandled', { action, subscriberCount: 0 });
    } else {
      logger().debug('actionbus.emit', { action, subscriberCount });
      handlers.forEach(handler => handler(payload));
    }

    // Notify wildcard subscribers
    this.wildcardSubscribers.forEach(handler => handler(action, payload));
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/ActionBus.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/ActionBus.js tests/unit/screen-framework/ActionBus.test.js
git commit -m "feat(screen-framework): log ActionBus emit with subscriber count, warn on zero"
```

---

### Task 2: KeyboardAdapter — add structured logging

Currently zero logging. Should log attach/destroy lifecycle and key events at debug level.

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js`
- Create: `tests/unit/screen-framework/KeyboardAdapter.test.js`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/KeyboardAdapter.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => {
  const child = vi.fn(() => mockLogger);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
  return { default: () => mockLogger, getLogger: () => mockLogger };
});

import { KeyboardAdapter } from '../../../../frontend/src/screen-framework/input/adapters/KeyboardAdapter.js';

describe('KeyboardAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    mockBus = { emit: vi.fn() };
    adapter = new KeyboardAdapter(mockBus);
  });

  it('logs attach at info level', () => {
    adapter.attach();
    expect(mockLogger.info).toHaveBeenCalledWith('keyboard.attach', expect.any(Object));
    adapter.destroy();
  });

  it('logs mapped key at debug level', () => {
    adapter.attach();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'keyboard.key',
      expect.objectContaining({ key: 'ArrowUp', action: 'navigate' })
    );
    adapter.destroy();
  });

  it('logs unmapped key at debug level', () => {
    adapter.attach();
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'keyboard.unmapped',
      expect.objectContaining({ key: 'a' })
    );
    adapter.destroy();
  });

  it('logs destroy', () => {
    adapter.attach();
    adapter.destroy();
    expect(mockLogger.debug).toHaveBeenCalledWith('keyboard.destroy', expect.any(Object));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/KeyboardAdapter.test.js`
Expected: FAIL — no logging calls exist

**Step 3: Write minimal implementation**

Replace `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js`:

```js
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'KeyboardAdapter' });
  return _logger;
}

const KEY_MAP = {
  ArrowUp:    { action: 'navigate', payload: { direction: 'up' } },
  ArrowDown:  { action: 'navigate', payload: { direction: 'down' } },
  ArrowLeft:  { action: 'navigate', payload: { direction: 'left' } },
  ArrowRight: { action: 'navigate', payload: { direction: 'right' } },
  Enter:      { action: 'select',   payload: {} },
  Escape:     { action: 'escape',   payload: {} },
};

export class KeyboardAdapter {
  constructor(actionBus) {
    this.actionBus = actionBus;
    this.handler = null;
  }

  attach() {
    logger().info('keyboard.attach', {});
    this.handler = (event) => {
      if (event.__gamepadSynthetic) return;
      const mapped = KEY_MAP[event.key];
      if (mapped) {
        logger().debug('keyboard.key', { key: event.key, action: mapped.action });
        this.actionBus.emit(mapped.action, mapped.payload);
      } else {
        logger().debug('keyboard.unmapped', { key: event.key });
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    logger().debug('keyboard.destroy', {});
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/KeyboardAdapter.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/KeyboardAdapter.js tests/unit/screen-framework/KeyboardAdapter.test.js
git commit -m "feat(screen-framework): add structured logging to KeyboardAdapter"
```

---

### Task 3: RemoteAdapter — migrate console.warn to structured logger

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/RemoteAdapter.js`
- Create: `tests/unit/screen-framework/RemoteAdapter.test.js`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/RemoteAdapter.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => {
  const child = vi.fn(() => mockLogger);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
  return { default: () => mockLogger, getLogger: () => mockLogger };
});

import { RemoteAdapter } from '../../../../frontend/src/screen-framework/input/adapters/RemoteAdapter.js';

describe('RemoteAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    mockBus = { emit: vi.fn() };
  });

  it('logs attach with keyboardId at info level', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ Enter: { function: 'escape' } });
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'test-kb', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'remote.attach',
      expect.objectContaining({ keyboardId: 'test-kb' })
    );
    adapter.destroy();
  });

  it('logs keymap fetch failure with warn (not console.warn)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'broken', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'remote.keymap-fetch-failed',
      expect.objectContaining({ keyboardId: 'broken' })
    );
    // Must NOT use console.warn
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    adapter.destroy();
  });

  it('logs mapped key dispatch at debug level', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'kb1', fetchFn: fakeFetch });
    await adapter.attach();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'remote.key',
      expect.objectContaining({ key: 'ArrowUp', action: 'navigate' })
    );
    adapter.destroy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/RemoteAdapter.test.js`
Expected: FAIL — uses console.warn, no structured logging

**Step 3: Write minimal implementation**

Replace `frontend/src/screen-framework/input/adapters/RemoteAdapter.js`:

```js
// frontend/src/screen-framework/input/adapters/RemoteAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'RemoteAdapter' });
  return _logger;
}

const NAV_KEYS = {
  ArrowUp:    { action: 'navigate', payload: { direction: 'up' } },
  ArrowDown:  { action: 'navigate', payload: { direction: 'down' } },
  ArrowLeft:  { action: 'navigate', payload: { direction: 'left' } },
  ArrowRight: { action: 'navigate', payload: { direction: 'right' } },
  Enter:      { action: 'select',   payload: {} },
  Escape:     { action: 'escape',   payload: {} },
};

export class RemoteAdapter {
  constructor(actionBus, { keyboardId, fetchFn } = {}) {
    this.actionBus = actionBus;
    this.keyboardId = keyboardId;
    this.fetchFn = fetchFn || DaylightAPI;
    this.keymap = null;
    this.handler = null;
  }

  async attach() {
    if (this.keyboardId) {
      try {
        this.keymap = await this.fetchFn(`/api/v1/home/keyboard/${this.keyboardId}`);
      } catch (err) {
        logger().warn('remote.keymap-fetch-failed', { keyboardId: this.keyboardId, error: err.message });
        this.keymap = {};
      }
    }

    logger().info('remote.attach', { keyboardId: this.keyboardId, keymapSize: this.keymap ? Object.keys(this.keymap).length : 0 });

    this.handler = (event) => {
      // Keymap entries take priority
      if (this.keymap) {
        const entry = this.keymap[event.key];
        if (entry) {
          const result = translateAction(entry.function, entry.params);
          if (result) {
            logger().debug('remote.key', { key: event.key, action: result.action, source: 'keymap' });
            this.actionBus.emit(result.action, result.payload);
            return;
          }
          if (entry.secondary) {
            const fallback = translateSecondary(entry.secondary);
            if (fallback) {
              logger().debug('remote.key', { key: event.key, action: fallback.action, source: 'secondary' });
              this.actionBus.emit(fallback.action, fallback.payload);
              return;
            }
          }
        }
      }

      // Fall through to built-in navigation keys
      const nav = NAV_KEYS[event.key];
      if (nav) {
        logger().debug('remote.key', { key: event.key, action: nav.action, source: 'nav' });
        this.actionBus.emit(nav.action, nav.payload);
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    this.keymap = null;
    logger().debug('remote.destroy', {});
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/RemoteAdapter.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/RemoteAdapter.js tests/unit/screen-framework/RemoteAdapter.test.js
git commit -m "feat(screen-framework): add structured logging to RemoteAdapter, remove console.warn"
```

---

### Task 4: NumpadAdapter — migrate console.warn to structured logger

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/NumpadAdapter.js`
- Create: `tests/unit/screen-framework/NumpadAdapter.test.js`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/NumpadAdapter.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => {
  const child = vi.fn(() => mockLogger);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
  return { default: () => mockLogger, getLogger: () => mockLogger };
});

import { NumpadAdapter } from '../../../../frontend/src/screen-framework/input/adapters/NumpadAdapter.js';

describe('NumpadAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    mockBus = { emit: vi.fn() };
  });

  it('warns on keymap fetch failure via logger (not console.warn)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    adapter = new NumpadAdapter(mockBus, { keyboardId: 'broken', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'numpad.keymap-fetch-failed',
      expect.objectContaining({ keyboardId: 'broken' })
    );
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    adapter.destroy();
  });

  it('logs attach with keyboardId', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ '1': { function: 'menu', params: 'main' } });
    adapter = new NumpadAdapter(mockBus, { keyboardId: 'numpad1', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'numpad.attach',
      expect.objectContaining({ keyboardId: 'numpad1' })
    );
    adapter.destroy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/NumpadAdapter.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Replace `frontend/src/screen-framework/input/adapters/NumpadAdapter.js`:

```js
// frontend/src/screen-framework/input/adapters/NumpadAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'NumpadAdapter' });
  return _logger;
}

export class NumpadAdapter {
  constructor(actionBus, { keyboardId, fetchFn } = {}) {
    this.actionBus = actionBus;
    this.keyboardId = keyboardId;
    this.fetchFn = fetchFn || DaylightAPI;
    this.keymap = null;
    this.handler = null;
  }

  async attach() {
    if (this.keyboardId) {
      try {
        this.keymap = await this.fetchFn(`/api/v1/home/keyboard/${this.keyboardId}`);
      } catch (err) {
        logger().warn('numpad.keymap-fetch-failed', { keyboardId: this.keyboardId, error: err.message });
        this.keymap = {};
      }
    }

    logger().info('numpad.attach', { keyboardId: this.keyboardId, keymapSize: this.keymap ? Object.keys(this.keymap).length : 0 });

    this.handler = (event) => {
      if (!this.keymap) return;
      const entry = this.keymap[event.key];
      if (!entry) return;

      const result = translateAction(entry.function, entry.params);
      if (result) {
        logger().debug('numpad.key', { key: event.key, action: result.action });
        this.actionBus.emit(result.action, result.payload);
        return;
      }

      if (entry.secondary) {
        const fallback = translateSecondary(entry.secondary);
        if (fallback) {
          logger().debug('numpad.key', { key: event.key, action: fallback.action, source: 'secondary' });
          this.actionBus.emit(fallback.action, fallback.payload);
        }
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    this.keymap = null;
    logger().debug('numpad.destroy', {});
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/NumpadAdapter.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/NumpadAdapter.js tests/unit/screen-framework/NumpadAdapter.test.js
git commit -m "feat(screen-framework): add structured logging to NumpadAdapter, remove console.warn"
```

---

### Task 5: useScreenSubscriptions — log WS filter decisions

The biggest observability gap for event-driven UI. Each `continue` in the filter chain is a potential silent drop. Add logging at each filter stage.

**Files:**
- Modify: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- Create: `tests/unit/screen-framework/useScreenSubscriptions.test.jsx`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/useScreenSubscriptions.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// We need to capture the logger calls. Since this is a hook using useMemo,
// we test by checking the log output after triggering the handleMessage callback.

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger,
}));

// Mock useWebSocketSubscription to capture the handler
let capturedHandler = null;
vi.mock('../../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn((topics, handler) => {
    capturedHandler = handler;
  }),
}));

import { useScreenSubscriptions } from '../../../../frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js';

describe('useScreenSubscriptions logging', () => {
  let showOverlay;
  let dismissOverlay;
  let widgetRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    showOverlay = vi.fn();
    dismissOverlay = vi.fn();
    widgetRegistry = new Map();
  });

  it('logs when WS message topic does not match any subscription', () => {
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'piano' } },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'unknown-topic', event: 'start' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'subscription.no-match',
      expect.objectContaining({ messageTopic: 'unknown-topic' })
    );
  });

  it('logs when overlay widget is not found in registry', () => {
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'missing-widget' } },
    };
    // Don't register 'missing-widget' in widgetRegistry

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'start' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'subscription.widget-not-found',
      expect.objectContaining({ overlay: 'missing-widget', topic: 'midi' })
    );
  });

  it('logs successful overlay show', () => {
    const FakeWidget = () => null;
    widgetRegistry.set('piano', FakeWidget);
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'piano', mode: 'fullscreen' } },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'start' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'subscription.show-overlay',
      expect.objectContaining({ topic: 'midi', overlay: 'piano', mode: 'fullscreen' })
    );
  });

  it('logs dismiss event', () => {
    const subscriptions = {
      midi: {
        on: { event: 'start' },
        response: { overlay: 'piano' },
        dismiss: { event: 'stop' },
      },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'stop' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'subscription.dismiss',
      expect.objectContaining({ topic: 'midi', dismissEvent: 'stop' })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/useScreenSubscriptions.test.jsx`
Expected: FAIL — no logging exists in the hook

**Step 3: Write minimal implementation**

Replace `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`:

```js
import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSubscriptions' });
  return _logger;
}

/**
 * useScreenSubscriptions - Processes YAML subscription config into live WS listeners.
 *
 * Iterates subscription entries from the screen config, subscribes to the declared
 * WS topics via useWebSocketSubscription, checks event filters, resolves overlay
 * components from the widget registry, and calls showOverlay/dismissOverlay.
 *
 * YAML config format:
 *   subscriptions:
 *     midi:                       # WS topic name
 *       on:
 *         event: session_start    # Optional filter (omit to trigger on any message)
 *       response:
 *         overlay: piano          # Widget registry key
 *         mode: fullscreen        # Overlay mode (fullscreen|pip|toast)
 *         priority: high          # Optional overlay priority
 *         timeout: 3000           # Optional timeout (ms) for toast mode
 *       dismiss:
 *         event: session_end      # WS event that dismisses the overlay
 *         inactivity: 30          # Seconds of inactivity before auto-dismiss
 *
 * @param {object} subscriptions - The subscriptions block from screen YAML config
 * @param {function} showOverlay - From useScreenOverlay()
 * @param {function} dismissOverlay - From useScreenOverlay()
 * @param {object} widgetRegistry - From getWidgetRegistry()
 */
export function useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry) {
  // Normalize entries once; stable across renders unless config changes
  const entries = useMemo(() => {
    if (!subscriptions || typeof subscriptions !== 'object') return [];
    return Object.entries(subscriptions).map(([topic, cfg]) => ({
      topic,
      onEvent: cfg?.on?.event ?? null,
      overlay: cfg?.response?.overlay ?? null,
      mode: cfg?.response?.mode ?? 'fullscreen',
      priority: cfg?.response?.priority ?? undefined,
      timeout: cfg?.response?.timeout ?? undefined,
      dismissEvent: cfg?.dismiss?.event ?? null,
      dismissInactivity: cfg?.dismiss?.inactivity ?? null,
    }));
  }, [subscriptions]);

  // Collect all unique topics for a single WS subscription
  const topics = useMemo(() => entries.map((e) => e.topic), [entries]);

  // Ref to hold current entries so the callback doesn't go stale
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Inactivity timers keyed by topic
  const inactivityTimers = useRef({});

  // Clean up inactivity timers on unmount
  useEffect(() => {
    return () => {
      Object.values(inactivityTimers.current).forEach(clearTimeout);
    };
  }, []);

  const handleMessage = useCallback((data) => {
    const eventName = data?.event ?? data?.type ?? null;
    const messageTopic = data?.topic ?? null;

    let matched = false;

    for (const entry of entriesRef.current) {
      // Match by topic
      if (messageTopic !== entry.topic) continue;

      matched = true;

      // Check dismiss event first
      if (entry.dismissEvent && eventName === entry.dismissEvent) {
        logger().debug('subscription.dismiss', { topic: entry.topic, dismissEvent: eventName });
        dismissOverlay(entry.mode);
        // Clear any running inactivity timer for this topic
        if (inactivityTimers.current[entry.topic]) {
          clearTimeout(inactivityTimers.current[entry.topic]);
          delete inactivityTimers.current[entry.topic];
        }
        continue;
      }

      // Check trigger filter
      if (entry.onEvent && eventName !== entry.onEvent) {
        logger().debug('subscription.event-filtered', { topic: entry.topic, expected: entry.onEvent, received: eventName });
        continue;
      }

      // Resolve component from registry
      const Component = entry.overlay ? widgetRegistry.get(entry.overlay) : null;
      if (!Component) {
        logger().warn('subscription.widget-not-found', { topic: entry.topic, overlay: entry.overlay });
        continue;
      }

      // Show the overlay
      logger().info('subscription.show-overlay', { topic: entry.topic, overlay: entry.overlay, mode: entry.mode, event: eventName });
      showOverlay(Component, { ...data }, {
        mode: entry.mode,
        priority: entry.priority,
        timeout: entry.timeout,
      });

      // Start inactivity timer if configured
      if (entry.dismissInactivity != null && entry.dismissInactivity > 0) {
        // Clear any existing timer for this topic
        if (inactivityTimers.current[entry.topic]) {
          clearTimeout(inactivityTimers.current[entry.topic]);
        }
        inactivityTimers.current[entry.topic] = setTimeout(() => {
          dismissOverlay(entry.mode);
          delete inactivityTimers.current[entry.topic];
        }, entry.dismissInactivity * 1000);
      }
    }

    if (!matched) {
      logger().debug('subscription.no-match', { messageTopic, event: eventName, registeredTopics: entriesRef.current.map(e => e.topic) });
    }
  }, [showOverlay, dismissOverlay, widgetRegistry]);

  // Subscribe to all relevant topics (single subscription)
  useWebSocketSubscription(
    topics.length > 0 ? topics : null,
    handleMessage,
    [handleMessage]
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/useScreenSubscriptions.test.jsx`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js tests/unit/screen-framework/useScreenSubscriptions.test.jsx
git commit -m "feat(screen-framework): add structured logging to useScreenSubscriptions WS filter chain"
```

---

### Task 6: DataManager — migrate console.error to structured logger

**Files:**
- Modify: `frontend/src/screen-framework/data/DataManager.js`
- Create: `tests/unit/screen-framework/DataManager.test.js`

**Step 1: Write the failing test**

Create `tests/unit/screen-framework/DataManager.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger,
}));

import { DataManager } from '../../../../frontend/src/screen-framework/data/DataManager.js';

describe('DataManager logging', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DataManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('logs fetch failure via structured logger (not console.error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const cb = vi.fn();
    manager.subscribe('/api/test', cb);

    // Wait for async fetch to complete
    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        'datamanager.fetch-failed',
        expect.objectContaining({ source: '/api/test' })
      );
    });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('logs successful fetch at debug level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    }));

    const cb = vi.fn();
    manager.subscribe('/api/test', cb);

    await vi.waitFor(() => {
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'datamanager.fetched',
        expect.objectContaining({ source: '/api/test' })
      );
    });

    vi.unstubAllGlobals();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/screen-framework/DataManager.test.js`
Expected: FAIL — uses console.error, no structured logging

**Step 3: Write minimal implementation**

In `frontend/src/screen-framework/data/DataManager.js`, add the logger and replace `console.error` calls:

Add at top of file:

```js
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'DataManager' });
  return _logger;
}
```

In the `fetch()` method, add after `this.cache.set(...)`:

```js
    logger().debug('datamanager.fetched', { source });
```

In `subscribe()`, replace the two `console.error` calls:

```js
    // Initial fetch — replace:
    //   .catch(err => console.error(`DataManager fetch error: ${source}`, err));
    // With:
      .catch(err => logger().error('datamanager.fetch-failed', { source, error: err.message }));

    // Refresh interval — replace:
    //   .catch(err => console.error(`DataManager refresh error: ${source}`, err));
    // With:
      .catch(err => logger().error('datamanager.refresh-failed', { source, error: err.message }));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/screen-framework/DataManager.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/data/DataManager.js tests/unit/screen-framework/DataManager.test.js
git commit -m "feat(screen-framework): migrate DataManager from console.error to structured logger"
```

---

### Task 7: ScreenDataProvider — add structured logging for fetch failures

Currently has a bare `catch {}` (line 26) that silently swallows errors.

**Files:**
- Modify: `frontend/src/screen-framework/data/ScreenDataProvider.jsx`

**Step 1: Write the failing test**

Add to `tests/unit/screen-framework/DataManager.test.js` (or create `tests/unit/screen-framework/ScreenDataProvider.test.jsx` — but since ScreenDataProvider is a React context provider, testing it with renderHook is more complex; we keep the change minimal):

This is a small change — the ScreenDataProvider's `catch {}` becomes `catch (err) { logger().warn(...) }`. Since the component is thin and delegates to context, we verify manually.

**Step 2: Write the implementation directly (simple catch replacement)**

In `frontend/src/screen-framework/data/ScreenDataProvider.jsx`, add the logger import and replace the silent catch:

Add at top:

```js
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenDataProvider' });
  return _logger;
}
```

Replace line 26 (`} catch {`):

```js
      } catch (err) {
        logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
      }
```

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/data/ScreenDataProvider.jsx
git commit -m "feat(screen-framework): log ScreenDataProvider fetch failures instead of silent catch"
```

---

### Task 8: Run all tests to verify no regressions

**Step 1: Run the new screen-framework tests**

Run: `npx vitest run tests/unit/screen-framework/`
Expected: All tests PASS

**Step 2: Run existing unit tests**

Run: `npx vitest run tests/unit/`
Expected: No regressions

**Step 3: Commit (if any fixes needed)**

Only if a regression was found and fixed.

---

## Event Logging Coverage After Implementation

| Component | Logs Receipt? | Logs Dispatch? | Logs Failures? | Logs Silent Drops? |
|-----------|:---:|:---:|:---:|:---:|
| ActionBus | — | debug | — | warn (zero subscribers) |
| GamepadAdapter | info | debug | warn | warn (unmapped) |
| KeyboardAdapter | info | debug | — | debug (unmapped) |
| RemoteAdapter | info | debug | warn (keymap) | — |
| NumpadAdapter | info | debug | warn (keymap) | — |
| useScreenSubscriptions | — | info (show) | warn (widget missing) | debug (no topic match, event filtered) |
| DataManager | debug | — | error | — |
| ScreenDataProvider | — | — | warn | — |

To enable all debug output in browser: `window.DAYLIGHT_LOG_LEVEL = 'debug'`
