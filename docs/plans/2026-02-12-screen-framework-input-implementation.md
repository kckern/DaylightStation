# Screen Framework Input System - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire input adapters into the screen framework so hardware keypresses translate into ActionBus events.

**Architecture:** Three adapter types (KeyboardAdapter, NumpadAdapter, RemoteAdapter) each listen on `window` for keydown events, translate keys via a shared action map, and emit standardized actions to the singleton ActionBus. An InputManager factory selects the right adapter from YAML config. A `useScreenAction` hook lets widgets subscribe.

**Tech Stack:** React hooks, Vitest (happy-dom), `@testing-library/react`, existing ActionBus singleton, existing `/api/v1/home/keyboard/:id` backend endpoint.

**Design doc:** `docs/plans/2026-02-12-screen-framework-input-system.md`

**Test runner:** `cd frontend && npx vitest run <path>` (all screen-framework tests use Vitest with happy-dom)

---

### Task 1: Action Map — Translation Table

Pure logic module. No React, no DOM, no fetch. Maps legacy keymap function names (`menu`, `play`, `playback`, etc.) to standardized ActionBus action names (`menu:open`, `media:play`, etc.). Also handles the `secondary` fallback string format (`"menu:video"` → parse and translate).

**Files:**
- Create: `frontend/src/screen-framework/input/actionMap.js`
- Test: `frontend/src/screen-framework/input/actionMap.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/actionMap.test.js
import { describe, it, expect } from 'vitest';
import { translateAction, translateSecondary, ACTION_MAP } from './actionMap.js';

describe('actionMap', () => {
  describe('translateAction', () => {
    it('should translate menu to menu:open', () => {
      expect(translateAction('menu', 'music')).toEqual({
        action: 'menu:open', payload: { menuId: 'music' }
      });
    });

    it('should translate play to media:play', () => {
      expect(translateAction('play', 'scripture:1-ne-1')).toEqual({
        action: 'media:play', payload: { contentId: 'scripture:1-ne-1' }
      });
    });

    it('should translate queue to media:queue', () => {
      expect(translateAction('queue', 'hymn:2')).toEqual({
        action: 'media:queue', payload: { contentId: 'hymn:2' }
      });
    });

    it('should translate playback to media:playback', () => {
      expect(translateAction('playback', 'pause')).toEqual({
        action: 'media:playback', payload: { command: 'pause' }
      });
    });

    it('should translate escape to escape', () => {
      expect(translateAction('escape')).toEqual({
        action: 'escape', payload: {}
      });
    });

    it('should translate volume to display:volume', () => {
      expect(translateAction('volume', '+1')).toEqual({
        action: 'display:volume', payload: { command: '+1' }
      });
    });

    it('should translate shader to display:shader', () => {
      expect(translateAction('shader')).toEqual({
        action: 'display:shader', payload: {}
      });
    });

    it('should translate sleep to display:sleep', () => {
      expect(translateAction('sleep')).toEqual({
        action: 'display:sleep', payload: {}
      });
    });

    it('should translate rate to media:rate', () => {
      expect(translateAction('rate')).toEqual({
        action: 'media:rate', payload: {}
      });
    });

    it('should return null for unknown function', () => {
      expect(translateAction('unknown', 'params')).toBeNull();
    });
  });

  describe('translateSecondary', () => {
    it('should parse and translate secondary action string', () => {
      expect(translateSecondary('menu:video')).toEqual({
        action: 'menu:open', payload: { menuId: 'video' }
      });
    });

    it('should return null for null input', () => {
      expect(translateSecondary(null)).toBeNull();
    });

    it('should return null for string without colon', () => {
      expect(translateSecondary('invalid')).toBeNull();
    });

    it('should return null for unknown function in secondary', () => {
      expect(translateSecondary('unknown:params')).toBeNull();
    });

    it('should handle whitespace around colon', () => {
      expect(translateSecondary(' play : scripture:1-ne-1 ')).toEqual({
        action: 'media:play', payload: { contentId: 'scripture:1-ne-1' }
      });
    });
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/actionMap.test.js
```

Expected: FAIL — `actionMap.js` does not exist yet.

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/actionMap.js
const ACTION_MAP = {
  menu:     (params) => ({ action: 'menu:open', payload: { menuId: params } }),
  play:     (params) => ({ action: 'media:play', payload: { contentId: params } }),
  queue:    (params) => ({ action: 'media:queue', payload: { contentId: params } }),
  playback: (params) => ({ action: 'media:playback', payload: { command: params } }),
  escape:   ()       => ({ action: 'escape', payload: {} }),
  volume:   (params) => ({ action: 'display:volume', payload: { command: params } }),
  shader:   ()       => ({ action: 'display:shader', payload: {} }),
  sleep:    ()       => ({ action: 'display:sleep', payload: {} }),
  rate:     ()       => ({ action: 'media:rate', payload: {} }),
};

export function translateAction(functionName, params) {
  const translator = ACTION_MAP[functionName];
  if (!translator) return null;
  return translator(params);
}

export function translateSecondary(secondary) {
  if (!secondary || typeof secondary !== 'string') return null;
  const colonIndex = secondary.indexOf(':');
  if (colonIndex === -1) return null;
  const fn = secondary.substring(0, colonIndex).trim().toLowerCase();
  const params = secondary.substring(colonIndex + 1).trim();
  return translateAction(fn, params);
}

export { ACTION_MAP };
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/actionMap.test.js
```

Expected: all 15 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/actionMap.js frontend/src/screen-framework/input/actionMap.test.js
git commit -m "feat(screen-framework): add action map translation table"
```

---

### Task 2: KeyboardAdapter — Dev Fallback

Hardcoded dev adapter: arrows → `navigate`, Enter → `select`, Escape → `escape`. No keymap fetch. Simplest adapter — establishes the adapter interface pattern (constructor, `attach()`, `destroy()`).

**Files:**
- Create: `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js`
- Test: `frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { KeyboardAdapter } from './KeyboardAdapter.js';

describe('KeyboardAdapter', () => {
  let bus;
  let adapter;

  beforeEach(() => {
    bus = new ActionBus();
    adapter = new KeyboardAdapter(bus);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('should emit navigate with direction for each arrow key', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'up' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'down' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'left' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handler).toHaveBeenCalledWith({ direction: 'right' });
  });

  it('should emit select on Enter', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handler).toHaveBeenCalledWith({});
  });

  it('should emit escape on Escape', () => {
    const handler = vi.fn();
    bus.subscribe('escape', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handler).toHaveBeenCalledWith({});
  });

  it('should ignore unmapped keys', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);
    adapter.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop emitting after destroy', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    adapter.attach();
    adapter.destroy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(handler).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/KeyboardAdapter.test.js
```

Expected: FAIL — `KeyboardAdapter.js` does not exist.

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/adapters/KeyboardAdapter.js
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
    this.handler = (event) => {
      const mapped = KEY_MAP[event.key];
      if (mapped) {
        this.actionBus.emit(mapped.action, mapped.payload);
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
  }
}
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/KeyboardAdapter.test.js
```

Expected: all 5 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/KeyboardAdapter.js frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js
git commit -m "feat(screen-framework): add KeyboardAdapter dev fallback"
```

---

### Task 3: NumpadAdapter — Keymap-Based Input

Fetches keymap from `/api/v1/home/keyboard/{keyboardId}`, translates numpad keypresses via `actionMap.translateAction`. Falls back to `translateSecondary` when primary function is unknown. Accepts `fetchFn` for test injection.

**Files:**
- Create: `frontend/src/screen-framework/input/adapters/NumpadAdapter.js`
- Test: `frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { NumpadAdapter } from './NumpadAdapter.js';

describe('NumpadAdapter', () => {
  let bus;
  let adapter;

  const mockKeymap = {
    '1': { label: 'Music', function: 'menu', params: 'music' },
    '2': { label: 'Play/Pause', function: 'playback', params: 'play', secondary: 'menu:video' },
    '3': { label: 'Scripture', function: 'play', params: 'scripture:1-ne-1' },
  };

  beforeEach(() => {
    bus = new ActionBus();
  });

  afterEach(() => {
    if (adapter) adapter.destroy();
  });

  it('should fetch keymap and translate mapped key to action', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(fetchFn).toHaveBeenCalledWith('/api/v1/home/keyboard/officekeypad');
    expect(handler).toHaveBeenCalledWith({ menuId: 'music' });
  });

  it('should try secondary when primary function is unknown', async () => {
    const keymapWithUnknown = {
      '5': { label: 'Special', function: 'unknownfn', params: 'x', secondary: 'menu:settings' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymapWithUnknown);
    adapter = new NumpadAdapter(bus, { keyboardId: 'test', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }));

    expect(handler).toHaveBeenCalledWith({ menuId: 'settings' });
  });

  it('should ignore keys not in keymap', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('*', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle fetch failure gracefully', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
    adapter = new NumpadAdapter(bus, { keyboardId: 'bad', fetchFn });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await adapter.attach();
    warnSpy.mockRestore();

    const handler = vi.fn();
    bus.subscribe('*', handler);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should stop listening after destroy', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockKeymap);
    adapter = new NumpadAdapter(bus, { keyboardId: 'officekeypad', fetchFn });

    const handler = vi.fn();
    bus.subscribe('menu:open', handler);

    await adapter.attach();
    adapter.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/NumpadAdapter.test.js
```

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/adapters/NumpadAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';

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
        console.warn(`NumpadAdapter: failed to fetch keymap for "${this.keyboardId}"`, err);
        this.keymap = {};
      }
    }

    this.handler = (event) => {
      if (!this.keymap) return;
      const entry = this.keymap[event.key];
      if (!entry) return;

      const result = translateAction(entry.function, entry.params);
      if (result) {
        this.actionBus.emit(result.action, result.payload);
        return;
      }

      if (entry.secondary) {
        const fallback = translateSecondary(entry.secondary);
        if (fallback) {
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
  }
}
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/NumpadAdapter.test.js
```

Expected: all 5 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/NumpadAdapter.js frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js
git commit -m "feat(screen-framework): add NumpadAdapter with keymap fetch and secondary fallback"
```

---

### Task 4: RemoteAdapter — Keymap + Navigation Fallthrough

Same keymap fetch pattern as NumpadAdapter, but also emits `navigate`/`select`/`escape` for arrow/enter/escape keys that have no keymap entry. Keymap entries take priority over nav fallthrough (so if ArrowUp is mapped to `volume:+1` in the keymap, it emits `display:volume` instead of `navigate`).

**Files:**
- Create: `frontend/src/screen-framework/input/adapters/RemoteAdapter.js`
- Test: `frontend/src/screen-framework/input/adapters/RemoteAdapter.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/adapters/RemoteAdapter.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { RemoteAdapter } from './RemoteAdapter.js';

describe('RemoteAdapter', () => {
  let bus;
  let adapter;

  beforeEach(() => {
    bus = new ActionBus();
  });

  afterEach(() => {
    if (adapter) adapter.destroy();
  });

  it('should emit navigate for arrow keys with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('navigate', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(handler).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should emit select for Enter with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('select', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(handler).toHaveBeenCalledWith({});
  });

  it('should emit escape for Escape with no keymap entry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('escape', handler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handler).toHaveBeenCalledWith({});
  });

  it('should translate keymap entries and NOT fall through to nav', async () => {
    const keymap = {
      'MediaPlayPause': { label: 'Play/Pause', function: 'playback', params: 'play' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymap);
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const playHandler = vi.fn();
    const navHandler = vi.fn();
    bus.subscribe('media:playback', playHandler);
    bus.subscribe('navigate', navHandler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause' }));

    expect(playHandler).toHaveBeenCalledWith({ command: 'play' });
    expect(navHandler).not.toHaveBeenCalled();
  });

  it('should prefer keymap over nav when both match', async () => {
    const keymap = {
      'ArrowUp': { label: 'Volume Up', function: 'volume', params: '+1' },
    };
    const fetchFn = vi.fn().mockResolvedValue(keymap);
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const volHandler = vi.fn();
    const navHandler = vi.fn();
    bus.subscribe('display:volume', volHandler);
    bus.subscribe('navigate', navHandler);

    await adapter.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(volHandler).toHaveBeenCalledWith({ command: '+1' });
    expect(navHandler).not.toHaveBeenCalled();
  });

  it('should stop listening after destroy', async () => {
    const fetchFn = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(bus, { keyboardId: 'tvremote', fetchFn });

    const handler = vi.fn();
    bus.subscribe('navigate', handler);

    await adapter.attach();
    adapter.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(handler).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/RemoteAdapter.test.js
```

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/adapters/RemoteAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';

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
        console.warn(`RemoteAdapter: failed to fetch keymap for "${this.keyboardId}"`, err);
        this.keymap = {};
      }
    }

    this.handler = (event) => {
      // Keymap entries take priority
      if (this.keymap) {
        const entry = this.keymap[event.key];
        if (entry) {
          const result = translateAction(entry.function, entry.params);
          if (result) {
            this.actionBus.emit(result.action, result.payload);
            return;
          }
          if (entry.secondary) {
            const fallback = translateSecondary(entry.secondary);
            if (fallback) {
              this.actionBus.emit(fallback.action, fallback.payload);
              return;
            }
          }
        }
      }

      // Fall through to built-in navigation keys
      const nav = NAV_KEYS[event.key];
      if (nav) {
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
  }
}
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/RemoteAdapter.test.js
```

Expected: all 6 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/RemoteAdapter.js frontend/src/screen-framework/input/adapters/RemoteAdapter.test.js
git commit -m "feat(screen-framework): add RemoteAdapter with keymap priority and nav fallthrough"
```

---

### Task 5: InputManager — Adapter Factory

Factory function that reads `config.input` and creates the right adapter. Returns a handle with `destroy()` for cleanup. No backward-compat string parsing — `inputConfig` must be an object with `type`.

**Files:**
- Create: `frontend/src/screen-framework/input/InputManager.js`
- Test: `frontend/src/screen-framework/input/InputManager.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/InputManager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionBus } from './ActionBus.js';
import { createInputManager } from './InputManager.js';

vi.mock('./adapters/KeyboardAdapter.js', () => ({
  KeyboardAdapter: vi.fn().mockImplementation(() => ({
    attach: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('./adapters/NumpadAdapter.js', () => ({
  NumpadAdapter: vi.fn().mockImplementation(() => ({
    attach: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

vi.mock('./adapters/RemoteAdapter.js', () => ({
  RemoteAdapter: vi.fn().mockImplementation(() => ({
    attach: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';

describe('InputManager', () => {
  let bus;

  beforeEach(() => {
    bus = new ActionBus();
    vi.clearAllMocks();
  });

  it('should create NumpadAdapter for type numpad', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'officekeypad' });
    expect(NumpadAdapter).toHaveBeenCalledWith(bus, { keyboardId: 'officekeypad' });
    manager.destroy();
  });

  it('should create RemoteAdapter for type remote', () => {
    const manager = createInputManager(bus, { type: 'remote', keyboard_id: 'tvremote' });
    expect(RemoteAdapter).toHaveBeenCalledWith(bus, { keyboardId: 'tvremote' });
    manager.destroy();
  });

  it('should create KeyboardAdapter for type keyboard', () => {
    const manager = createInputManager(bus, { type: 'keyboard' });
    expect(KeyboardAdapter).toHaveBeenCalledWith(bus);
    manager.destroy();
  });

  it('should default to KeyboardAdapter for unknown type', () => {
    const manager = createInputManager(bus, { type: 'unknown' });
    expect(KeyboardAdapter).toHaveBeenCalledWith(bus);
    manager.destroy();
  });

  it('should return no-op handle for null config', () => {
    const manager = createInputManager(bus, null);
    expect(NumpadAdapter).not.toHaveBeenCalled();
    expect(RemoteAdapter).not.toHaveBeenCalled();
    expect(KeyboardAdapter).not.toHaveBeenCalled();
    manager.destroy(); // should not throw
  });

  it('should call attach on the created adapter', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'test' });
    expect(manager.adapter.attach).toHaveBeenCalled();
    manager.destroy();
  });

  it('should call destroy on adapter when manager.destroy is called', () => {
    const manager = createInputManager(bus, { type: 'numpad', keyboard_id: 'test' });
    const adapterDestroy = manager.adapter.destroy;
    manager.destroy();
    expect(adapterDestroy).toHaveBeenCalled();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/InputManager.test.js
```

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/InputManager.js
import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';

export function createInputManager(actionBus, inputConfig) {
  if (!inputConfig || !inputConfig.type || !actionBus) {
    return { adapter: null, ready: Promise.resolve(), destroy() {} };
  }

  const { type, keyboard_id } = inputConfig;
  let adapter;

  switch (type) {
    case 'numpad':
      adapter = new NumpadAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'remote':
      adapter = new RemoteAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'keyboard':
    default:
      adapter = new KeyboardAdapter(actionBus);
      break;
  }

  const attachResult = adapter.attach();
  const ready = attachResult instanceof Promise ? attachResult : Promise.resolve();

  return {
    adapter,
    ready,
    destroy() { adapter.destroy(); },
  };
}
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/InputManager.test.js
```

Expected: all 7 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/InputManager.js frontend/src/screen-framework/input/InputManager.test.js
git commit -m "feat(screen-framework): add InputManager adapter factory"
```

---

### Task 6: useScreenAction — Widget Subscription Hook

React hook that subscribes to a specific ActionBus action. Widgets call `useScreenAction('navigate', handler)` to receive input events. Unsubscribes on unmount.

**Files:**
- Create: `frontend/src/screen-framework/input/useScreenAction.js`
- Test: `frontend/src/screen-framework/input/useScreenAction.test.js`

**Step 1: Write the failing test**

```js
// frontend/src/screen-framework/input/useScreenAction.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resetActionBus, getActionBus } from './ActionBus.js';
import { useScreenAction } from './useScreenAction.js';

describe('useScreenAction', () => {
  beforeEach(() => { resetActionBus(); });
  afterEach(() => { resetActionBus(); });

  it('should subscribe to the action on mount', () => {
    const handler = vi.fn();
    renderHook(() => useScreenAction('navigate', handler));

    getActionBus().emit('navigate', { direction: 'up' });
    expect(handler).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should unsubscribe on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useScreenAction('select', handler));
    unmount();

    getActionBus().emit('select', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not subscribe if action is null', () => {
    const handler = vi.fn();
    renderHook(() => useScreenAction(null, handler));

    getActionBus().emit('navigate', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not subscribe if handler is null', () => {
    renderHook(() => useScreenAction('navigate', null));

    // Should not throw
    getActionBus().emit('navigate', {});
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/useScreenAction.test.js
```

**Step 3: Write minimal implementation**

```js
// frontend/src/screen-framework/input/useScreenAction.js
import { useEffect } from 'react';
import { getActionBus } from './ActionBus.js';

export function useScreenAction(action, handler) {
  useEffect(() => {
    if (!action || !handler) return;
    const bus = getActionBus();
    return bus.subscribe(action, handler);
  }, [action, handler]);
}
```

**Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/screen-framework/input/useScreenAction.test.js
```

Expected: all 4 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/useScreenAction.js frontend/src/screen-framework/input/useScreenAction.test.js
git commit -m "feat(screen-framework): add useScreenAction widget subscription hook"
```

---

### Task 7: Wire ScreenRenderer

Add a `useEffect` to `ScreenRenderer.jsx` that initializes InputManager when the screen config loads, and tears it down on unmount or config change.

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

**Step 1: Add InputManager import** (line 7)

Change line 7 from:
```js
import { getActionBus } from './input/ActionBus.js';
```
to:
```js
import { getActionBus } from './input/ActionBus.js';
import { createInputManager } from './input/InputManager.js';
```

**Step 2: Add input initialization useEffect**

Insert after the existing config fetch `useEffect` (after line 44), before the loading check (line 46):

```jsx
  // Initialize input adapter when config is loaded
  useEffect(() => {
    if (!config?.input) return;
    const manager = createInputManager(getActionBus(), config.input);
    return () => manager.destroy();
  }, [config]);
```

**Step 3: Run all screen-framework tests**

```bash
cd frontend && npx vitest run src/screen-framework/
```

Expected: all existing tests still pass (ScreenRenderer has no unit tests, but this validates no import breakage).

**Step 4: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen-framework): wire InputManager into ScreenRenderer lifecycle"
```

---

### Task 8: Update index.js Exports

Add exports for the new input modules so consumers can import from the barrel.

**Files:**
- Modify: `frontend/src/screen-framework/index.js`

**Step 1: Add new exports**

After line 15 (`export { ActionBus, ... }`), add:

```js
export { createInputManager } from './input/InputManager.js';
export { useScreenAction } from './input/useScreenAction.js';
export { translateAction, translateSecondary, ACTION_MAP } from './input/actionMap.js';
export { KeyboardAdapter } from './input/adapters/KeyboardAdapter.js';
export { NumpadAdapter } from './input/adapters/NumpadAdapter.js';
export { RemoteAdapter } from './input/adapters/RemoteAdapter.js';
```

**Step 2: Run all screen-framework tests**

```bash
cd frontend && npx vitest run src/screen-framework/
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/index.js
git commit -m "feat(screen-framework): export input system from barrel"
```

---

### Task 9: Update Screen YAML Configs

Update `office.yml` and `tv.yml` to use the object format for the `input` field. These files live in the data directory (`data/household/screens/`). If the directory or files don't exist yet, create them.

**Files:**
- Create/Modify: `data/household/screens/office.yml` — change `input: numpad` to object format
- Create/Modify: `data/household/screens/tv.yml` — change `input: remote` to object format

**Step 1: Update the input field in each config**

In `office.yml`, replace:
```yaml
input: numpad
```
with:
```yaml
input:
  type: numpad
  keyboard_id: officekeypad
```

In `tv.yml`, replace:
```yaml
input: remote
```
with:
```yaml
input:
  type: remote
  keyboard_id: tvremote
```

Leave all other fields unchanged.

**Step 2: Commit**

```bash
git add data/household/screens/office.yml data/household/screens/tv.yml
git commit -m "config: expand screen input field to object format"
```

---

## Final Verification

After all tasks complete, run the full screen-framework test suite:

```bash
cd frontend && npx vitest run src/screen-framework/
```

Expected: all tests pass — the 4 existing test files + 6 new test files (actionMap, KeyboardAdapter, NumpadAdapter, RemoteAdapter, InputManager, useScreenAction).

## File Summary

### Created (12 files)

| File | Purpose |
|------|---------|
| `frontend/src/screen-framework/input/actionMap.js` | Translation table: legacy function names → action names |
| `frontend/src/screen-framework/input/actionMap.test.js` | 15 tests |
| `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js` | Dev fallback: arrows/enter/escape |
| `frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js` | 5 tests |
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Keymap-based numpad adapter |
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js` | 5 tests |
| `frontend/src/screen-framework/input/adapters/RemoteAdapter.js` | Keymap + nav fallthrough adapter |
| `frontend/src/screen-framework/input/adapters/RemoteAdapter.test.js` | 6 tests |
| `frontend/src/screen-framework/input/InputManager.js` | Adapter factory |
| `frontend/src/screen-framework/input/InputManager.test.js` | 7 tests |
| `frontend/src/screen-framework/input/useScreenAction.js` | Widget subscription hook |
| `frontend/src/screen-framework/input/useScreenAction.test.js` | 4 tests |

### Modified (2 files)

| File | Change |
|------|--------|
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Import + useEffect for InputManager lifecycle |
| `frontend/src/screen-framework/index.js` | Export new input modules |

### Config (2 files)

| File | Change |
|------|--------|
| `data/household/screens/office.yml` | `input` → `{ type: numpad, keyboard_id: officekeypad }` |
| `data/household/screens/tv.yml` | `input` → `{ type: remote, keyboard_id: tvremote }` |
