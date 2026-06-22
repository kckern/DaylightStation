# Ambient TV Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule passive ArtMode windows on the living-room TV — wake + load a chosen art preset at a window's start, power the TV off at its end — always yielding to anything actively playing.

**Architecture:** A dedicated `AmbientSchedulerService` (3_applications) ticks every 60s and reconciles a `schedule:` block read from `artmode.yml`. The tricky decision logic lives in a **pure** domain evaluator. "Is a video playing?" comes from a finer `playing` flag added to the existing `screen.presence` WS heartbeat (ArtMode advertises itself as a passive scene so it is excluded), tracked backend-side by a small `ScreenContentTracker`.

**Tech Stack:** Node ESM (`.mjs`), Express, js-yaml, Jest (backend unit tests), React + Vitest (frontend), WebSocket eventBus.

**Two parts:**
- **Part A — Playing-state signal** (Tasks A1–A6): the reusable "is the TV playing a video" capability. Independently useful and testable.
- **Part B — Ambient scheduler** (Tasks B1–B8): the feature proper. Depends on Part A's tracker.

**Conventions used throughout:**
- Backend import aliases: `#domains/* #apps/* #adapters/* #system/*` (see root `package.json` `imports` + `jest.config.js` `moduleNameMapper`).
- Backend unit test path: `backend/tests/unit/**` (matches Jest `testMatch`). Run a single file from repo root:
  `NODE_OPTIONS=--experimental-vm-modules npx jest <path> --config jest.config.js`
- Frontend tests are co-located `*.test.jsx` using **vitest**. Run from repo root:
  `npx vitest run <path>`
- Commit after every task.

---

## File Structure

**Part A — signal**
- Create `backend/src/3_applications/devices/services/ScreenContentTracker.mjs` — per-device `{playing,lastSeen}` registry with TTL, fed by `screen.presence` WS messages. Exposes `isPlaying(deviceId)`.
- Create `frontend/src/screen-framework/providers/ScreenSceneContext.jsx` — context flag `artSceneActive` set by ArtMode while mounted.
- Modify `frontend/src/screen-framework/ScreenRenderer.jsx` — wrap `ScreenSceneProvider` around `ScreenOverlayProvider`.
- Modify `frontend/src/screen-framework/widgets/ArtMode.jsx` — set `artSceneActive` true on mount, false on unmount.
- Modify `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx` — compute `playing = active && !artSceneActive`.
- Modify `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js` — include `playing` in the WS message + effect deps.
- Modify `backend/src/app.mjs` — construct + `start(eventBus)` the tracker (Part A) and the scheduler (Part B).

**Part B — scheduler**
- Create `backend/src/2_domains/ambient/timeParts.mjs` — pure `parseHHMM`, `resolveNowParts`.
- Create `backend/src/2_domains/ambient/normalizeWindows.mjs` — pure schedule → normalized windows + warnings.
- Create `backend/src/2_domains/ambient/evaluateAmbientSchedule.mjs` — pure reconciliation: (windows, now, state, idle) → {actions, nextState}.
- Create `backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs` — read/write `data/system/state/ambient-runtime.yml`.
- Create `backend/src/3_applications/ambient/AmbientSchedulerService.mjs` — the 60s tick; gathers inputs, calls the evaluator, executes actions, persists state.
- Modify `backend/src/1_adapters/content/art/artmodeConfig.mjs` — `loadArtmodeConfig` also returns `schedule`.
- Create `docs/reference/ambient/tv-schedule.md` — endstate reference.

---

# PART A — Playing-state signal

### Task A1: `ScreenContentTracker` (backend)

**Files:**
- Create: `backend/src/3_applications/devices/services/ScreenContentTracker.mjs`
- Test: `backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ScreenContentTracker', () => {
  it('reports not-playing for an unknown device', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('reports playing after a playing:true presence message', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: true });
    expect(tracker.isPlaying('livingroom-tv')).toBe(true);
  });

  it('reports not-playing when the latest message has playing:false (art/screensaver)', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: false });
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('treats a stale heartbeat (older than TTL) as not-playing', () => {
    const clock = fakeClock();
    const tracker = new ScreenContentTracker({ clock, ttlMs: 15000 });
    tracker.record({ type: 'screen.presence', deviceId: 'livingroom-tv', playing: true });
    clock.advance(15001);
    expect(tracker.isPlaying('livingroom-tv')).toBe(false);
  });

  it('ignores non-presence messages and messages without deviceId', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    tracker.record({ type: 'other', deviceId: 'x', playing: true });
    tracker.record({ type: 'screen.presence', playing: true });
    expect(tracker.isPlaying('x')).toBe(false);
  });

  it('start() subscribes to eventBus.onClientMessage', () => {
    const tracker = new ScreenContentTracker({ clock: fakeClock() });
    let handler = null;
    const eventBus = { onClientMessage: (fn) => { handler = fn; } };
    tracker.start(eventBus);
    handler('client-1', { type: 'screen.presence', deviceId: 'd', playing: true });
    expect(tracker.isPlaying('d')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs --config jest.config.js`
Expected: FAIL — `Cannot find module '#apps/devices/services/ScreenContentTracker.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/devices/services/ScreenContentTracker.mjs
/**
 * ScreenContentTracker — per-device "is a real video playing" registry, fed by
 * `screen.presence` WS messages carrying a `playing` flag (true only for
 * non-art content; ArtMode/screensaver report playing:false). A heartbeat older
 * than the TTL is treated as not-playing (a crashed player tab stops beating).
 *
 * @module 3_applications/devices/services/ScreenContentTracker
 */
const DEFAULT_TTL_MS = 15000;

export class ScreenContentTracker {
  #devices; #clock; #ttlMs; #logger;

  constructor({ clock = Date, ttlMs = DEFAULT_TTL_MS, logger = console } = {}) {
    this.#devices = new Map();   // deviceId -> { playing, lastSeen }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#logger = logger;
  }

  /** @param {{onClientMessage?:Function}} eventBus */
  start(eventBus) {
    if (typeof eventBus?.onClientMessage === 'function') {
      eventBus.onClientMessage((_clientId, message) => this.record(message));
    }
    this.#logger.info?.('screen-content.started', { ttlMs: this.#ttlMs });
  }

  record(message) {
    if (!message || message.type !== 'screen.presence' || !message.deviceId) return;
    this.#devices.set(message.deviceId, {
      playing: message.playing === true,
      lastSeen: this.#clock.now(),
    });
  }

  isPlaying(deviceId) {
    const d = this.#devices.get(deviceId);
    if (!d) return false;
    if (this.#clock.now() - d.lastSeen > this.#ttlMs) return false;
    return d.playing === true;
  }
}

export default ScreenContentTracker;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs --config jest.config.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/ScreenContentTracker.mjs backend/tests/unit/applications/devices/ScreenContentTracker.test.mjs
git commit -m "feat(ambient): ScreenContentTracker — per-device playing registry with TTL"
```

---

### Task A2: `ScreenSceneContext` (frontend)

**Files:**
- Create: `frontend/src/screen-framework/providers/ScreenSceneContext.jsx`
- Test: `frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScreenSceneProvider, useScreenScene } from './ScreenSceneContext.jsx';

let api = null;
function Capture() { api = useScreenScene(); return null; }

describe('ScreenSceneContext', () => {
  it('defaults artSceneActive to false', () => {
    render(<ScreenSceneProvider><Capture /></ScreenSceneProvider>);
    expect(api.artSceneActive).toBe(false);
  });

  it('setArtSceneActive(true) flips the flag', () => {
    render(<ScreenSceneProvider><Capture /></ScreenSceneProvider>);
    act(() => api.setArtSceneActive(true));
    expect(api.artSceneActive).toBe(true);
  });

  it('provides a no-op default outside a provider', () => {
    render(<Capture />);
    expect(api.artSceneActive).toBe(false);
    expect(() => api.setArtSceneActive(true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx`
Expected: FAIL — cannot resolve `./ScreenSceneContext.jsx`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/screen-framework/providers/ScreenSceneContext.jsx
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// Tracks whether an ArtMode "scene" (the idle screensaver OR an ambient-loaded
// art preset) is currently mounted. The presence publisher reads this to mark
// art as passive (playing:false) even though it occupies a fullscreen overlay.
const ScreenSceneContext = createContext({ artSceneActive: false, setArtSceneActive: () => {} });

export function ScreenSceneProvider({ children }) {
  const [artSceneActive, setActive] = useState(false);
  const setArtSceneActive = useCallback((v) => setActive(!!v), []);
  const value = useMemo(() => ({ artSceneActive, setArtSceneActive }), [artSceneActive, setArtSceneActive]);
  return <ScreenSceneContext.Provider value={value}>{children}</ScreenSceneContext.Provider>;
}

export function useScreenScene() { return useContext(ScreenSceneContext); }

export default ScreenSceneContext;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/providers/ScreenSceneContext.jsx frontend/src/screen-framework/providers/ScreenSceneContext.test.jsx
git commit -m "feat(ambient): ScreenSceneContext — flag art scenes as passive"
```

---

### Task A3: Mount `ScreenSceneProvider` in `ScreenRenderer`

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

- [ ] **Step 1: Add the import**

Near the other screen-framework imports (e.g. after the `ScreenPresencePublisher` import at line ~21), add:

```jsx
import { ScreenSceneProvider } from './providers/ScreenSceneContext.jsx';
```

- [ ] **Step 2: Wrap `ScreenOverlayProvider`**

Find this block (around line 368-383):

```jsx
            <MenuNavigationProvider>
              <ScreenOverlayProvider>
                <PipManager config={config.pip}>
```

Change it to:

```jsx
            <MenuNavigationProvider>
              <ScreenSceneProvider>
              <ScreenOverlayProvider>
                <PipManager config={config.pip}>
```

And find the matching close (around line 384-386):

```jsx
              </ScreenOverlayProvider>
            </MenuNavigationProvider>
```

Change it to:

```jsx
              </ScreenOverlayProvider>
              </ScreenSceneProvider>
            </MenuNavigationProvider>
```

(`ScreenSceneProvider` must be **above** `ScreenOverlayProvider` so that both the
`ScreenPresencePublisher` and the portal-rendered ArtMode are descendants and
share the same context instance.)

- [ ] **Step 3: Verify the screen-framework still compiles**

Run: `npx vitest run frontend/src/screen-framework/publishers/ScreenPresencePublisher.test.jsx`
Expected: PASS (existing tests still green — the new provider has a default value, so unwrapped renders are unaffected).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(ambient): mount ScreenSceneProvider above the overlay provider"
```

---

### Task A4: ArtMode advertises itself as a passive scene

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`

- [ ] **Step 1: Add the import**

After the existing context imports (near line 13, `import { useScreenAction } ...`), add:

```jsx
import { useScreenScene } from '../providers/ScreenSceneContext.jsx';
```

- [ ] **Step 2: Set the flag on mount/unmount**

Inside the `ArtMode` component body, just after the existing `const logger = useMemo(...)` line (around line 149), add:

```jsx
  // Tell the screen this is a passive art scene (screensaver or ambient preset),
  // so presence reports playing:false while we're up. No-op outside a screen.
  const { setArtSceneActive } = useScreenScene();
  useEffect(() => {
    setArtSceneActive(true);
    return () => setArtSceneActive(false);
  }, [setArtSceneActive]);
```

(`useEffect` is already imported at the top of ArtMode.jsx.)

- [ ] **Step 3: Verify ArtMode tests still pass**

Run: `npx vitest run frontend/src/screen-framework/widgets/`
Expected: PASS — existing ArtMode tests unaffected (the hook no-ops without a provider).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx
git commit -m "feat(ambient): ArtMode marks itself a passive scene via ScreenSceneContext"
```

---

### Task A5: Presence publisher emits the `playing` flag

**Files:**
- Modify: `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx`
- Modify: `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js`
- Test: `frontend/src/screen-framework/publishers/useScreenPresencePublisher.playing.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/screen-framework/publishers/useScreenPresencePublisher.playing.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));
const { wsService } = await import('../../services/WebSocketService.js');
const { useScreenPresencePublisher } = await import('./useScreenPresencePublisher.js');

function Harness({ active, playing }) {
  useScreenPresencePublisher({ deviceId: 'livingroom-tv', active, playing });
  return null;
}

describe('useScreenPresencePublisher playing flag', () => {
  beforeEach(() => { wsService.send.mockClear(); });

  it('includes playing:true in the message when a video is up', () => {
    render(<Harness active playing />);
    expect(wsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'screen.presence', deviceId: 'livingroom-tv', active: true, playing: true }),
    );
  });

  it('includes playing:false for an active-but-art scene', () => {
    render(<Harness active playing={false} />);
    expect(wsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, playing: false }),
    );
  });

  it('defaults playing to false when omitted', () => {
    render(<Harness active />);
    expect(wsService.send).toHaveBeenCalledWith(expect.objectContaining({ playing: false }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/screen-framework/publishers/useScreenPresencePublisher.playing.test.jsx`
Expected: FAIL — sent message has no `playing` key.

- [ ] **Step 3: Implement — add `playing` to the hook**

In `frontend/src/screen-framework/publishers/useScreenPresencePublisher.js`, change the signature and message. Replace the whole `export function useScreenPresencePublisher(...) { ... }` body with:

```javascript
export function useScreenPresencePublisher({ deviceId, active, playing = false }) {
  useEffect(() => {
    if (!deviceId) return undefined;

    const send = () => {
      try {
        wsService.send({
          type: 'screen.presence',
          deviceId,
          active: !!active,
          playing: !!playing,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        logger().warn('publish-failed', { deviceId, active, playing, error: String(err?.message ?? err) });
      }
    };

    // Transition/mount emit.
    send();
    logger().info('mounted', { deviceId, active: !!active, playing: !!playing });

    if (!active) return () => { logger().info('unmounted', { deviceId }); };
    const timer = setInterval(send, HEARTBEAT_MS);
    return () => { clearInterval(timer); logger().info('unmounted', { deviceId }); };
  }, [deviceId, active, playing]);
}
```

- [ ] **Step 4: Implement — compute `playing` in the publisher component**

Replace the body of `frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx` with:

```jsx
import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { useScreenScene } from '../providers/ScreenSceneContext.jsx';
import { isContentActive } from '../screenActivity.js';
import { useScreenPresencePublisher } from './useScreenPresencePublisher.js';

/**
 * Renderless: computes content-presence from the nav stack + overlay state and
 * publishes it for the backend ScreenPresenceService (drives office_tv_active)
 * and ScreenContentTracker. `playing` excludes ArtMode scenes (screensaver /
 * ambient presets), which are passive even though they own a fullscreen overlay.
 * Must be mounted inside MenuNavigationProvider + ScreenOverlayProvider + ScreenSceneProvider.
 */
export function ScreenPresencePublisher({ deviceId }) {
  const { currentContent } = useMenuNavigationContext();
  const { hasOverlay } = useScreenOverlay();
  const { artSceneActive } = useScreenScene();
  const active = isContentActive(currentContent, hasOverlay);
  const playing = active && !artSceneActive;
  useScreenPresencePublisher({ deviceId, active, playing });
  return null;
}

export default ScreenPresencePublisher;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run frontend/src/screen-framework/publishers/`
Expected: PASS — the new `playing` test plus the existing `ScreenPresencePublisher.test.jsx` (its `active` assertions are unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/publishers/ScreenPresencePublisher.jsx frontend/src/screen-framework/publishers/useScreenPresencePublisher.js frontend/src/screen-framework/publishers/useScreenPresencePublisher.playing.test.jsx
git commit -m "feat(ambient): publish playing flag (active && not an art scene)"
```

---

### Task A6: Wire `ScreenContentTracker` into `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Add the import**

Near the scheduling imports (around line 149-154), add:

```javascript
import { ScreenContentTracker } from '#apps/devices/services/ScreenContentTracker.mjs';
```

- [ ] **Step 2: Construct + start the tracker**

Immediately after the `createScreenPresenceService({ ... })` call (around line 1872-1877), add:

```javascript
  // Per-device "is a video playing" registry (excludes ArtMode scenes), fed by
  // the same `screen.presence` heartbeat. Read by the ambient scheduler.
  const screenContentTracker = new ScreenContentTracker({
    logger: rootLogger.child({ module: 'screen-content' }),
  });
  screenContentTracker.start(eventBus);
```

- [ ] **Step 3: Verify the app still boots (smoke import)**

Run: `node --input-type=module -e "await import('./backend/src/3_applications/devices/services/ScreenContentTracker.mjs'); console.log('ok')"`
Expected: prints `ok` (module loads cleanly).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(ambient): wire ScreenContentTracker to the WS eventBus"
```

---

# PART B — Ambient scheduler

### Task B1: Pure time helpers (`timeParts.mjs`)

**Files:**
- Create: `backend/src/2_domains/ambient/timeParts.mjs`
- Test: `backend/tests/unit/domains/ambient/timeParts.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/domains/ambient/timeParts.test.mjs
import { parseHHMM, resolveNowParts } from '#domains/ambient/timeParts.mjs';

describe('parseHHMM', () => {
  it('parses HH:MM to minutes since midnight', () => {
    expect(parseHHMM('07:00')).toBe(420);
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('23:59')).toBe(1439);
  });
  it('returns null for malformed input', () => {
    expect(parseHHMM('7am')).toBeNull();
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('07:60')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });
});

describe('resolveNowParts', () => {
  it('derives local dateStr, dow and minutes for a timezone', () => {
    // 2026-06-22T14:30:00Z === 07:30 Mon in America/Los_Angeles (PDT, -7)
    const p = resolveNowParts(new Date('2026-06-22T14:30:00Z'), 'America/Los_Angeles');
    expect(p.dateStr).toBe('2026-06-22');
    expect(p.dow).toBe(1);        // Monday
    expect(p.minutes).toBe(450);  // 07:30
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/timeParts.test.mjs --config jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/ambient/timeParts.mjs
// Pure time helpers for the ambient scheduler. No I/O.

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** "HH:MM" → minutes since local midnight, or null if malformed. */
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Resolve a Date into local-wall-clock parts for a timezone.
 * @returns {{dateStr:string, dow:number, minutes:number, iso:string}}
 */
export function resolveNowParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some runtimes render midnight as 24
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dow: WEEKDAY[parts.weekday],
    minutes: hour * 60 + Number(parts.minute),
    iso: date.toISOString(),
  };
}

export default { parseHHMM, resolveNowParts };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/timeParts.test.mjs --config jest.config.js`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/ambient/timeParts.mjs backend/tests/unit/domains/ambient/timeParts.test.mjs
git commit -m "feat(ambient): pure time helpers (parseHHMM, resolveNowParts)"
```

---

### Task B2: `normalizeWindows` (pure)

**Files:**
- Create: `backend/src/2_domains/ambient/normalizeWindows.mjs`
- Test: `backend/tests/unit/domains/ambient/normalizeWindows.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/domains/ambient/normalizeWindows.test.mjs
import { normalizeWindows } from '#domains/ambient/normalizeWindows.mjs';

describe('normalizeWindows', () => {
  it('normalizes a valid window with default device', () => {
    const { windows, warnings } = normalizeWindows(
      [{ name: 'am', days: ['mon', 'fri'], start: '07:00', end: '09:00', preset: 'impressionism' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(warnings).toEqual([]);
    expect(windows).toEqual([{
      key: 'am', name: 'am', days: [1, 5], startMin: 420, endMin: 540,
      preset: 'impressionism', device: 'livingroom-tv',
    }]);
  });

  it('derives a stable key from device|start|end|preset when unnamed', () => {
    const { windows } = normalizeWindows(
      [{ days: ['sun'], start: '08:00', end: '11:00', preset: 'religious' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(windows[0].key).toBe('livingroom-tv|08:00|11:00|religious');
    expect(windows[0].name).toBeNull();
  });

  it('honors a per-window device override', () => {
    const { windows } = normalizeWindows(
      [{ days: ['mon'], start: '07:00', end: '08:00', preset: 'x', device: 'office-tv' }],
      { defaultDevice: 'livingroom-tv' },
    );
    expect(windows[0].device).toBe('office-tv');
  });

  it('collects warnings and drops malformed windows', () => {
    const { windows, warnings } = normalizeWindows([
      { days: ['mon'], start: 'bad', end: '09:00', preset: 'x' },        // bad start
      { days: [], start: '07:00', end: '09:00', preset: 'x' },           // no days
      { days: ['mon'], start: '07:00', end: '09:00' },                   // no preset
      { days: ['mon'], start: '09:00', end: '07:00', preset: 'x' },      // end <= start
    ], { defaultDevice: 'd' });
    expect(windows).toEqual([]);
    expect(warnings).toHaveLength(4);
    expect(warnings.map((w) => w.reason)).toEqual([
      'invalid-window', 'invalid-window', 'invalid-window', 'end-not-after-start',
    ]);
  });

  it('returns empty for a missing/non-array schedule', () => {
    expect(normalizeWindows(undefined, {})).toEqual({ windows: [], warnings: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/normalizeWindows.test.mjs --config jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/ambient/normalizeWindows.mjs
// Pure: schedule (from artmode.yml) → normalized windows + warnings. No I/O.
import { parseHHMM } from './timeParts.mjs';

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function normalizeWindows(schedule, { defaultDevice = 'livingroom-tv' } = {}) {
  const windows = [];
  const warnings = [];
  const list = Array.isArray(schedule) ? schedule : [];

  list.forEach((w, index) => {
    const startMin = parseHHMM(w?.start);
    const endMin = parseHHMM(w?.end);
    const days = (Array.isArray(w?.days) ? w.days : [])
      .map((d) => DOW[String(d).toLowerCase()])
      .filter((d) => d !== undefined);
    const preset = w?.preset;
    const device = w?.device || defaultDevice;

    if (startMin == null || endMin == null || days.length === 0 || !preset) {
      warnings.push({ index, reason: 'invalid-window', window: w });
      return;
    }
    if (endMin <= startMin) {
      warnings.push({ index, reason: 'end-not-after-start', window: w });
      return;
    }
    const key = w?.name || `${device}|${w.start}|${w.end}|${preset}`;
    windows.push({ key, name: w?.name || null, days, startMin, endMin, preset, device });
  });

  return { windows, warnings };
}

export default normalizeWindows;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/normalizeWindows.test.mjs --config jest.config.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/ambient/normalizeWindows.mjs backend/tests/unit/domains/ambient/normalizeWindows.test.mjs
git commit -m "feat(ambient): normalizeWindows — validate + shape schedule entries"
```

---

### Task B3: `evaluateAmbientSchedule` (the pure brain)

**Files:**
- Create: `backend/src/2_domains/ambient/evaluateAmbientSchedule.mjs`
- Test: `backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs`

The evaluator returns `{ actions, state }`. Action types: `load`, `powerOff`, `skip`, `release`, `none`. State shape: `{ owned: {key,device,preset,startedAt}|null, handled: { [dateStr]: { [key]: {startHandled,endHandled} } } }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs
import { evaluateAmbientSchedule } from '#domains/ambient/evaluateAmbientSchedule.mjs';

const WIN = {
  key: 'am', name: 'am', days: [1], startMin: 420, endMin: 540,
  preset: 'impressionism', device: 'livingroom-tv',
};
const now = (minutes) => ({ dateStr: '2026-06-22', dow: 1, minutes, iso: '2026-06-22T00:00:00Z' });
const freshState = () => ({ owned: null, handled: {} });

describe('evaluateAmbientSchedule', () => {
  it('loads the preset at start when the device is idle', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(420), state: freshState(),
      idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'load', key: 'am', device: 'livingroom-tv', display: 'art:impressionism', preset: 'impressionism' }]);
    expect(state.owned).toMatchObject({ key: 'am', device: 'livingroom-tv', preset: 'impressionism' });
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('skips the window for the day when active at start (no ownership)', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(420), state: freshState(),
      idleByDevice: { 'livingroom-tv': false }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'skip', reason: 'active-content', key: 'am', device: 'livingroom-tv' }]);
    expect(state.owned).toBeNull();
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('does not re-fire start once handled', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: now(480), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([]);
  });

  it('powers off at end when ambient owns the session and the device is idle', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions, state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'powerOff', key: 'am', device: 'livingroom-tv' }]);
    expect(next.owned).toBeNull();
    expect(next.handled['2026-06-22'].am.endHandled).toBe(true);
  });

  it('releases (no power off) at end when the user took over', () => {
    const state = { owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions, state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': false }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'release', key: 'am', device: 'livingroom-tv', reason: 'active-at-end' }]);
    expect(next.owned).toBeNull();
  });

  it('does nothing at end when ambient does not own the session', () => {
    const state = { owned: null, handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } } };
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: now(540), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([{ type: 'none', key: 'am', device: 'livingroom-tv' }]);
  });

  it('on first tick after boot, marks a passed start handled WITHOUT acting', () => {
    const { actions, state } = evaluateAmbientSchedule({
      windows: [WIN], now: now(450), state: freshState(),
      idleByDevice: { 'livingroom-tv': true }, firstTick: true,
    });
    expect(actions).toEqual([{ type: 'skip', reason: 'boot-catchup', key: 'am', device: 'livingroom-tv' }]);
    expect(state.owned).toBeNull();
    expect(state.handled['2026-06-22'].am.startHandled).toBe(true);
  });

  it('ignores windows not scheduled for today', () => {
    const { actions } = evaluateAmbientSchedule({
      windows: [WIN], now: { dateStr: '2026-06-23', dow: 2, minutes: 420, iso: '' },
      state: freshState(), idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(actions).toEqual([]);
  });

  it('prunes handled state from previous days', () => {
    const state = { owned: null, handled: { '2026-06-21': { am: { startHandled: true, endHandled: true } } } };
    const { state: next } = evaluateAmbientSchedule({
      windows: [WIN], now: now(300), state, idleByDevice: { 'livingroom-tv': true }, firstTick: false,
    });
    expect(next.handled['2026-06-21']).toBeUndefined();
    expect(next.handled['2026-06-22']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs --config jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/ambient/evaluateAmbientSchedule.mjs
// Pure reconciliation. Given today's windows, the current local time parts,
// persisted state, and per-device idle booleans, return the actions to take and
// the next state. No I/O, no clock, no logging.
//
// Action types: 'load' | 'powerOff' | 'skip' | 'release' | 'none'.

export function evaluateAmbientSchedule({ windows, now, state, idleByDevice, firstTick }) {
  const actions = [];

  // Next state keeps only today's handled map (prunes prior days).
  const today = { ...((state.handled && state.handled[now.dateStr]) || {}) };
  const next = {
    owned: state.owned ? { ...state.owned } : null,
    handled: { [now.dateStr]: today },
  };

  for (const w of windows) {
    if (!w.days.includes(now.dow)) continue;
    const h = { ...(today[w.key] || { startHandled: false, endHandled: false }) };

    // START edge.
    if (now.minutes >= w.startMin && !h.startHandled) {
      h.startHandled = true;
      if (firstTick) {
        // Boot catch-up: the start already passed before we were watching. Never
        // act retroactively (no surprise power-on after a restart).
        actions.push({ type: 'skip', reason: 'boot-catchup', key: w.key, device: w.device });
      } else if (idleByDevice[w.device]) {
        actions.push({ type: 'load', key: w.key, device: w.device, display: `art:${w.preset}`, preset: w.preset });
        next.owned = { key: w.key, device: w.device, preset: w.preset, startedAt: now.iso };
      } else {
        actions.push({ type: 'skip', reason: 'active-content', key: w.key, device: w.device });
      }
    }

    // END edge.
    if (now.minutes >= w.endMin && !h.endHandled) {
      h.endHandled = true;
      if (next.owned && next.owned.key === w.key) {
        if (idleByDevice[w.device]) {
          actions.push({ type: 'powerOff', key: w.key, device: w.device });
        } else {
          actions.push({ type: 'release', key: w.key, device: w.device, reason: 'active-at-end' });
        }
        next.owned = null;
      } else {
        actions.push({ type: 'none', key: w.key, device: w.device });
      }
    }

    today[w.key] = h;
  }

  return { actions, state: next };
}

export default evaluateAmbientSchedule;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs --config jest.config.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/ambient/evaluateAmbientSchedule.mjs backend/tests/unit/domains/ambient/evaluateAmbientSchedule.test.mjs
git commit -m "feat(ambient): evaluateAmbientSchedule — pure reconciliation brain"
```

---

### Task B4: `YamlAmbientStateStore`

**Files:**
- Create: `backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs`
- Test: `backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { YamlAmbientStateStore } from '#adapters/ambient/YamlAmbientStateStore.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ambient-state-'));
});
afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('YamlAmbientStateStore', () => {
  it('returns a default empty state when the file is absent', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    expect(await store.load()).toEqual({ owned: null, handled: {} });
  });

  it('round-trips state through save/load', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    const state = {
      owned: { key: 'am', device: 'livingroom-tv', preset: 'impressionism', startedAt: '2026-06-22T14:00:00Z' },
      handled: { '2026-06-22': { am: { startHandled: true, endHandled: false } } },
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('writes to system/state/ambient-runtime.yml', async () => {
    const store = new YamlAmbientStateStore({ dataDir });
    await store.save({ owned: null, handled: {} });
    const raw = await fs.readFile(path.join(dataDir, 'system', 'state', 'ambient-runtime.yml'), 'utf8');
    expect(raw).toContain('owned:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs --config jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs
// Persists ambient scheduler state to data/system/state/ambient-runtime.yml.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export class YamlAmbientStateStore {
  #file; #logger;

  constructor({ dataDir, logger = console }) {
    this.#file = path.join(dataDir, 'system', 'state', 'ambient-runtime.yml');
    this.#logger = logger;
  }

  async load() {
    try {
      const doc = yaml.load(await fs.readFile(this.#file, 'utf8')) || {};
      return { owned: doc.owned || null, handled: doc.handled || {} };
    } catch (err) {
      if (err.code !== 'ENOENT') this.#logger.warn?.('ambient.state.read_failed', { error: err.message });
      return { owned: null, handled: {} };
    }
  }

  async save(state) {
    try {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      const body = yaml.dump(
        { owned: state.owned ?? null, handled: state.handled || {} },
        { indent: 2, lineWidth: -1, noRefs: true },
      );
      await fs.writeFile(this.#file, body, 'utf8');
    } catch (err) {
      this.#logger.warn?.('ambient.state.write_failed', { error: err.message });
    }
  }
}

export default YamlAmbientStateStore;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs --config jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs backend/tests/unit/adapters/ambient/YamlAmbientStateStore.test.mjs
git commit -m "feat(ambient): YamlAmbientStateStore — persist ownership + handled flags"
```

---

### Task B5: `loadArtmodeConfig` returns `schedule`

**Files:**
- Modify: `backend/src/1_adapters/content/art/artmodeConfig.mjs`
- Test: `backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadArtmodeConfig } from '#adapters/content/art/artmodeConfig.mjs';

let dataPath;
beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artmode-'));
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

const write = (body) => fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), body, 'utf8');

describe('loadArtmodeConfig schedule', () => {
  it('returns the schedule array when present', async () => {
    await write('schedule:\n  - days: [mon]\n    start: "07:00"\n    end: "09:00"\n    preset: impressionism\n');
    const cfg = await loadArtmodeConfig(dataPath);
    expect(cfg.schedule).toEqual([{ days: ['mon'], start: '07:00', end: '09:00', preset: 'impressionism' }]);
  });

  it('defaults schedule to [] when absent', async () => {
    await write('presets:\n  gallery-silent: { collection: paintings }\n');
    const cfg = await loadArtmodeConfig(dataPath);
    expect(cfg.schedule).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs --config jest.config.js`
Expected: FAIL — `cfg.schedule` is `undefined`.

- [ ] **Step 3: Implement — add `schedule` to the return**

In `backend/src/1_adapters/content/art/artmodeConfig.mjs`, change the `loadArtmodeConfig` return line:

```javascript
  return { presets: doc.presets || {}, defaults: doc.defaults || {}, frames: doc.frames || {} };
```

to:

```javascript
  return {
    presets: doc.presets || {}, defaults: doc.defaults || {}, frames: doc.frames || {},
    schedule: Array.isArray(doc.schedule) ? doc.schedule : [],
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs --config jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing art adapter tests (no regression)**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/adapters/art --config jest.config.js`
Expected: PASS — existing artmode/art tests unaffected (new key is additive).

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/art/artmodeConfig.mjs backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
git commit -m "feat(ambient): loadArtmodeConfig returns the schedule block"
```

---

### Task B6: `AmbientSchedulerService` (tick + action execution)

**Files:**
- Create: `backend/src/3_applications/ambient/AmbientSchedulerService.mjs`
- Test: `backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs`

The service is driven through `runOnce(date)` so tests can inject a fixed clock and fake ports. `start(intervalMs)` just wraps `runOnce` in a `setInterval`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs
import { AmbientSchedulerService } from '#apps/ambient/AmbientSchedulerService.mjs';

const WIN = {
  key: 'am', name: 'am', days: [1], startMin: 420, endMin: 540,
  preset: 'impressionism', device: 'livingroom-tv',
};

function makeDeps({ idle = true } = {}) {
  const calls = { load: [], powerOff: [] };
  const powerOff = async () => { calls.powerOff.push(true); };
  return {
    calls,
    loadSchedule: async () => ({ windows: [WIN], warnings: [] }),
    tracker: { isPlaying: () => !idle },
    wakeAndLoadService: { execute: async (device, query) => { calls.load.push({ device, query }); } },
    deviceService: { get: () => ({ powerOff }) },
    stateStore: (() => {
      let s = { owned: null, handled: {} };
      return { load: async () => s, save: async (next) => { s = next; }, peek: () => s };
    })(),
    timeZone: 'America/Los_Angeles',
    logger: { info() {}, warn() {}, error() {} },
  };
}

// 2026-06-22T14:00:00Z === 07:00 Mon PDT (window start). 16:00Z === 09:00 (end).
const AT_START = new Date('2026-06-22T14:00:00Z');
const AT_END = new Date('2026-06-22T16:00:00Z');

describe('AmbientSchedulerService', () => {
  it('loads art at start when idle (after the first boot tick passes)', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    // First tick is boot-catch-up: at start, marks handled without acting.
    const boot = await svc.runOnce(AT_START);
    expect(boot.actions[0].type).toBe('skip');
    expect(deps.calls.load).toEqual([]);
  });

  it('loads art at the start edge on a non-first tick when idle', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z')); // first tick, before start → nothing
    await svc.runOnce(AT_START);                          // start edge → load
    expect(deps.calls.load).toEqual([{ device: 'livingroom-tv', query: { display: 'art:impressionism' } }]);
    expect(deps.stateStore.peek().owned).toMatchObject({ key: 'am' });
  });

  it('powers off at end when ambient owns the session and idle', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z')); // first tick
    await svc.runOnce(AT_START);                          // load + own
    await svc.runOnce(AT_END);                            // end → power off
    expect(deps.calls.powerOff).toEqual([true]);
    expect(deps.stateStore.peek().owned).toBeNull();
  });

  it('drops ownership if the load throws (never powers off a TV it did not turn on)', async () => {
    const deps = makeDeps({ idle: true });
    deps.wakeAndLoadService.execute = async () => { throw new Error('load failed'); };
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z'));
    await svc.runOnce(AT_START);
    expect(deps.stateStore.peek().owned).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs --config jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/ambient/AmbientSchedulerService.mjs
// Application service: the 60s ambient tick. Gathers inputs (schedule, local
// time, per-device idle), calls the pure evaluator, executes the returned
// actions via injected ports, and persists next state.
import { resolveNowParts } from '#domains/ambient/timeParts.mjs';
import { evaluateAmbientSchedule } from '#domains/ambient/evaluateAmbientSchedule.mjs';

const DEFAULT_INTERVAL_MS = 60000;

export class AmbientSchedulerService {
  #loadSchedule; #tracker; #wakeAndLoad; #deviceService; #stateStore;
  #timeZone; #logger; #clock; #timer; #firstTick;

  constructor({
    loadSchedule, tracker, wakeAndLoadService, deviceService, stateStore,
    timeZone = 'America/Los_Angeles', logger = console, clock = Date,
  }) {
    this.#loadSchedule = loadSchedule;
    this.#tracker = tracker;
    this.#wakeAndLoad = wakeAndLoadService;
    this.#deviceService = deviceService;
    this.#stateStore = stateStore;
    this.#timeZone = timeZone;
    this.#logger = logger;
    this.#clock = clock;
    this.#timer = null;
    this.#firstTick = true;
  }

  start(intervalMs = DEFAULT_INTERVAL_MS) {
    const tick = () => this.runOnce().catch(
      (e) => this.#logger.error?.('ambient.tick.error', { error: String(e?.message ?? e) }));
    tick();
    this.#timer = setInterval(tick, intervalMs);
    this.#timer.unref?.();
    this.#logger.info?.('ambient.started', { intervalMs });
  }

  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }

  async runOnce(date = new Date(this.#clock.now())) {
    const { windows, warnings } = await this.#loadSchedule();
    warnings.forEach((w) => this.#logger.warn?.('ambient.window.invalid', w));

    const now = resolveNowParts(date, this.#timeZone);
    const state = await this.#stateStore.load();

    const devices = [...new Set(windows.map((w) => w.device))];
    const idleByDevice = {};
    for (const d of devices) idleByDevice[d] = !this.#tracker.isPlaying(d);

    const firstTick = this.#firstTick;
    this.#firstTick = false;

    const { actions, state: nextState } = evaluateAmbientSchedule({
      windows, now, state, idleByDevice, firstTick,
    });

    for (const a of actions) {
      try {
        if (a.type === 'load') {
          this.#logger.info?.('ambient.load', { device: a.device, preset: a.preset });
          await this.#wakeAndLoad.execute(a.device, { display: a.display });
        } else if (a.type === 'powerOff') {
          this.#logger.info?.('ambient.powerOff', { device: a.device });
          const dev = this.#deviceService.get(a.device);
          if (dev) await dev.powerOff();
        } else {
          this.#logger.info?.(`ambient.${a.type}`, a);
        }
      } catch (err) {
        this.#logger.error?.('ambient.action.failed', { type: a.type, device: a.device, error: String(err?.message ?? err) });
        // A failed load must not leave a phantom ownership (else we'd power off a
        // TV we never actually turned on).
        if (a.type === 'load' && nextState.owned && nextState.owned.key === a.key) {
          nextState.owned = null;
        }
      }
    }

    await this.#stateStore.save(nextState);
    return { actions, state: nextState };
  }
}

export default AmbientSchedulerService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs --config jest.config.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/ambient/AmbientSchedulerService.mjs backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs
git commit -m "feat(ambient): AmbientSchedulerService — tick, evaluate, execute, persist"
```

---

### Task B7: Wire the scheduler into `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Add the imports**

Near the scheduling imports (around line 149-154), add:

```javascript
import { AmbientSchedulerService } from '#apps/ambient/AmbientSchedulerService.mjs';
import { YamlAmbientStateStore } from '#adapters/ambient/YamlAmbientStateStore.mjs';
import { normalizeWindows } from '#domains/ambient/normalizeWindows.mjs';
import { loadArtmodeConfig } from '#adapters/content/art/artmodeConfig.mjs';
```

- [ ] **Step 2: Construct + start the scheduler**

Immediately after the existing `if (enableScheduler) { scheduler.start(); } else { ... }` block (around line 2422-2426), add:

```javascript
  // Ambient TV schedule — wakes the living-room TV to a scheduled art preset and
  // powers it off at the window's end, always yielding to active content. Reads
  // the `schedule:` block in artmode.yml; "is a video playing" comes from the
  // ScreenContentTracker. Shares the scheduler enable gate.
  const ambientDataDir = configService.getDataDir();
  const ambientScheduler = new AmbientSchedulerService({
    loadSchedule: async () => normalizeWindows(
      (await loadArtmodeConfig(ambientDataDir, rootLogger)).schedule,
      { defaultDevice: 'livingroom-tv' },
    ),
    tracker: screenContentTracker,
    wakeAndLoadService,
    deviceService: deviceServices.deviceService,
    stateStore: new YamlAmbientStateStore({
      dataDir: ambientDataDir,
      logger: rootLogger.child({ module: 'ambient-state' }),
    }),
    timeZone: 'America/Los_Angeles',
    logger: rootLogger.child({ module: 'ambient-scheduler' }),
  });
  if (enableScheduler) {
    ambientScheduler.start();
  }
```

(`screenContentTracker`, `wakeAndLoadService`, `deviceServices`, and `configService` are all already in scope from earlier in `createApp`. `configService.getDataDir()` is the same accessor the admin scheduler router uses.)

- [ ] **Step 3: Verify the backend boots**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/tests/unit/applications/ambient backend/tests/unit/domains/ambient backend/tests/unit/adapters/ambient --config jest.config.js`
Expected: PASS (all ambient unit suites green).

Then sanity-check the dev server starts without import errors (does not need to stay running):
Run: `ss -tlnp | grep 3112 || (timeout 20 node backend/index.js 2>&1 | grep -iE "ambient.started|listening|error" | head)`
Expected: an `ambient.started` log line (or the server already running on 3112).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(ambient): wire AmbientSchedulerService into app bootstrap"
```

---

### Task B8: Example schedule config + reference doc

**Files:**
- Create: `docs/reference/ambient/tv-schedule.md`
- Data (not in repo — apply to the data volume): add a documented `schedule:` block to `artmode.yml`.

- [ ] **Step 1: Write the reference doc**

```markdown
# Ambient TV Schedule Reference

> Scheduled passive ArtMode windows on the living-room TV: wake to a preset at a
> window's start, power off at its end, always yielding to active content.

## Config — `data/household/config/artmode.yml`

A top-level `schedule:` list. Each window references a preset (or bare collection)
already known to ArtMode:

```yaml
schedule:
  - name: weekday-morning        # optional; used for logs + state key
    days: [mon, tue, wed, thu, fri]
    start: "07:00"               # 24h local time
    end:   "09:00"
    preset: impressionism
  - days: [sun]
    start: "08:00"
    end:   "11:00"
    preset: religious
```

- `days` — `mon|tue|wed|thu|fri|sat|sun`.
- `start` / `end` — `"HH:MM"` local (America/Los_Angeles).
- `preset` — any artmode preset or collection (loaded as `art:<preset>`).
- `device` — optional; defaults to `livingroom-tv`.

## Behavior

- **Start:** if nothing is actively playing, wake the TV and load the preset, and
  record that ambient owns the session. If a video is playing, the window is
  **skipped for the day**.
- **End:** if ambient still owns the session and nothing is playing, **power the TV
  off** (the default `gallery-silent` screensaver returns on next wake). If a video
  is playing (you took over), ambient releases ownership and leaves the TV on.
- **Always passive:** a real video always suppresses ambient; ArtMode scenes and
  the idle screensaver are passive and never block it.

## How "playing" is detected

The living-room screen publishes a `screen.presence` heartbeat with a `playing`
flag (`true` only for non-art content; ArtMode/screensaver report `false`). The
backend `ScreenContentTracker` tracks it per device with a ~15s TTL; the scheduler
reads `isPlaying(deviceId)`.

## State

`data/system/state/ambient-runtime.yml` holds ownership + per-day handled flags.
Ownership persists across restarts; a window whose start passed while the backend
was down is **not** retroactively fired.

---
Implementation: `backend/src/2_domains/ambient/`, `backend/src/3_applications/ambient/`,
`backend/src/3_applications/devices/services/ScreenContentTracker.mjs`.
```

- [ ] **Step 2: Add a starter schedule to the data volume**

Append a commented example to `artmode.yml` in the data volume (per CLAUDE.local.md, write the whole file via `docker exec ... sh -c`, never `sed -i`). First read the current file, then append a `schedule:` block. Example to add (uncommented, adjust presets to taste):

```yaml
schedule:
  - name: weekday-morning
    days: [mon, tue, wed, thu, fri]
    start: "07:00"
    end:   "09:00"
    preset: gallery-silent
```

Run (read, then write back the full file with the block appended):
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/artmode.yml'
# ...append the schedule block, then write the whole file back via a heredoc...
```

- [ ] **Step 3: Commit the doc**

```bash
git add docs/reference/ambient/tv-schedule.md
git commit -m "docs(ambient): TV schedule reference"
```

- [ ] **Step 4: Deploy + verify on prod (kckern-server)**

Per CLAUDE.local.md (deploy at will when the garage is idle and no living-room video is playing):
```bash
docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
# confirm no active video / fitness session first, then:
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Then confirm the tick is alive:
```bash
sudo docker logs --since 2m daylight-station 2>&1 | grep -iE "ambient.started|screen-content.started|ambient\."
```
Expected: `ambient.started` and `screen-content.started`. Reload the living-room kiosk (FKB `loadStartURL`) so it serves the new bundle with the `playing` heartbeat.

---

## Self-Review

**Spec coverage:**
- Turn-on to a preset on schedule → Task B3 (`load`) + B6 (execute via `wakeAndLoadService.execute(device, {display:'art:'+preset})`). ✓
- Skip whole window if active at start → B3 (`skip` reason `active-content`). ✓
- Power off at end + reset-to-default (via power-off) → B3 (`powerOff`) + B6 (`device.powerOff()`); default scene returns on next wake (doc B8). ✓
- End-off only if ambient owns the session → B3 ownership check; B6 drops ownership on load failure. ✓
- Schedule in `artmode.yml` → B5 (`loadArtmodeConfig.schedule`) + B2 (normalize). ✓
- Idle detection via finer `playing` flag → Part A (A1–A6). ✓
- Restart safety / no retroactive actions → B3 `firstTick` boot-catch-up + B6 `#firstTick`. ✓
- Day rollover prune → B3 (handled keyed by `dateStr`, prior days dropped). ✓
- Malformed window → B2 warnings; B6 logs them. ✓
- HA out of scope → no endpoints added. ✓

**Placeholder scan:** No TBD/TODO; every code/test step has full content. The only non-literal step is B8-Step-2 (editing data-volume YAML), which is data, not code, and gives the exact block + method.

**Type consistency:** `loadSchedule()` returns `{windows, warnings}` (B6 deps) matching `normalizeWindows` (B2). Evaluator action/state shapes (B3) match what `AmbientSchedulerService` consumes (B6). `tracker.isPlaying(deviceId)` defined in A1, consumed in B6. `stateStore.load()/save()` defined in B4, consumed in B6. `wakeAndLoadService.execute(deviceId, query)` matches the real signature (`app.mjs` device router usage). `deviceService.get(id).powerOff()` matches the real device interface (device router `/off` route). `screen.presence` message `{type, deviceId, active, playing, ts}` produced in A5, consumed in A1. ✓
