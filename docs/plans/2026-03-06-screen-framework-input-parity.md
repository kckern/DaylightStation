# Screen Framework Input Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the screen-framework's input handling to full parity with the legacy OfficeApp, using YAML-driven configuration so behavior is abstract and portable across screens.

**Architecture:** Extend the screen YAML schema with new top-level blocks (`actions`, `websocket`) that declare how the framework responds to input events and WS commands. The `ScreenActionHandler` becomes a config-driven dispatcher that reads these declarations. No office-specific logic lives in code — all customization is in YAML.

**Tech Stack:** React (hooks), Vitest, YAML screen configs, WebSocket (existing `useWebSocketSubscription` hook), ActionBus (existing)

**Audit Reference:** `docs/_wip/audits/2026-03-06-screen-framework-input-parity-audit.md`

---

## YAML Schema Additions

The plan adds two new top-level config blocks. Here's the target shape for the office screen:

```yaml
# New: action behavior overrides
actions:
  escape:
    # Ordered fallback chain — first matching condition fires
    - when: shader_active
      do: clear_shader
    - when: overlay_active
      do: dismiss_overlay
    - when: idle              # nothing open
      do: reload

  sleep:
    wake: keydown             # "keydown" | "click" | "both"

  playback:
    when_idle: secondary      # "secondary" | "ignore" | "dispatch"

  menu:
    duplicate: ignore         # "ignore" | "reopen"

# New: WebSocket command handler
websocket:
  commands: true              # enable the general-purpose WS command handler
  guardrails:
    blocked_topics: [vibration, fitness, sensor, telemetry, logging]
    blocked_sources: [mqtt, fitness, fitness-simulator, playback-logger]

# Existing (updated):
subscriptions:
  midi:
    on:
      event: session_start
    also_on:                  # NEW: additional trigger events
      event: note_on
      condition: no_overlay   # only if no fullscreen overlay is showing
    guard: no_overlay         # NEW: skip trigger if fullscreen overlay is active
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```

---

## Task 1: Escape Fallback Chain

The `handleEscape` in `ScreenActionHandler` currently does shader > dismiss. The legacy handler has a three-tier chain ending in `window.location.reload()`. Make the escape behavior YAML-configurable.

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (pass `actions` config)

### Step 1: Write failing tests

Add to `ScreenActionHandler.test.jsx`:

```jsx
describe('escape fallback chain', () => {
  it('reloads page on escape when no shader or overlay (actions.escape configured)', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });

    render(
      <ScreenOverlayProvider>
        <ScreenActionHandler actions={{ escape: [
          { when: 'shader_active', do: 'clear_shader' },
          { when: 'overlay_active', do: 'dismiss_overlay' },
          { when: 'idle', do: 'reload' },
        ]}} />
      </ScreenOverlayProvider>
    );

    act(() => getActionBus().emit('escape', {}));

    expect(reloadSpy).toHaveBeenCalled();
  });

  it('dismisses overlay before reloading when overlay is active', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });

    const { queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler actions={{ escape: [
          { when: 'shader_active', do: 'clear_shader' },
          { when: 'overlay_active', do: 'dismiss_overlay' },
          { when: 'idle', do: 'reload' },
        ]}} />
      </ScreenOverlayProvider>
    );

    // Open overlay first
    act(() => getActionBus().emit('menu:open', { menuId: 'music' }));

    // Escape should dismiss, not reload
    act(() => getActionBus().emit('escape', {}));
    expect(queryByTestId('menu-stack')).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd frontend && npx vitest run src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: FAIL — `ScreenActionHandler` doesn't accept `actions` prop

### Step 3: Implement

In `ScreenActionHandler.jsx`, accept an `actions` prop and rewrite `handleEscape`:

```jsx
export function ScreenActionHandler({ actions = {} }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const shaderRef = useRef(null);
  const prevShaderOpacity = useRef(null);

  // ... existing getShader, handler callbacks ...

  const handleEscape = useCallback(() => {
    const escapeFallbacks = actions?.escape;

    // If no config, use default behavior (shader > dismiss)
    if (!escapeFallbacks || !Array.isArray(escapeFallbacks)) {
      const el = shaderRef.current;
      if (el && parseFloat(el.style.opacity) > 0) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        prevShaderOpacity.current = null;
        return;
      }
      dismissOverlay();
      return;
    }

    // Walk the fallback chain
    for (const step of escapeFallbacks) {
      const conditionMet = {
        shader_active: () => {
          const el = shaderRef.current;
          return el && parseFloat(el.style.opacity) > 0;
        },
        overlay_active: () => hasOverlay,
        idle: () => true, // always matches as final fallback
      }[step.when]?.();

      if (!conditionMet) continue;

      const actions_do = {
        clear_shader: () => {
          const el = shaderRef.current;
          if (el) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            prevShaderOpacity.current = null;
          }
        },
        dismiss_overlay: () => dismissOverlay(),
        reload: () => window.location.reload(),
      };

      actions_do[step.do]?.();
      return;
    }
  }, [actions, dismissOverlay, hasOverlay]);

  // ... rest unchanged ...
}
```

In `ScreenRenderer.jsx`, pass the `actions` config:

```jsx
<ScreenActionHandler actions={config.actions} />
```

### Step 4: Run tests to verify they pass

Run: `cd frontend && npx vitest run src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: PASS

### Step 5: Update office.yml

Add to the screen config (on the data mount, not the repo copy):

```yaml
actions:
  escape:
    - when: shader_active
      do: clear_shader
    - when: overlay_active
      do: dismiss_overlay
    - when: idle
      do: reload
```

### Step 6: Commit

```
feat(screen-framework): add YAML-configurable escape fallback chain
```

---

## Task 2: Sleep Wake Mode

The sleep handler currently only wakes on click (useless on numpad-only screens). Make the wake trigger YAML-configurable.

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

### Step 1: Write failing test

```jsx
it('wakes from sleep on keydown when actions.sleep.wake is "keydown"', () => {
  const { container } = render(
    <ScreenOverlayProvider>
      <ScreenActionHandler actions={{ sleep: { wake: 'keydown' } }} />
    </ScreenOverlayProvider>
  );

  // Enter sleep
  act(() => getActionBus().emit('display:sleep', {}));

  const shader = document.querySelector('.screen-action-shader');
  expect(shader).toBeTruthy();
  expect(shader.style.opacity).toBe('1');

  // Simulate keydown to wake
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
  });

  expect(shader.style.opacity).not.toBe('1');
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && npx vitest run src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: FAIL — sleep still only wakes on click

### Step 3: Implement

In `handleSleep`, read `actions?.sleep?.wake` and install the appropriate listener:

```jsx
const handleSleep = useCallback(() => {
  const el = getShader();
  const current = parseFloat(el.style.opacity) || 0;
  if (current >= 0.99) {
    el.style.opacity = String(prevShaderOpacity.current ?? 0);
    el.style.pointerEvents = 'none';
    prevShaderOpacity.current = null;
  } else {
    prevShaderOpacity.current = current;
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';

    const wakeMode = actions?.sleep?.wake || 'click';

    const wake = (e) => {
      if (e) { e.stopPropagation(); e.preventDefault(); }
      el.style.opacity = String(prevShaderOpacity.current ?? 0);
      el.style.pointerEvents = 'none';
      prevShaderOpacity.current = null;
      el.removeEventListener('click', wake);
      window.removeEventListener('keydown', wake, true);
    };

    if (wakeMode === 'click' || wakeMode === 'both') {
      el.addEventListener('click', wake);
    }
    if (wakeMode === 'keydown' || wakeMode === 'both') {
      window.addEventListener('keydown', wake, true);
    }
  }
}, [getShader, actions]);
```

### Step 4: Run tests

Run: `cd frontend && npx vitest run src/screen-framework/actions/ScreenActionHandler.test.jsx`
Expected: PASS

### Step 5: Update office.yml

```yaml
actions:
  sleep:
    wake: keydown
```

### Step 6: Commit

```
feat(screen-framework): YAML-configurable sleep wake mode (keydown/click/both)
```

---

## Task 3: Secondary Action Fallback for Playback

When no media is playing and a playback key is pressed, the legacy handler falls back to the key's `secondary` field (e.g., `queue: Morning Program`). The screen-framework blindly dispatches a synthetic keydown. Make this YAML-configurable.

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Modify: `frontend/src/screen-framework/input/adapters/NumpadAdapter.js`
- Modify: `frontend/src/screen-framework/input/actionMap.js`
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

### Step 1: Write failing test

```jsx
it('emits secondary action when playback has no active media and config is "secondary"', () => {
  const { getByTestId, queryByTestId } = render(
    <ScreenOverlayProvider>
      <ScreenActionHandler actions={{ playback: { when_idle: 'secondary' } }} />
    </ScreenOverlayProvider>
  );

  // No media element exists — playback is idle
  // Emit playback with a secondary payload
  act(() => getActionBus().emit('media:playback', {
    command: 'play',
    secondary: { action: 'media:queue', payload: { contentId: 'morning-program' } },
  }));

  // Should have opened the player with the secondary content
  expect(getByTestId('player')).toBeTruthy();
});
```

### Step 2: Run test to verify it fails

Expected: FAIL — current handler ignores secondary, dispatches orphan keydown

### Step 3: Implement

**actionMap.js** — include `secondary` in the playback payload:

```js
playback: (params) => ({ action: 'media:playback', payload: { command: params } }),
```
No change needed here — the secondary data comes from the NumpadAdapter.

**NumpadAdapter.js** — pass secondary info through the action bus payload:

```js
this.handler = (event) => {
  if (!this.keymap) return;
  const entry = this.keymap[event.key]
    || this.keymap[event.code?.replace(/^(Digit|Numpad)/, '')]
    || null;
  if (!entry) return;

  const result = translateAction(entry.function, entry.params);
  if (result) {
    // Attach parsed secondary to playback actions
    if (entry.secondary && result.action === 'media:playback') {
      const sec = translateSecondary(entry.secondary);
      if (sec) result.payload.secondary = sec;
    }
    logger().debug('numpad.key', { key: event.key, action: result.action });
    this.actionBus.emit(result.action, result.payload);
    return;
  }

  // Existing secondary fallback for unknown primary functions
  if (entry.secondary) {
    const fallback = translateSecondary(entry.secondary);
    if (fallback) {
      this.actionBus.emit(fallback.action, fallback.payload);
    }
  }
};
```

**ScreenActionHandler.jsx** — update `handleMediaPlayback`:

```jsx
const handleMediaPlayback = useCallback((payload) => {
  const idleMode = actions?.playback?.when_idle || 'dispatch';

  // Check if any media is actually active
  const media = document.querySelector('audio, video, dash-video');
  const isPlaying = media && !media.paused;

  if (!isPlaying && idleMode === 'secondary' && payload.secondary) {
    // Execute the secondary action (e.g., open a queue)
    const { action, payload: secPayload } = payload.secondary;
    if (action === 'media:queue') {
      showOverlay(Player, { queue: [secPayload.contentId], clear: () => dismissOverlay() });
    } else if (action === 'media:play') {
      showOverlay(Player, { play: secPayload.contentId, clear: () => dismissOverlay() });
    } else if (action === 'menu:open') {
      showOverlay(MenuStack, { rootMenu: secPayload.menuId });
    }
    return;
  }

  // Default: dispatch synthetic keydown
  const keyMapping = {
    play: 'Enter', pause: 'Enter', toggle: 'Enter',
    next: 'Tab', skip: 'Tab',
    prev: 'Backspace', previous: 'Backspace', back: 'Backspace',
    fwd: 'ArrowRight', forward: 'ArrowRight', ff: 'ArrowRight',
    rew: 'ArrowLeft', rewind: 'ArrowLeft', rw: 'ArrowLeft',
    stop: 'Escape', clear: 'Escape',
  };
  const key = keyMapping[payload.command?.toLowerCase()];
  if (key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
  }
}, [actions, showOverlay, dismissOverlay]);
```

### Step 4: Run tests

Run: `cd frontend && npx vitest run src/screen-framework/actions/ src/screen-framework/input/`
Expected: PASS (all existing + new tests)

### Step 5: Update office.yml

```yaml
actions:
  playback:
    when_idle: secondary
```

### Step 6: Commit

```
feat(screen-framework): secondary action fallback for idle playback keys
```

---

## Task 4: Menu Duplicate Guard

Legacy guards against re-opening the same menu. Make this YAML-configurable.

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`

### Step 1: Write failing test

```jsx
it('ignores duplicate menu:open when actions.menu.duplicate is "ignore"', () => {
  render(
    <ScreenOverlayProvider>
      <ScreenActionHandler actions={{ menu: { duplicate: 'ignore' } }} />
    </ScreenOverlayProvider>
  );

  act(() => getActionBus().emit('menu:open', { menuId: 'music' }));
  act(() => getActionBus().emit('menu:open', { menuId: 'music' }));

  // showOverlay should only have been called once effectively
  // (overlay is already showing MenuStack with rootMenu=music)
  // The second call should be a no-op
});
```

### Step 2: Implement

Track the current overlay menu ID in a ref. Skip `showOverlay` if same menu is already open.

```jsx
const currentMenuRef = useRef(null);

const handleMenuOpen = useCallback((payload) => {
  if (actions?.menu?.duplicate === 'ignore' && currentMenuRef.current === payload.menuId) {
    return;
  }
  currentMenuRef.current = payload.menuId;
  showOverlay(MenuStack, { rootMenu: payload.menuId });
}, [showOverlay, actions]);

// Clear ref on escape/dismiss
const handleEscape = useCallback(() => {
  // ... existing logic ...
  currentMenuRef.current = null;
  // ... rest ...
}, [/* ... */]);
```

### Step 3: Run tests, update YAML, commit

```yaml
actions:
  menu:
    duplicate: ignore
```

```
feat(screen-framework): YAML-configurable menu duplicate guard
```

---

## Task 5: WebSocket Command Handler

The legacy `websocketHandler.js` handles remote commands (menu, reset, playback, content loading) sent over WebSocket. The screen-framework has no equivalent. Add a `useScreenCommands` hook driven by the `websocket:` YAML config block.

**Files:**
- Create: `frontend/src/screen-framework/commands/useScreenCommands.js`
- Create: `frontend/src/screen-framework/commands/useScreenCommands.test.jsx`
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (mount the handler)

### Step 1: Write failing test

```jsx
// useScreenCommands.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';

let capturedFilter = null;
let capturedCallback = null;

vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, callback) => {
    capturedFilter = filter;
    capturedCallback = callback;
  },
}));

describe('useScreenCommands', () => {
  let actionBus;

  beforeEach(() => {
    capturedFilter = null;
    capturedCallback = null;
    actionBus = { emit: vi.fn() };
  });

  it('emits menu:open on WS menu command', () => {
    renderHook(() => useScreenCommands(
      { commands: true, guardrails: { blocked_topics: ['fitness'] } },
      actionBus
    ));

    act(() => capturedCallback({ menu: 'scripture' }));

    expect(actionBus.emit).toHaveBeenCalledWith('menu:open', { menuId: 'scripture' });
  });

  it('emits escape on WS reset command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));

    act(() => capturedCallback({ action: 'reset' }));

    expect(actionBus.emit).toHaveBeenCalledWith('escape', {});
  });

  it('emits media:playback on WS playback command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));

    act(() => capturedCallback({ playback: 'next' }));

    expect(actionBus.emit).toHaveBeenCalledWith('media:playback', { command: 'next' });
  });

  it('emits media:play on WS content command', () => {
    renderHook(() => useScreenCommands({ commands: true }, actionBus));

    act(() => capturedCallback({ play: 'plex:12345' }));

    expect(actionBus.emit).toHaveBeenCalledWith('media:play', { contentId: 'plex:12345' });
  });

  it('blocks messages from guardrail topics', () => {
    renderHook(() => useScreenCommands(
      { commands: true, guardrails: { blocked_topics: ['fitness'] } },
      actionBus
    ));

    act(() => capturedCallback({ topic: 'fitness', data: {} }));

    expect(actionBus.emit).not.toHaveBeenCalled();
  });

  it('does nothing when commands is false', () => {
    renderHook(() => useScreenCommands({ commands: false }, actionBus));

    expect(capturedFilter).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && npx vitest run src/screen-framework/commands/useScreenCommands.test.jsx`
Expected: FAIL — module doesn't exist

### Step 3: Implement

```js
// frontend/src/screen-framework/commands/useScreenCommands.js
import { useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenCommands' });
  return _logger;
}

const CONTENT_KEYS = ['contentId', 'play', 'queue', 'plex', 'media', 'playlist', 'files'];
const LEGACY_COLLECTION_KEYS = ['hymn', 'scripture', 'talk', 'primary', 'poem'];

export function useScreenCommands(wsConfig, actionBus) {
  const enabled = wsConfig?.commands === true;
  const guardrails = wsConfig?.guardrails || {};
  const guardrailsRef = useRef(guardrails);
  guardrailsRef.current = guardrails;
  const busRef = useRef(actionBus);
  busRef.current = actionBus;

  const handleMessage = useCallback((data) => {
    const g = guardrailsRef.current;
    const bus = busRef.current;
    if (!bus) return;

    // Guardrails
    if (data.topic && g.blocked_topics?.includes(data.topic)) return;
    if (data.source && g.blocked_sources?.includes(data.source)) return;
    if (data.equipmentId || data.deviceId || data.data?.vibration !== undefined) return;

    // Menu
    if (data.menu) {
      bus.emit('menu:open', { menuId: data.menu });
      return;
    }

    // Reset
    if (data.action === 'reset') {
      bus.emit('escape', {});
      return;
    }

    // Playback control
    if (data.playback) {
      bus.emit('media:playback', { command: data.playback });
      return;
    }

    // Content reference extraction
    let contentRef = null;
    for (const key of LEGACY_COLLECTION_KEYS) {
      if (data[key] != null) { contentRef = `${key}:${data[key]}`; break; }
    }
    if (!contentRef) {
      for (const key of CONTENT_KEYS) {
        const val = data[key];
        if (val != null && typeof val !== 'object') { contentRef = String(val); break; }
      }
    }

    if (contentRef) {
      const action = data.action || (Object.keys(data).includes('queue') ? 'media:queue' : 'media:play');
      bus.emit(action, { contentId: contentRef });
      return;
    }

    logger().debug('screen-commands.unhandled', { keys: Object.keys(data) });
  }, []);

  // Only subscribe if commands are enabled
  const filter = enabled
    ? (msg) => !!(msg.menu || msg.action || msg.playback || msg.play || msg.queue || msg.plex || msg.contentId || msg.hymn || msg.scripture || msg.talk || msg.primary || msg.media)
    : null;

  useWebSocketSubscription(filter, handleMessage, [handleMessage]);
}
```

### Step 4: Wire into ScreenRenderer

In `ScreenRenderer.jsx`, add a renderless component:

```jsx
import { useScreenCommands } from './commands/useScreenCommands.js';
import { getActionBus } from './input/ActionBus.js';

function ScreenCommandHandler({ wsConfig }) {
  const bus = useMemo(() => getActionBus(), []);
  useScreenCommands(wsConfig, bus);
  return null;
}

// In the render tree, after ScreenActionHandler:
<ScreenActionHandler actions={config.actions} />
<ScreenCommandHandler wsConfig={config.websocket} />
```

### Step 5: Run tests

Run: `cd frontend && npx vitest run src/screen-framework/commands/`
Expected: PASS

### Step 6: Update office.yml

```yaml
websocket:
  commands: true
  guardrails:
    blocked_topics: [vibration, fitness, sensor, telemetry, logging]
    blocked_sources: [mqtt, fitness, fitness-simulator, playback-logger]
```

### Step 7: Commit

```
feat(screen-framework): YAML-driven WebSocket command handler
```

---

## Task 6: Subscription Guard and First-Note Fallback

The MIDI subscription shows piano even when media is playing (no guard), and misses piano on first note (only `session_start` triggers). Extend the subscription YAML schema with `guard` and `also_on`.

**Files:**
- Modify: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js`
- Modify: `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.test.jsx`

### Step 1: Write failing tests

```jsx
it('skips overlay trigger when guard is "no_overlay" and overlay is active', () => {
  const config = {
    midi: {
      on: { event: 'session_start' },
      guard: 'no_overlay',
      response: { overlay: 'piano', mode: 'fullscreen' },
    },
  };

  // Simulate an already-active overlay
  showOverlay.hasOverlay = true;

  renderSubscriptions(config, { hasOverlay: true });

  act(() => capturedCallback({ topic: 'midi', event: 'session_start' }));

  expect(showOverlay).not.toHaveBeenCalled();
});

it('triggers on also_on event when primary on.event does not match', () => {
  const config = {
    midi: {
      on: { event: 'session_start' },
      also_on: { event: 'note_on', condition: 'no_overlay' },
      response: { overlay: 'piano', mode: 'fullscreen' },
    },
  };

  renderSubscriptions(config, { hasOverlay: false });

  act(() => capturedCallback({ topic: 'midi', event: 'note_on' }));

  expect(showOverlay).toHaveBeenCalledTimes(1);
});
```

### Step 2: Implement

In `useScreenSubscriptions.js`, extend the entry parsing:

```js
const entries = useMemo(() => {
  // ... existing ...
  return Object.entries(subscriptions).map(([topic, cfg]) => ({
    // ... existing fields ...
    guard: cfg?.guard ?? null,
    alsoOnEvent: cfg?.also_on?.event ?? null,
    alsoOnCondition: cfg?.also_on?.condition ?? null,
  }));
}, [subscriptions]);
```

Accept `hasOverlay` as a parameter (passed from `ScreenSubscriptionHandler`):

```js
export function useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry, { hasOverlay = false } = {}) {
```

In the message handler, check guard before triggering:

```js
// Guard check
if (entry.guard === 'no_overlay' && hasOverlayRef.current) {
  logger().debug('subscription.guard-blocked', { topic: entry.topic, guard: entry.guard });
  continue;
}

// Check also_on as secondary trigger
if (entry.onEvent && eventName !== entry.onEvent) {
  if (entry.alsoOnEvent && eventName === entry.alsoOnEvent) {
    if (entry.alsoOnCondition === 'no_overlay' && hasOverlayRef.current) {
      continue;
    }
    // Fall through to show overlay
  } else {
    continue;
  }
}
```

Update `ScreenSubscriptionHandler` in `ScreenRenderer.jsx` to pass `hasOverlay`:

```jsx
function ScreenSubscriptionHandler({ subscriptions }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const registry = useMemo(() => getWidgetRegistry(), []);
  useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, registry, { hasOverlay });
  return null;
}
```

### Step 3: Run tests

Run: `cd frontend && npx vitest run src/screen-framework/subscriptions/`
Expected: PASS

### Step 4: Update office.yml

```yaml
subscriptions:
  midi:
    on:
      event: session_start
    also_on:
      event: note_on
      condition: no_overlay
    guard: no_overlay
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```

### Step 5: Commit

```
feat(screen-framework): subscription guard and also_on trigger support
```

---

## Task 7: Final Office YAML Assembly and Smoke Test

Assemble the complete updated `office.yml` with all new config blocks and verify end-to-end on the live screen.

**Files:**
- Modify: `data/household/screens/office.yml` (on the data mount)

### Step 1: Write the final YAML

Combine all additions into the office screen config:

```yaml
# Office Dashboard Screen
screen: office
route: /screen/office
resolution:
  width: 1280
  height: 720
input:
  type: numpad
  keyboard_id: officekeypad

theme:
  screen-bg: "#1a1a2e"
  panel-bg: rgba(255, 255, 255, 0.06)
  panel-radius: 12px
  panel-shadow: 0 4px 16px rgba(0, 0, 0, 0.3)
  panel-border: 1px solid rgba(255, 255, 255, 0.12)
  panel-blur: blur(12px)
  panel-padding: 1rem
  font-family: Roboto Condensed, sans-serif
  font-color: "#e0e0e0"
  accent-color: "#4fc3f7"

actions:
  escape:
    - when: shader_active
      do: clear_shader
    - when: overlay_active
      do: dismiss_overlay
    - when: idle
      do: reload
  sleep:
    wake: keydown
  playback:
    when_idle: secondary
  menu:
    duplicate: ignore

websocket:
  commands: true
  guardrails:
    blocked_topics: [vibration, fitness, sensor, telemetry, logging]
    blocked_sources: [mqtt, fitness, fitness-simulator, playback-logger]

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
          shrink: 0
        - widget: weather
          grow: 0
          shrink: 0
        - widget: weather-forecast
          grow: 0
          shrink: 1
        - widget: entropy
          basis: 40%
          grow: 0
          shrink: 0
    - direction: column
      grow: 1
      gap: 0.5rem
      children:
        - widget: calendar
          grow: 1
        - direction: row
          grow: 0
          shrink: 0
          gap: 0.5rem
          children:
            - widget: finance
              basis: 50%
              grow: 1
              shrink: 1
            - widget: health
              basis: 50%
              grow: 1
              shrink: 1

subscriptions:
  midi:
    on:
      event: session_start
    also_on:
      event: note_on
      condition: no_overlay
    guard: no_overlay
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```

### Step 2: Smoke test checklist

Run these against the live office screen via CDP (port 9222):

1. Press Digit4 at home state → page reloads
2. Open a menu (press a menu key), then Digit4 → menu closes
3. Press sleep key → screen goes black, then press any key → screen wakes
4. Press key 1 (play, secondary: Morning Program) with no media → Morning Program plays
5. Send WS command `{ "menu": "music" }` → music menu opens
6. Send WS command `{ "playback": "next" }` while media playing → next track
7. Start MIDI session → piano overlay appears
8. Start MIDI session while media playing → piano does NOT appear

### Step 3: Commit

```
feat(screen): add full input parity config to office.yml
```

---

## Summary

| Task | What | Priority |
|------|------|----------|
| 1 | Escape fallback chain (reload at home) | Critical |
| 2 | Sleep wake mode (keydown) | Critical |
| 3 | Secondary action fallback (playback idle) | High |
| 4 | Menu duplicate guard | Medium |
| 5 | WebSocket command handler | High |
| 6 | Subscription guard + also_on | Medium |
| 7 | Final YAML + smoke test | Final |

All behavioral customization lives in screen YAML config. The framework code is generic — any screen can opt into these behaviors by adding the appropriate config blocks.
