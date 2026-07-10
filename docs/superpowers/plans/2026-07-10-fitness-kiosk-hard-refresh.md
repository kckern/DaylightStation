# Fitness Kiosk Hard Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the garage fitness kiosk (touchscreen, no keyboard) a cache-bypassing hard-refresh trigger that stays reachable while a session is active and while video is playing.

**Architecture:** A shared `hardReload()` helper (log → clear Cache API → revalidate `index.html` via `fetch(cache:'reload')` → `location.reload(true)`) is wired into three triggers: a new "🔄 Reload App" item in the player's Settings menu (`FitnessSidebarMenu.jsx`), a 2-second long-press on the sidebar footer's avatar card (`SidebarFooter.jsx`, via a new `useLongPress` hook), and the existing no-session 🔄 footer card (upgraded from plain `location.reload()`). Spec: `docs/superpowers/specs/2026-07-10-fitness-kiosk-hard-refresh-design.md`.

**Tech Stack:** React (frontend/src, Vite), vitest 4 (config at repo root `vitest.config.mjs`, run from repo root), @testing-library/react.

## Global Constraints

- Work directly on `main` — commit each task there; no feature branch.
- Do NOT edit anything under `frontend/src/lib/Player/` or `frontend/src/modules/Player/` (other agents own them). This feature only touches `frontend/src/modules/Fitness/`.
- Fitness kiosk convention: interactive controls use `onPointerDown`, not `onClick` (see comment at `frontend/src/Apps/FitnessApp.jsx:43`). The long-press hook necessarily acts on pointer-up for taps — that exception is by design (release distinguishes tap from hold).
- Run all vitest commands from the repo root (`/opt/Code/DaylightStation`); the root `vitest.config.mjs` supplies aliases (`@` → `frontend/src`) and the frontend test environment. Always pass explicit test file paths (avoids picking up worktree copies).
- Deploy rules (this host is prod): building and deploying is allowed WITHOUT asking, but NEVER deploy while the garage is in use. The deploy task below includes the exact gate-check commands; both gates must be clear.
- Cite log event name exactly: `fitness-hard-reload` with a `source` field of `settings-menu`, `footer-longpress`, or `footer-tap`.

---

### Task 1: `hardReload()` helper

**Files:**
- Create: `frontend/src/modules/Fitness/lib/hardReload.js`
- Test: `frontend/src/modules/Fitness/lib/hardReload.test.js`

**Interfaces:**
- Consumes: `getLogger` from `@/lib/logging/Logger.js` (existing; `getLogger().info(event, payload)`).
- Produces: `export default async function hardReload(source, deps = {})` — `source` is a string tag logged with the event; `deps` is a test-only injection point `{ logger, cacheStorage, fetchFn, loc }`. Production callers pass only `source`, e.g. `hardReload('settings-menu')`. Later tasks import it as `import hardReload from '<relative path>/lib/hardReload.js'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/hardReload.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import hardReload from './hardReload.js';

// Every dep records its invocation into `calls` so step ORDER is assertable.
function makeDeps() {
  const calls = [];
  const deps = {
    logger: { info: vi.fn(() => calls.push('log')) },
    cacheStorage: {
      keys: vi.fn(async () => { calls.push('cache-keys'); return ['bundle-cache', 'img-cache']; }),
      delete: vi.fn(async (key) => { calls.push(`cache-delete:${key}`); return true; })
    },
    fetchFn: vi.fn(async () => { calls.push('fetch'); return { ok: true }; }),
    loc: { pathname: '/fitness', reload: vi.fn(() => calls.push('reload')) }
  };
  return { calls, deps };
}

describe('hardReload', () => {
  it('runs log → clear caches → revalidate fetch → forced reload, in order', async () => {
    const { calls, deps } = makeDeps();
    await hardReload('settings-menu', deps);
    expect(calls).toEqual([
      'log', 'cache-keys', 'cache-delete:bundle-cache', 'cache-delete:img-cache', 'fetch', 'reload'
    ]);
    expect(deps.logger.info).toHaveBeenCalledWith('fitness-hard-reload', { source: 'settings-menu' });
    expect(deps.fetchFn).toHaveBeenCalledWith('/fitness', { cache: 'reload' });
    // Firefox honors the non-standard forceGet flag; other browsers ignore it.
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the Cache API throws', async () => {
    const { deps } = makeDeps();
    deps.cacheStorage.keys = vi.fn(async () => { throw new Error('cache broken'); });
    await hardReload('footer-tap', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the revalidation fetch rejects', async () => {
    const { deps } = makeDeps();
    deps.fetchFn = vi.fn(async () => { throw new Error('offline'); });
    await hardReload('footer-longpress', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when no Cache API exists (cacheStorage null)', async () => {
    const { deps } = makeDeps();
    deps.cacheStorage = null;
    await hardReload('footer-tap', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the logger throws', async () => {
    const { deps } = makeDeps();
    deps.logger = { info: vi.fn(() => { throw new Error('log sink gone'); }) };
    await hardReload('settings-menu', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `/opt/Code/DaylightStation`):
```bash
npx vitest run frontend/src/modules/Fitness/lib/hardReload.test.js
```
Expected: FAIL — cannot resolve `./hardReload.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/hardReload.js`:

```js
import getLogger from '@/lib/logging/Logger.js';

/**
 * Cache-bypassing page reload — the touchable Ctrl+Shift+R equivalent for the
 * garage kiosk. Every step is best-effort: the final reload always runs even
 * if cache clearing or the revalidation fetch fails. Safe mid-session: the
 * play queue is mirrored to sessionStorage and restored on mount.
 *
 * @param {string} source - trigger tag for the session log
 *   ('settings-menu' | 'footer-longpress' | 'footer-tap')
 * @param {object} deps - test-only injection of { logger, cacheStorage, fetchFn, loc }
 */
export default async function hardReload(source = 'unknown', deps = {}) {
  const {
    logger = getLogger(),
    cacheStorage = (typeof caches !== 'undefined' ? caches : null),
    fetchFn = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
    loc = window.location
  } = deps;

  try {
    logger.info('fitness-hard-reload', { source });
  } catch (_) { /* logging must never block the reload */ }

  if (cacheStorage) {
    try {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map((key) => cacheStorage.delete(key)));
    } catch (_) { /* Cache API absent or broken — proceed */ }
  }

  if (fetchFn) {
    try {
      // Force HTTP-cache revalidation of index.html — the file that points at
      // the hashed bundles — so the reload below picks up a fresh deploy.
      await fetchFn(loc.pathname, { cache: 'reload' });
    } catch (_) { /* offline or fetch failure — reload anyway */ }
  }

  // Non-standard forceGet flag: honored by Firefox (the kiosk browser),
  // harmlessly ignored elsewhere.
  loc.reload(true);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Fitness/lib/hardReload.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/hardReload.js frontend/src/modules/Fitness/lib/hardReload.test.js
git commit -m "feat(fitness): add hardReload cache-bypassing reload helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `useLongPress` hook

**Files:**
- Create: `frontend/src/modules/Fitness/lib/useLongPress.js`
- Test: `frontend/src/modules/Fitness/lib/useLongPress.test.jsx`

**Interfaces:**
- Consumes: nothing project-specific (React only).
- Produces: `export default function useLongPress({ onLongPress, onTap, holdMs = 2000 })` returning `{ holding, handlers }` where `holding` is a boolean (true while a press is pending) and `handlers` is `{ onPointerDown, onPointerUp, onPointerLeave, onPointerCancel }` to spread onto an element. Task 4 consumes exactly this shape. Semantics: release before `holdMs` → `onTap(event)`; held for `holdMs` → `onLongPress(event)` fires once and the subsequent release does NOT fire `onTap`; leave/cancel aborts with neither callback.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/useLongPress.test.jsx`:

```jsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useLongPress from './useLongPress.js';

describe('useLongPress', () => {
  let onLongPress;
  let onTap;

  beforeEach(() => {
    vi.useFakeTimers();
    onLongPress = vi.fn();
    onTap = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (holdMs = 2000) =>
    renderHook(() => useLongPress({ onLongPress, onTap, holdMs }));

  it('fires onLongPress after holding for holdMs, and not onTap', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // Releasing after the long-press fired must not also register a tap.
    act(() => { result.current.handlers.onPointerUp({}); });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('fires onTap (not onLongPress) when released before holdMs', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.handlers.onPointerUp({}); });
    expect(onTap).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels with neither callback when the pointer leaves mid-hold', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.handlers.onPointerLeave({}); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('exposes holding=true only while a press is pending', () => {
    const { result } = setup();
    expect(result.current.holding).toBe(false);
    act(() => { result.current.handlers.onPointerDown({}); });
    expect(result.current.holding).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.holding).toBe(false); // fired → no longer pending
  });

  it('clears holding on pointer cancel', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { result.current.handlers.onPointerCancel({}); });
    expect(result.current.holding).toBe(false);
  });

  it('does not fire onLongPress after unmount', () => {
    const { result, unmount } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/lib/useLongPress.test.jsx
```
Expected: FAIL — cannot resolve `./useLongPress.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/useLongPress.js`:

```js
import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Distinguish a tap from a deliberate hold on one element.
 * - Release before holdMs → onTap(event)
 * - Held for holdMs      → onLongPress(event); the release does NOT also tap
 * - Pointer leave/cancel  → neither
 * The hold-then-fire pattern is its own confirmation: an accidental brush
 * can't trigger onLongPress. `holding` drives the visual hold indicator.
 */
export default function useLongPress({ onLongPress, onTap, holdMs = 2000 }) {
  const timerRef = useRef(null);
  const [holding, setHolding] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  const onPointerDown = useCallback((event) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onLongPress?.(event);
    }, holdMs);
  }, [onLongPress, holdMs]);

  const onPointerUp = useCallback((event) => {
    // A pending timer means the hold threshold wasn't reached — it's a tap.
    const wasPending = timerRef.current != null;
    clearTimer();
    if (wasPending) onTap?.(event);
  }, [clearTimer, onTap]);

  const onPointerLeave = useCallback(() => { clearTimer(); }, [clearTimer]);
  const onPointerCancel = useCallback(() => { clearTimer(); }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    holding,
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Fitness/lib/useLongPress.test.jsx
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/useLongPress.js frontend/src/modules/Fitness/lib/useLongPress.test.jsx
git commit -m "feat(fitness): add useLongPress tap-vs-hold hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: "Reload App" item in the player Settings menu

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (dead `handleReloadPage` is at ~line 173; render insertion point is the feedback `menu-section` ending ~line 349)
- Test: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx`

**Interfaces:**
- Consumes: `hardReload(source)` from Task 1 (`import hardReload from '../../lib/hardReload.js';` — `panels/` is two levels below `modules/Fitness/`).
- Produces: a rendered `🔄 Reload App` button in the settings mode of the menu, firing `hardReload('settings-menu')` on pointer down. No API consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hardReloadSpy = vi.fn();
vi.mock('../../lib/hardReload.js', () => ({
  __esModule: true,
  default: (...args) => hardReloadSpy(...args)
}));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({}),
  FITNESS_DEBUG: false
}));

// FeedbackOverlay drags in recording infrastructure irrelevant to this test.
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({
  __esModule: true,
  default: () => null
}));

import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — Reload App', () => {
  beforeEach(() => { hardReloadSpy.mockClear(); });

  const renderMenu = () => render(
    <FitnessSidebarMenu
      onClose={vi.fn()}
      visibility={{}}
      onToggleVisibility={vi.fn()}
      onToggleMusic={vi.fn()}
      appMode="menu"
    />
  );

  it('renders a Reload App item in settings mode', () => {
    renderMenu();
    expect(screen.getByText(/Reload App/)).toBeInTheDocument();
  });

  it('fires hardReload with the settings-menu source on pointer down', () => {
    renderMenu();
    fireEvent.pointerDown(screen.getByText(/Reload App/));
    expect(hardReloadSpy).toHaveBeenCalledTimes(1);
    expect(hardReloadSpy).toHaveBeenCalledWith('settings-menu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx
```
Expected: FAIL — `getByText(/Reload App/)` finds no element (both tests fail; the component renders but has no such item).

- [ ] **Step 3: Wire the dead handler and render the menu item**

In `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`:

3a. Add the import after the existing `FeedbackOverlay` import (line 8):

```js
import hardReload from '../../lib/hardReload.js';
```

3b. Replace the dead `handleReloadPage` (lines 173–177):

```js
// OLD
  const handleReloadPage = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

// NEW
  const handleReloadPage = () => {
    hardReload('settings-menu');
  };
```

3c. In `renderSettings()`, insert a Maintenance section between the feedback section (`</div>` closing the section that contains `FeedbackOverlay`, ~line 349) and the `{activeSessionId && onEndSession && (` block (~line 351):

```jsx
      <div className="menu-section">
        <h4>Maintenance</h4>
        <button
          type="button"
          className="menu-item"
          onPointerDown={handleReloadPage}
          aria-label="Hard-reload the app (bypasses cache)"
          title="Hard-reload the app — picks up new versions"
        >
          🔄 Reload App
        </button>
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx
git commit -m "feat(fitness): add Reload App hard-refresh item to player settings menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Footer long-press hard reload + upgrade the no-session refresh card

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/SidebarFooter.jsx` (container handler at lines 339–347; no-session 🔄 card at lines 414–426)
- Modify: `frontend/src/modules/Fitness/nav/SidebarFooter.scss` (add hold-indicator styles)

**Interfaces:**
- Consumes: `useLongPress` from Task 2 (`{ holding, handlers }` shape) and `hardReload` from Task 1 — both via `import ... from '../lib/...'` (`nav/` is one level below `modules/Fitness/`).
- Produces: behavior only; nothing consumed downstream. Note the deliberate interaction change: the container's tap action (`handleContainerClick`) moves from pointer-DOWN to pointer-UP (short release), because release timing is what distinguishes tap from hold.

- [ ] **Step 1: Wire the long-press into the device container**

In `frontend/src/modules/Fitness/nav/SidebarFooter.jsx`:

1a. Add imports after the existing `getLogger` import (line 7):

```js
import useLongPress from '../lib/useLongPress.js';
import hardReload from '../lib/hardReload.js';
```

1b. After the `handleContainerClick` definition (ends line 337), add:

```js
  // Long-press (2s) anywhere on the footer card hard-reloads the kiosk — the
  // only touch path to a cache-bypassing refresh once an avatar has replaced
  // the 🔄 card. A short tap falls through to the normal click behavior.
  const { holding, handlers: longPressHandlers } = useLongPress({
    onTap: handleContainerClick,
    onLongPress: () => hardReload('footer-longpress'),
    holdMs: 2000
  });
```

1c. Replace the container element's opening tag (lines 341–347):

```jsx
// OLD
      <div 
        className="device-container" 
        onPointerDown={handleContainerClick}
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
      >

// NEW
      <div
        className={`device-container${holding ? ' is-hold-reloading' : ''}`}
        {...longPressHandlers}
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
      >
```

- [ ] **Step 2: Upgrade the no-session refresh card to hardReload**

Same file, the `sortedDevices.length === 0` card (line 417):

```jsx
// OLD
          onPointerDown={() => window.location.reload()}

// NEW
          onPointerDown={() => hardReload('footer-tap')}
```

- [ ] **Step 3: Add the hold indicator styles**

In `frontend/src/modules/Fitness/nav/SidebarFooter.scss`, append at the end of the `.sidebar-footer` block (inside it, after the existing `.device-card` rules):

```scss
  // Long-press hard-reload: a 🔄 overlay fades/scales in over the 2s hold so
  // the hold is legible; releasing early removes it (class comes off).
  .device-container.is-hold-reloading::after {
    content: '🔄';
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    font-size: 1.5rem;
    pointer-events: none;
    animation: hard-reload-hold 2s linear forwards;
  }

  @keyframes hard-reload-hold {
    from { opacity: 0.15; transform: scale(0.6); }
    to { opacity: 1; transform: scale(1); }
  }
```

- [ ] **Step 4: Run the feature's full test suite (regression gate)**

```bash
npx vitest run frontend/src/modules/Fitness/lib/hardReload.test.js frontend/src/modules/Fitness/lib/useLongPress.test.jsx frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.reload.test.jsx
```
Expected: PASS (13 tests across 3 files).

- [ ] **Step 5: Verify the frontend still builds**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5
```
Expected: `✓ built in …` with no errors (warnings about chunk size are pre-existing and fine). Then `cd /opt/Code/DaylightStation`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/nav/SidebarFooter.jsx frontend/src/modules/Fitness/nav/SidebarFooter.scss
git commit -m "feat(fitness): long-press footer avatar to hard-reload; harden refresh card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Build, deploy, reload the garage kiosk, verify

**Files:** none (operational task).

**Interfaces:**
- Consumes: the committed feature from Tasks 1–4 on `main`.
- Produces: the new bundle live on the garage kiosk.

- [ ] **Step 1: Check the deploy gates (BOTH must be clear)**

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Clear means: first command prints `0`; second shows no `"videoState":"playing"` (paused/null OK), `"sessionActive":false`, `"rosterSize":0`. **If either gate is active, WAIT and re-check every few minutes (or ask the user) — do not deploy over a workout or live video.**

- [ ] **Step 2: Build the image**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```
Expected: build succeeds (ends with the image tag export). Takes several minutes (vite build runs inside).

- [ ] **Step 3: Re-check gate, then swap the container**

Re-run Step 1's gate check (the build took minutes — the garage may have come into use). If clear:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```
Expected: new container id printed; `sudo docker ps | grep daylight-station` shows it Up.

- [ ] **Step 4: Verify the container serves the new build**

```bash
sudo docker exec daylight-station sh -c 'cat /build.txt'
```
Expected: `COMMIT_HASH` matches `git rev-parse --short HEAD` and `BUILD_TIME` is from Step 2.

- [ ] **Step 5: Hard-reload the garage kiosk Firefox**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```
Expected: exits 0. The `XGetWindowProperty[_NET_WM_DESKTOP] failed` warning is benign.

- [ ] **Step 6: Confirm the fitness app remounted cleanly**

```bash
sudo docker logs --since 90s daylight-station 2>&1 | grep -E 'fitness-app-mount|fitness-config-loaded' | tail -4
```
Expected: a fresh `fitness-app-mount` and `fitness-config-loaded` from the kiosk reload. (Physical long-press and Settings-menu verification need a human at the garage touchscreen — tell the user the feature is live and how to check: hold the bottom-left avatar ~2s → 🔄 overlay fills → page hard-reloads; or player sidebar → Settings → 🔄 Reload App. A successful use logs `fitness-hard-reload` with its `source` in the session JSONL under `media/logs/fitness/`.)

---

## Self-Review Notes

- Spec coverage: helper (§1 → Task 1), settings item (§2 → Task 3), long-press + card upgrade (§3 → Tasks 2+4), error handling (Task 1 tests), testing (Tasks 1–4 steps; manual verify → Task 5). No gaps.
- Interaction change (tap moves to pointer-up on the footer container) is called out in Task 4 — it is required to disambiguate tap from hold and slightly trades the app's pointer-down latency convention for the long-press affordance on this one element.
- Type consistency: `hardReload(source, deps)` and `useLongPress({ onLongPress, onTap, holdMs })` → `{ holding, handlers }` used identically in Tasks 3–4.
