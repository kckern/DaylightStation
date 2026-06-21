# office_tv_active Presence Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the Home Assistant `input_boolean.office_tv_active` so it is TRUE only while the office screen is showing actual content (player/app/overlay — any non-browse surface) and FALSE on the bare dashboard or in menus, with layered protection against stale/lost states.

**Architecture:** A screen-side presence publisher computes `isContentActive` (the same nav-stack-non-browse OR fullscreen-overlay signal used by the screensaver) and emits `screen.presence {deviceId, active, ts}` over the existing WS on transitions + a 5s heartbeat while active. A backend `ScreenPresenceService` consumes those messages and is the single owner of the HA boolean — it asserts on/off idempotently and defends against staleness with: clean-transition off, a heartbeat TTL watchdog, startup assert-off, periodic reconcile, and immediate off on WS client disconnect.

**Tech Stack:** React (screen-framework), WebSocket (`wsService` ↔ `WebSocketEventBus`), Home Assistant REST via `haGateway.callService`, Node ES modules, Vitest.

---

## Approved design recap (from brainstorming)

- **TRUE condition (B):** any content surface — player `playing` **or** `paused`, an `app`, ArtMode, or any fullscreen overlay. FALSE on the dashboard or while navigating menus. This equals `isContentActive(currentContent, hasOverlay)`: `hasOverlay || (currentContent && !BROWSE_NAV_TYPES.has(currentContent.type))`, where browse types are `menu / plex-menu / show-view / season-view`.
- **Latency (A):** ~5s heartbeat, ~15s TTL.
- **Config home:** `devices.yml` under the `office-tv` device: `presence: { entity: input_boolean.office_tv_active, ttlMs: 15000 }`.
- **Five stale-protection layers:** (1) clean transition → immediate off; (2) heartbeat TTL watchdog (~5s tick, 15s TTL); (3) startup assert OFF; (4) periodic reconcile (~60s) re-asserts desired; (5) WS client-disconnect → immediate off.

## Confirmed integration seams

- Screen WS send: `wsService.send(obj)` (`frontend/src/services/WebSocketService.js`), already used by `useSessionStatePublisher`.
- Screen deviceId: `wsConfig.guardrails.device` (`office.yml` → `office-tv`).
- Backend inbound: `eventBus.onClientMessage((clientId, message) => …)` receives every non-`bus_command`/`identify` client message; `eventBus.onClientDisconnection((clientId) => …)` fires on disconnect (passes `clientId`, NOT deviceId → the service maps clientId→deviceId from presence messages).
- HA write: `haGateway.callService('input_boolean', 'turn_on'|'turn_off', { entity_id })` (`HomeAssistantAdapter`, REST `POST /api/services/...`).
- Backend wiring: `app.mjs` has `eventBus`, `homeAutomationAdapters.haGateway`, and `devicesConfig = configService.getHouseholdDevices(householdId)` (`.devices` is the per-device map) all in scope at the device-services block (~`app.mjs:1857`).
- Reuse: `isContentActive` / `BROWSE_NAV_TYPES` currently live inline in `ScreenScreensaver.jsx` (from the screensaver fix) — extract to a shared module (Task 1).

## File structure

- **Create** `frontend/src/screen-framework/screenActivity.js` — `BROWSE_NAV_TYPES` + `isContentActive(currentContent, hasOverlay)`. Single source of "is content active".
- **Modify** `frontend/src/screen-framework/ScreenScreensaver.jsx` — import `BROWSE_NAV_TYPES` from the shared module (DRY).
- **Create** `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js` — emits `screen.presence` on transition + 5s heartbeat while active.
- **Create** `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx` — renderless component: reads contexts, computes `active`, drives the hook.
- **Modify** `frontend/src/screen-framework/ScreenRenderer.jsx` — mount `<ScreenPresencePublisher>`.
- **Create** `backend/src/3_applications/devices/services/ScreenPresenceService.mjs` — the HA-driving service + all stale-protection.
- **Create** `backend/src/0_system/bootstrap/screenPresence.mjs` — factory (mirrors `bootstrap/deviceLiveness.mjs`).
- **Modify** `backend/src/app.mjs` — wire the factory.
- **Modify** `data/household/config/devices.yml` — add the `presence` block to `office-tv`.

## Test runner

- Frontend + backend unit specs run via: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`. (Do NOT use `npm run test:isolated` — its harness routes to jest.)

---

### Task 1: Shared `screenActivity` helper (DRY with the screensaver)

**Files:**
- Create: `frontend/src/screen-framework/screenActivity.js`
- Test: `frontend/src/screen-framework/screenActivity.test.js`
- Modify: `frontend/src/screen-framework/ScreenScreensaver.jsx`

- [ ] **Step 1: Write the failing test** — Create `frontend/src/screen-framework/screenActivity.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { isContentActive, BROWSE_NAV_TYPES } from './screenActivity.js';

describe('isContentActive', () => {
  it('is false on the bare dashboard (no nav content, no overlay)', () => {
    expect(isContentActive(null, false)).toBe(false);
  });
  it('is false for browse surfaces (menu / views)', () => {
    for (const type of ['menu', 'plex-menu', 'show-view', 'season-view']) {
      expect(isContentActive({ type }, false), type).toBe(false);
    }
  });
  it('is true for content surfaces (player / app / etc.)', () => {
    for (const type of ['player', 'app', 'display', 'launch', 'android-launch']) {
      expect(isContentActive({ type }, false), type).toBe(true);
    }
  });
  it('is true whenever a fullscreen overlay is up, regardless of nav content', () => {
    expect(isContentActive(null, true)).toBe(true);
    expect(isContentActive({ type: 'menu' }, true)).toBe(true);
  });
  it('exports the browse type set', () => {
    expect(BROWSE_NAV_TYPES.has('menu')).toBe(true);
    expect(BROWSE_NAV_TYPES.has('player')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/screenActivity.test.js`
Expected: FAIL — module `./screenActivity.js` does not exist.

- [ ] **Step 3: Create the helper** — Create `frontend/src/screen-framework/screenActivity.js`:

```javascript
// Single source of truth for "is the screen showing active content?"
// Used by ScreenScreensaver (suppress while content is up) and the presence
// publisher (drive input_boolean.office_tv_active).
//
// Browse surfaces — an idle one of these is when the screensaver SHOULD fire and
// when the TV is NOT "active". Anything else on the nav stack (player, app,
// display, launch, android-launch, future content types) is active content.
// Default-active for unknown types is the safe bias.
export const BROWSE_NAV_TYPES = new Set(['menu', 'plex-menu', 'show-view', 'season-view']);

/**
 * @param {{type?: string}|null} currentContent - top of the MenuNavigation stack
 * @param {boolean} hasOverlay - a fullscreen overlay is mounted
 * @returns {boolean}
 */
export function isContentActive(currentContent, hasOverlay) {
  if (hasOverlay) return true;
  return !!currentContent && !BROWSE_NAV_TYPES.has(currentContent.type);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/screenActivity.test.js`
Expected: PASS (5 passing).

- [ ] **Step 5: Refactor ScreenScreensaver to use the shared set.** In `frontend/src/screen-framework/ScreenScreensaver.jsx`, find:

```javascript
// Nav-stack surfaces that are "browsing" — an idle one of these is exactly when
// the screensaver SHOULD fire. Anything else on the stack (player, app, display,
// launch, android-launch, future content types) is active content that must
// suppress the screensaver. Default-suppress is the safe bias: a new content
// type should never silently get bumped off by the screensaver.
const BROWSE_NAV_TYPES = new Set(['menu', 'plex-menu', 'show-view', 'season-view']);
```

Replace with:

```javascript
import { BROWSE_NAV_TYPES } from './screenActivity.js';
```

Move that `import` up with the other imports at the top of the file (delete the inline `const BROWSE_NAV_TYPES` line entirely). The existing `contentActive = !!currentContent && !BROWSE_NAV_TYPES.has(currentContent.type)` line stays unchanged.

- [ ] **Step 6: Run the screensaver tests to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/ScreenScreensaver.test.jsx`
Expected: PASS (9 passing — unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/screenActivity.js frontend/src/screen-framework/screenActivity.test.js frontend/src/screen-framework/ScreenScreensaver.jsx
git commit -m "refactor(screen): extract isContentActive/BROWSE_NAV_TYPES to shared module

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `useScreenPresencePublisher` hook

Emits `screen.presence` on every active↔inactive transition and every 5s while active. Silent while inactive (TTL is the backstop).

**Files:**
- Create: `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js`
- Test: `frontend/src/screen-framework/publishers/useScreenPresencePublisher.test.js`

- [ ] **Step 1: Write the failing test** — Create `frontend/src/screen-framework/publishers/useScreenPresencePublisher.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));
const { wsService } = await import('../../services/WebSocketService.js');
const { useScreenPresencePublisher } = await import('./useScreenPresencePublisher.js');

beforeEach(() => {
  vi.useFakeTimers();
  wsService.send.mockClear();
});

const lastMsg = () => wsService.send.mock.calls.at(-1)?.[0];

describe('useScreenPresencePublisher', () => {
  it('does nothing without a deviceId', () => {
    renderHook(({ active }) => useScreenPresencePublisher({ deviceId: null, active }), {
      initialProps: { active: true },
    });
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('emits active=true on mount-active and heartbeats every 5s while active', () => {
    renderHook(() => useScreenPresencePublisher({ deviceId: 'office-tv', active: true }));
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(lastMsg()).toMatchObject({ type: 'screen.presence', deviceId: 'office-tv', active: true });
    vi.advanceTimersByTime(5000);
    expect(wsService.send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(wsService.send).toHaveBeenCalledTimes(3);
  });

  it('emits a single active=false on transition to inactive, then goes silent', () => {
    const { rerender } = renderHook(
      ({ active }) => useScreenPresencePublisher({ deviceId: 'office-tv', active }),
      { initialProps: { active: true } }
    );
    wsService.send.mockClear();
    rerender({ active: false });
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(lastMsg()).toMatchObject({ active: false });
    vi.advanceTimersByTime(15000); // no heartbeat while inactive
    expect(wsService.send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/publishers/useScreenPresencePublisher.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook** — Create `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js`:

```javascript
import { useEffect } from 'react';
import { wsService } from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'screen-presence-publisher' });
  return _logger;
}

const HEARTBEAT_MS = 5000;

/**
 * Publishes screen content-presence to the backend over WS.
 *   - On every active↔inactive transition (and on mount): one message.
 *   - While active: a heartbeat every 5s (so the backend TTL never expires a
 *     genuinely-active screen).
 *   - While inactive: silent — silence + backend TTL keep the boolean false.
 *
 * @param {Object} opts
 * @param {string} opts.deviceId - from wsConfig.guardrails.device; no-op when falsy
 * @param {boolean} opts.active  - isContentActive(currentContent, hasOverlay)
 */
export function useScreenPresencePublisher({ deviceId, active }) {
  useEffect(() => {
    if (!deviceId) return undefined;

    const send = () => {
      try {
        wsService.send({
          type: 'screen.presence',
          deviceId,
          active: !!active,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        logger().warn('publish-failed', { deviceId, active, error: String(err?.message ?? err) });
      }
    };

    // Transition/mount emit.
    send();

    if (!active) return undefined; // inactive: no heartbeat
    const timer = setInterval(send, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [deviceId, active]);
}

export default useScreenPresencePublisher;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/publishers/useScreenPresencePublisher.test.js`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/publishers/useScreenPresencePublisher.js frontend/src/screen-framework/publishers/useScreenPresencePublisher.test.js
git commit -m "feat(screen): useScreenPresencePublisher — emit content-presence over WS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ScreenPresencePublisher` component + mount in ScreenRenderer

**Files:**
- Create: `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx`
- Test: `frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx`
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

- [ ] **Step 1: Write the failing test** — Create `frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MenuNavigationProvider, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { ScreenOverlayProvider } from '../overlays/ScreenOverlayProvider.jsx';

vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));
const { wsService } = await import('../../services/WebSocketService.js');
const { ScreenPresencePublisher } = await import('./ScreenPresencePublisher.jsx');

let navApi = null;
function NavCapture() { navApi = useMenuNavigationContext(); return null; }

const setup = (deviceId) =>
  render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        <NavCapture />
        <ScreenPresencePublisher deviceId={deviceId} />
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  );

beforeEach(() => { wsService.send.mockClear(); navApi = null; });
const lastMsg = () => wsService.send.mock.calls.at(-1)?.[0];

describe('ScreenPresencePublisher', () => {
  it('reports active=false on the bare dashboard', () => {
    setup('office-tv');
    expect(lastMsg()).toMatchObject({ deviceId: 'office-tv', active: false });
  });

  it('reports active=true when a player is pushed onto the nav stack', () => {
    setup('office-tv');
    act(() => { navApi.push({ type: 'player', props: {} }); });
    expect(lastMsg()).toMatchObject({ active: true });
  });

  it('renders nothing and never sends without a deviceId', () => {
    setup(null);
    expect(wsService.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component** — Create `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx`:

```javascript
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { isContentActive } from '../screenActivity.js';
import { useScreenPresencePublisher } from './useScreenPresencePublisher.js';

/**
 * Renderless: computes content-presence from the nav stack + overlay state and
 * publishes it for the backend ScreenPresenceService (drives office_tv_active).
 * Must be mounted inside MenuNavigationProvider + ScreenOverlayProvider.
 */
export function ScreenPresencePublisher({ deviceId }) {
  const { currentContent } = useMenuNavigationContext();
  const { hasOverlay } = useScreenOverlay();
  const active = isContentActive(currentContent, hasOverlay);
  useScreenPresencePublisher({ deviceId, active });
  return null;
}

export default ScreenPresencePublisher;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx`
Expected: PASS (3 passing).

- [ ] **Step 5: Mount it in ScreenRenderer.** In `frontend/src/screen-framework/ScreenRenderer.jsx`, add the import near the other screen-framework imports (next to the `ScreenScreensaver` import at line ~20):

```javascript
import { ScreenPresencePublisher } from './publishers/ScreenPresencePublisher.jsx';
```

Then find:

```javascript
                  <ScreenScreensaver config={config.screensaver} />
```

Replace with:

```javascript
                  <ScreenScreensaver config={config.screensaver} />
                  <ScreenPresencePublisher deviceId={config.websocket?.guardrails?.device} />
```

(This sits inside `MenuNavigationProvider` + `ScreenOverlayProvider`, so both contexts are available. It's a no-op when the screen has no `guardrails.device`.)

- [ ] **Step 6: Run the screen-framework suite to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen): mount ScreenPresencePublisher in ScreenRenderer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backend `ScreenPresenceService`

Owns the HA boolean. All five stale-protection layers live here.

**Files:**
- Create: `backend/src/3_applications/devices/services/ScreenPresenceService.mjs`
- Test: `backend/tests/unit/suite/3_applications/devices/ScreenPresenceService.test.mjs`

- [ ] **Step 1: Write the failing test** — Create `backend/tests/unit/suite/3_applications/devices/ScreenPresenceService.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScreenPresenceService } from '#apps/devices/services/ScreenPresenceService.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

// Mock event bus that captures the message + disconnect handlers so the test can
// drive inbound client traffic directly.
function makeBus() {
  const bus = {
    msgHandler: null,
    discHandler: null,
    onClientMessage(cb) { bus.msgHandler = cb; },
    onClientDisconnection(cb) { bus.discHandler = cb; },
  };
  return bus;
}

function makeHa() {
  return { callService: vi.fn(async () => ({ ok: true })) };
}

const PRESENCE = { 'office-tv': { entity: 'input_boolean.office_tv_active', ttlMs: 15000 } };
const calls = (ha) => ha.callService.mock.calls.map(([d, s, data]) => `${s}:${data.entity_id}`);

let clock, bus, ha, svc;
beforeEach(() => {
  vi.useFakeTimers();
  clock = makeClock(); bus = makeBus(); ha = makeHa();
  svc = new ScreenPresenceService({ haGateway: ha, presenceByDevice: PRESENCE, clock });
  svc.start(bus);
});
afterEach(() => { svc.stop(); vi.useRealTimers(); });

describe('ScreenPresenceService', () => {
  it('asserts OFF for every configured device on startup', () => {
    expect(calls(ha)).toEqual(['turn_off:input_boolean.office_tv_active']);
  });

  it('turns the boolean ON when an active presence message arrives', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    expect(calls(ha).at(-1)).toBe('turn_on:input_boolean.office_tv_active');
  });

  it('is idempotent — repeated active messages do not re-call HA', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    const n = ha.callService.mock.calls.length;
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    expect(ha.callService.mock.calls.length).toBe(n);
  });

  it('turns OFF on a clean inactive transition', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: false });
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('forces OFF via the TTL watchdog when heartbeats stop', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    clock.advance(16000);
    vi.advanceTimersByTime(5000); // watchdog tick
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('turns OFF immediately when the client disconnects', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    bus.discHandler('c1');
    expect(calls(ha).at(-1)).toBe('turn_off:input_boolean.office_tv_active');
  });

  it('ignores presence for unconfigured devices', () => {
    const before = ha.callService.mock.calls.length;
    bus.msgHandler('c9', { type: 'screen.presence', deviceId: 'kitchen-tv', active: true });
    expect(ha.callService.mock.calls.length).toBe(before);
  });

  it('reconcile re-asserts the desired state (self-heals a lost call)', () => {
    bus.msgHandler('c1', { type: 'screen.presence', deviceId: 'office-tv', active: true });
    const n = ha.callService.mock.calls.length;
    vi.advanceTimersByTime(60000); // reconcile tick
    expect(ha.callService.mock.calls.length).toBeGreaterThan(n);
    expect(calls(ha).at(-1)).toBe('turn_on:input_boolean.office_tv_active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/tests/unit/suite/3_applications/devices/ScreenPresenceService.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the service** — Create `backend/src/3_applications/devices/services/ScreenPresenceService.mjs`:

```javascript
/**
 * ScreenPresenceService — owns a Home Assistant input_boolean per screen device,
 * driven by `screen.presence` WS messages. TRUE while the screen shows content,
 * FALSE otherwise. Defends against stale/lost state with: startup assert-off,
 * clean-transition off, a heartbeat TTL watchdog, periodic reconcile, and
 * immediate off on client disconnect.
 *
 * @module 3_applications/devices/services/ScreenPresenceService
 */

const DEFAULT_TTL_MS = 15000;
const DEFAULT_WATCHDOG_MS = 5000;
const DEFAULT_RECONCILE_MS = 60000;

export class ScreenPresenceService {
  #ha; #logger; #clock; #devices; #clientDevice;
  #watchdog; #reconcile; #watchdogMs; #reconcileMs;

  /**
   * @param {Object} opts
   * @param {{callService: Function}} opts.haGateway
   * @param {Object<string,{entity:string, ttlMs?:number}>|Map} opts.presenceByDevice
   * @param {Object} [opts.logger]
   * @param {{now:()=>number}} [opts.clock] - defaults to Date (Date.now)
   * @param {number} [opts.watchdogIntervalMs]
   * @param {number} [opts.reconcileIntervalMs]
   */
  constructor({ haGateway, presenceByDevice, logger = console, clock = Date,
    watchdogIntervalMs = DEFAULT_WATCHDOG_MS, reconcileIntervalMs = DEFAULT_RECONCILE_MS } = {}) {
    if (!haGateway) throw new Error('ScreenPresenceService requires haGateway');
    this.#ha = haGateway;
    this.#logger = logger;
    this.#clock = clock;
    this.#watchdogMs = watchdogIntervalMs;
    this.#reconcileMs = reconcileIntervalMs;
    this.#devices = new Map();
    const entries = presenceByDevice instanceof Map
      ? presenceByDevice.entries()
      : Object.entries(presenceByDevice || {});
    for (const [deviceId, cfg] of entries) {
      if (!cfg?.entity) continue;
      this.#devices.set(deviceId, {
        entity: cfg.entity,
        ttlMs: cfg.ttlMs || DEFAULT_TTL_MS,
        active: false,
        lastSeen: 0,
        asserted: null, // null = unknown until first assert
      });
    }
    this.#clientDevice = new Map(); // clientId -> deviceId
    this.#watchdog = null;
    this.#reconcile = null;
  }

  /** @param {{onClientMessage:Function, onClientDisconnection:Function}} eventBus */
  start(eventBus) {
    // Layer 3: startup assert OFF — clears a stale true left by a prior run/crash.
    for (const deviceId of this.#devices.keys()) this.#assert(deviceId, false, 'startup');

    if (typeof eventBus?.onClientMessage === 'function') {
      eventBus.onClientMessage((clientId, message) => this.#onMessage(clientId, message));
    }
    if (typeof eventBus?.onClientDisconnection === 'function') {
      eventBus.onClientDisconnection((clientId) => this.#onDisconnect(clientId));
    }

    this.#watchdog = setInterval(() => this.#tickWatchdog(), this.#watchdogMs);
    this.#reconcile = setInterval(() => this.#tickReconcile(), this.#reconcileMs);
    this.#watchdog.unref?.();
    this.#reconcile.unref?.();
    this.#logger.info?.('screen-presence.started', { devices: [...this.#devices.keys()] });
  }

  stop() {
    if (this.#watchdog) clearInterval(this.#watchdog);
    if (this.#reconcile) clearInterval(this.#reconcile);
    this.#watchdog = null;
    this.#reconcile = null;
  }

  #onMessage(clientId, message) {
    if (!message || message.type !== 'screen.presence') return;
    const device = this.#devices.get(message.deviceId);
    if (!device) return; // device not configured for presence
    this.#clientDevice.set(clientId, message.deviceId);
    device.lastSeen = this.#clock.now();
    device.active = !!message.active;
    this.#assert(message.deviceId, device.active, 'message');
  }

  #onDisconnect(clientId) {
    const deviceId = this.#clientDevice.get(clientId);
    this.#clientDevice.delete(clientId);
    if (!deviceId) return;
    const device = this.#devices.get(deviceId);
    if (!device) return;
    device.active = false; // Layer 5: client gone → inactive immediately
    this.#assert(deviceId, false, 'disconnect');
  }

  #tickWatchdog() {
    const now = this.#clock.now();
    for (const [deviceId, device] of this.#devices) {
      if (device.asserted === true && now - device.lastSeen > device.ttlMs) {
        device.active = false; // Layer 2: heartbeats stopped → stale → off
        this.#assert(deviceId, false, 'stale-ttl');
      }
    }
  }

  #tickReconcile() {
    const now = this.#clock.now();
    for (const [deviceId, device] of this.#devices) {
      const desired = device.active && (now - device.lastSeen <= device.ttlMs);
      // Layer 4: force a re-call even if asserted already matches — self-heals a
      // dropped/lost HA call. input_boolean turn_on/off is idempotent in HA.
      this.#callHa(device.entity, desired);
      device.asserted = desired;
    }
  }

  #assert(deviceId, on, reason) {
    const device = this.#devices.get(deviceId);
    if (!device) return;
    if (device.asserted === on) return; // idempotent — no flapping/spam
    this.#callHa(device.entity, on);
    device.asserted = on;
    this.#logger.info?.('screen-presence.assert', { deviceId, entity: device.entity, on, reason });
  }

  #callHa(entity, on) {
    Promise.resolve(
      this.#ha.callService('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: entity })
    ).catch((err) => this.#logger.warn?.('screen-presence.ha-call-failed', {
      entity, on, error: String(err?.message ?? err),
    }));
  }
}

export default ScreenPresenceService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/tests/unit/suite/3_applications/devices/ScreenPresenceService.test.mjs`
Expected: PASS (8 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/ScreenPresenceService.mjs backend/tests/unit/suite/3_applications/devices/ScreenPresenceService.test.mjs
git commit -m "feat(devices): ScreenPresenceService drives HA input_boolean from presence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Bootstrap factory + app.mjs wiring

**Files:**
- Create: `backend/src/0_system/bootstrap/screenPresence.mjs`
- Test: `backend/tests/unit/suite/0_system/bootstrap/screenPresence.test.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Write the failing test** — Create `backend/tests/unit/suite/0_system/bootstrap/screenPresence.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScreenPresenceService, _resetForTests } from '#system/bootstrap/screenPresence.mjs';

function makeBus() {
  return { onClientMessage: vi.fn(), onClientDisconnection: vi.fn() };
}
function makeHa() { return { callService: vi.fn(async () => ({ ok: true })) }; }

const DEVICES = {
  'office-tv': { type: 'linux-pc', presence: { entity: 'input_boolean.office_tv_active', ttlMs: 15000 } },
  'kitchen-tv': { type: 'linux-pc' }, // no presence block → ignored
};

beforeEach(() => { _resetForTests(); });

describe('createScreenPresenceService', () => {
  it('wires a service for devices that declare presence.entity', () => {
    const bus = makeBus();
    const { presenceService } = createScreenPresenceService({
      eventBus: bus, haGateway: makeHa(), devicesConfig: DEVICES,
    });
    expect(presenceService).toBeTruthy();
    expect(bus.onClientMessage).toHaveBeenCalledTimes(1);
    expect(bus.onClientDisconnection).toHaveBeenCalledTimes(1);
  });

  it('skips (null) when no device declares presence', () => {
    const { presenceService } = createScreenPresenceService({
      eventBus: makeBus(), haGateway: makeHa(), devicesConfig: { 'kitchen-tv': { type: 'linux-pc' } },
    });
    expect(presenceService).toBeNull();
  });

  it('skips (null) when the HA gateway is absent', () => {
    const { presenceService } = createScreenPresenceService({
      eventBus: makeBus(), haGateway: null, devicesConfig: DEVICES,
    });
    expect(presenceService).toBeNull();
  });

  it('throws without an event bus', () => {
    expect(() => createScreenPresenceService({ eventBus: null, haGateway: makeHa(), devicesConfig: DEVICES }))
      .toThrow(/eventBus/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/tests/unit/suite/0_system/bootstrap/screenPresence.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the factory** — Create `backend/src/0_system/bootstrap/screenPresence.mjs`:

```javascript
/**
 * ScreenPresenceService factory — builds the presence→entity map from the device
 * config and wires the service into the event bus. Mirrors bootstrap/deviceLiveness.
 *
 * @module 0_system/bootstrap/screenPresence
 */

import { ScreenPresenceService } from '#apps/devices/services/ScreenPresenceService.mjs';

/** @type {ScreenPresenceService | null} */
let instance = null;

/**
 * @param {Object} config
 * @param {Object} config.eventBus
 * @param {{callService:Function}|null} config.haGateway
 * @param {Object<string,Object>} config.devicesConfig - per-device config map
 * @param {Object} [config.logger]
 * @param {{now:()=>number}} [config.clock]
 * @returns {{ presenceService: ScreenPresenceService|null }}
 */
export function createScreenPresenceService({ eventBus, haGateway, devicesConfig, logger = console, clock } = {}) {
  if (!eventBus) throw new Error('createScreenPresenceService requires eventBus');
  if (instance) {
    logger.warn?.('screen-presence.already_created');
    return { presenceService: instance };
  }

  const presenceByDevice = {};
  for (const [deviceId, cfg] of Object.entries(devicesConfig || {})) {
    if (cfg?.presence?.entity) {
      presenceByDevice[deviceId] = { entity: cfg.presence.entity, ttlMs: cfg.presence.ttlMs };
    }
  }

  if (!haGateway) {
    logger.warn?.('screen-presence.skipped_no_ha_gateway');
    return { presenceService: null };
  }
  if (Object.keys(presenceByDevice).length === 0) {
    logger.info?.('screen-presence.skipped_no_config');
    return { presenceService: null };
  }

  const presenceService = new ScreenPresenceService({ haGateway, presenceByDevice, logger, clock });
  presenceService.start(eventBus);
  instance = presenceService;
  return { presenceService };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/tests/unit/suite/0_system/bootstrap/screenPresence.test.mjs`
Expected: PASS (4 passing).

- [ ] **Step 5: Wire it into app.mjs.** In `backend/src/app.mjs`, add the import next to the existing `bootstrap` imports (the block importing `createDeviceLivenessService` etc.):

```javascript
import { createScreenPresenceService } from './0_system/bootstrap/screenPresence.mjs';
```

Then find the device-services block:

```javascript
  const deviceServices = await createDeviceServices({
    devicesConfig: devicesConfig.devices || {},
    haGateway: homeAutomationAdapters.haGateway,
    httpClient: axios,
    wsBus: eventBus,
    remoteExec: homeAutomationAdapters.remoteExecAdapter,
    daylightHost,
    configService,
    logger: rootLogger.child({ module: 'devices' })
  });
```

Immediately after it, add:

```javascript
  // Screen presence → HA input_boolean (e.g. office_tv_active). Reads the
  // `presence:` block on each device in devices.yml. No-op if no device declares
  // one or the HA gateway is absent.
  createScreenPresenceService({
    eventBus,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    logger: rootLogger.child({ module: 'screen-presence' }),
  });
```

- [ ] **Step 6: Verify the backend boots clean (syntax/wiring).** Build is the integration check (Task 6). For a fast local check that the module graph resolves:

Run: `node --check backend/src/app.mjs && node --check backend/src/0_system/bootstrap/screenPresence.mjs && node --check backend/src/3_applications/devices/services/ScreenPresenceService.mjs`
Expected: no output (all parse OK).

- [ ] **Step 7: Commit**

```bash
git add backend/src/0_system/bootstrap/screenPresence.mjs backend/tests/unit/suite/0_system/bootstrap/screenPresence.test.mjs backend/src/app.mjs
git commit -m "feat(bootstrap): wire ScreenPresenceService from devices.yml presence config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Config + live verification

**Files:**
- Modify: `data/household/config/devices.yml` (in the data volume — edit via the container)

- [ ] **Step 1: Add the presence block to office-tv.** The office-tv entry currently ends its block before the next device. Add a `presence:` key at the same indentation as `device_control:` / `content_control:` under `office-tv:`. Read the current file first, then write it back with the block added (NEVER `sed -i` YAML):

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/devices.yml' > /tmp/devices.yml
# Edit /tmp/devices.yml: under `  office-tv:` add (2-space + 2-space indent):
#     presence:
#       entity: input_boolean.office_tv_active
#       ttlMs: 15000
sudo docker exec daylight-station sh -c "cat > data/household/config/devices.yml" < /tmp/devices.yml
```

The resulting `office-tv` block must contain:

```yaml
  office-tv:
    type: linux-pc
    presence:
      entity: input_boolean.office_tv_active
      ttlMs: 15000
    # ...existing keys (device_control, os_control, content_control, modules)...
```

- [ ] **Step 2: Confirm the entity exists in Home Assistant.** Before relying on it, verify the `input_boolean` exists (create it in HA if not):

```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2) && curl -s http://homeassistant:8123/api/states/input_boolean.office_tv_active -H "Authorization: Bearer $TOKEN"'
```
Expected: a JSON state object (not `404`). If 404, create `input_boolean.office_tv_active` in HA first.

- [ ] **Step 3: Build, gate-check, deploy.** Per `CLAUDE.local.md` — do not deploy during an active fitness session or while a Player video/readalong is actually playing.

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
# gate check
sudo docker logs --since 30s daylight-station 2>&1 | grep -c '"event":"playback.render_fps"'
sudo docker logs --since 40s daylight-station 2>&1 | grep -oE '"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
# if clear:
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: build succeeds; gate shows 0 render frames + `sessionActive:false` before deploying.

- [ ] **Step 4: Reload the office screen** so it serves the new bundle (the office screen is local Brave; reload via CDP per project memory `reference_office_brave_cdp_reload`, or have the user reload it). The presence publisher only runs once the office screen loads the new frontend.

- [ ] **Step 5: Verify the end-to-end behavior from logs.**

```bash
# Startup asserts OFF:
sudo docker logs --since 120s daylight-station 2>&1 | grep '"event":"screen-presence.started"'
sudo docker logs --since 120s daylight-station 2>&1 | grep '"screen-presence.assert"' | tail -5
```
Then, with someone (or you) driving the office screen: launching content should log `screen-presence.assert {on:true}` and returning to the dashboard should log `{on:false}`. Confirm the HA entity tracks it:

```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2) && curl -s http://homeassistant:8123/api/states/input_boolean.office_tv_active -H "Authorization: Bearer $TOKEN" | grep -o "\"state\":\"[a-z]*\""'
```
Expected: `on` while content is showing on office, `off` on the dashboard, and `off` within ~15s of the screen being closed/disconnected (stale-ttl).

- [ ] **Step 6: Record the result** in the commit/PR description (assert logs + HA state transitions observed). Config files in the data volume are not committed to git; note the devices.yml change in the PR description so it's reproducible.

---

## Self-Review

- **Spec coverage:** TRUE-condition B → `screenActivity.isContentActive` (Task 1) + publisher (Tasks 2–3). Latency A (5s/15s) → hook heartbeat (Task 2) + service `ttlMs`/watchdog (Task 4). Config in devices.yml → Task 6 + factory (Task 5). Five stale-protection layers → all in `ScreenPresenceService` (Task 4): startup-off, clean-transition off, TTL watchdog, reconcile, disconnect-off (each has a test). Covered.
- **Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code/test step is complete. The only manual edit is the YAML block in Task 6, shown verbatim.
- **Type/name consistency:** `isContentActive(currentContent, hasOverlay)` and `BROWSE_NAV_TYPES` are defined in Task 1 and consumed identically in Tasks 1 & 3. Message shape `{type:'screen.presence', deviceId, active, ts}` is produced in Task 2 and consumed in Task 4. `presenceByDevice` entries `{entity, ttlMs}` are produced by the factory (Task 5) and consumed by the service constructor (Task 4). `haGateway.callService('input_boolean', 'turn_on'|'turn_off', {entity_id})` matches the real adapter signature. `onClientMessage(clientId, message)` / `onClientDisconnection(clientId)` match `WebSocketEventBus`.
- **Scope:** Single subsystem (presence signal). No decomposition needed.
