# Fitness Settings Timeout and Sessions Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two Fitness bugs bundled together because both are small, both UX/data-sync, and related but logically separable:

- **Issue G — Settings menu auto-timeout:** The quick-action settings menu currently dismisses itself 400ms after any tap. Extend the dismiss timeout to 5000ms and reset the 5-second countdown on every interaction (pointerdown / touchstart / keydown / value-change) inside the menu. Flash-ack behavior (300ms) is unchanged.
- **Issue H — Session list cache invalidation on delete:** When a session is deleted from the Detail page, the sidebar session list must drop it immediately. `ScreenDataProvider` exposes no invalidation API today, so we add a minimal `useScreenDataRefetch(key)` hook and have the detail widget call it after a successful DELETE.

**Architecture:**

- **G** is self-contained to `FitnessSidebarMenu.jsx`. One constant rename (`ACK_CLOSE_MS` → `MENU_IDLE_CLOSE_MS`) with value `5000`, plus a wrapper around the menu's root `<div>` that captures pointer / key events and restarts the close-timer. `ackSelection()` and the new interaction-reset path both call a shared helper `scheduleIdleClose()`.
- **H** extends `ScreenDataProvider` with a second context (`ScreenDataActionsContext`) that exposes a stable `refetch(key)` function. Reading-context is unchanged. A new `useScreenDataRefetch()` hook gives widgets access. `FitnessSessionDetailWidget.handleDelete` calls `refetch('sessions')` after the DELETE succeeds and before the `restore('right-area')` call.

**Tech Stack:** React 18, Vitest (frontend tests), happy-dom.

**Test runner note:** Frontend tests run under Vitest (not Jest). The `tests/isolated/modules/**/*.test.mjs|jsx` tree is executed by `npm run test:isolated` via `tests/_infrastructure/harnesses/isolated.harness.mjs` (which targets `VITEST_TARGETS = ['modules']`). Each test can also be run directly:

```bash
cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config ./vitest.config.mjs <test-file-path>
```

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | Quick-action settings menu | Extend close-timer to 5s + reset-on-interaction |
| `frontend/src/screen-framework/data/ScreenDataProvider.jsx` | Screen framework data coordinator | Add `refetch(key)` via new actions context + `useScreenDataRefetch()` hook |
| `frontend/src/screen-framework/index.js` | Screen framework public API | Export `useScreenDataRefetch` |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` | Session detail panel | Call `refetch('sessions')` after DELETE succeeds |
| `tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx` | NEW — vitest | 5s timeout + reset-on-interaction |
| `tests/isolated/modules/Fitness/FitnessSessionDetailWidgetDelete.test.jsx` | NEW — vitest | delete → refetch('sessions') → restore('right-area') |
| `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx` | Existing vitest tests | Add cases for `refetch(key)` |

No backend routes, no config keys, no build/deploy changes.

---

# Part G — Settings menu 5s timeout with interaction reset

## Task G1: Add failing test (RED)

**Files:**
- Create: `tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx`

- [ ] **Step 1: Create the test file**

Create `tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    deviceAssignments: [],
    getDeviceAssignment: () => null,
    activeHeartRateParticipants: [],
    plexConfig: { music_playlists: [] },
    suppressDeviceUntilNextReading: null,
    getUserByDevice: () => null,
    getUserByName: () => null,
  }),
}));

vi.mock('@/lib/api.mjs', () => ({
  DaylightMediaPath: (p) => p,
}));

vi.mock(
  '#frontend/modules/Fitness/player/panels/TouchVolumeButtons.jsx',
  () => ({
    TouchVolumeButtons: ({ onSelect }) => (
      <button type="button" data-testid="touch-volume-stub" onClick={() => onSelect?.(3)}>
        volume stub
      </button>
    ),
    snapToTouchLevel: (v) => v,
    linearVolumeFromLevel: (v) => v,
    linearLevelFromVolume: (v) => v,
  })
);

import FitnessSidebarMenu from '#frontend/modules/Fitness/player/panels/FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — idle close timer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  function renderMenu(extraProps = {}) {
    const onClose = vi.fn();
    const utils = render(
      <FitnessSidebarMenu
        onClose={onClose}
        visibility={{ sidebarCam: false, treasureBox: false }}
        onToggleVisibility={() => {}}
        musicEnabled={false}
        onToggleMusic={() => {}}
        showChart
        onToggleChart={() => {}}
        boostLevel={1}
        setBoost={() => {}}
        videoVolume={{ volume: 0.5, setVolume: () => {}, applyToPlayer: () => {} }}
        {...extraProps}
      />
    );
    return { ...utils, onClose };
  }

  it('closes after 5 seconds of idle following a selection', () => {
    const { getByText, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📈 Fitness Chart').closest('.menu-item'));
    vi.advanceTimersByTime(400);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4600);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the 5s timer on subsequent pointer interactions', () => {
    const { getByText, container, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📈 Fitness Chart').closest('.menu-item'));
    vi.advanceTimersByTime(4000);
    const root = container.querySelector('.fitness-sidebar-menu');
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4400);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on keydown inside the menu', () => {
    const { getByText, container, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📈 Fitness Chart').closest('.menu-item'));
    vi.advanceTimersByTime(4000);
    const root = container.querySelector('.fitness-sidebar-menu');
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    vi.advanceTimersByTime(4999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a close when the menu is merely rendered (no interaction)', () => {
    const { onClose } = renderMenu();
    vi.advanceTimersByTime(10000);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config ./vitest.config.mjs tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx
```

Expected: at least the "closes after 5 seconds" test fails (current code closes at 400ms).

- [ ] **Step 3: Commit failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx
git commit -m "test(fitness): failing tests for FitnessSidebarMenu 5s idle close + reset"
```

---

## Task G2: Implement 5-second timeout with interaction reset (GREEN)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`

- [ ] **Step 1: Replace the timing constants (lines 8-10)**

Find:

```js
const ACK_FLASH_MS = 300;
const ACK_CLOSE_MS = 400;
```

Replace with:

```js
const ACK_FLASH_MS = 300;
const MENU_IDLE_CLOSE_MS = 5000;
```

- [ ] **Step 2: Replace `ackSelection` and supporting refs (lines 95-115)**

Replace the entire block with:

```js
  const [flashingId, setFlashingId] = React.useState(null);
  const ackTimerRef = React.useRef(null);
  const closeTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const scheduleIdleClose = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose?.();
    }, MENU_IDLE_CLOSE_MS);
  }, [onClose]);

  const ackSelection = React.useCallback((id) => {
    setFlashingId(id);
    if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
    ackTimerRef.current = setTimeout(() => {
      setFlashingId(null);
      ackTimerRef.current = null;
    }, ACK_FLASH_MS);
    scheduleIdleClose();
  }, [scheduleIdleClose]);

  const rootInteractionHandlers = React.useMemo(() => ({
    onPointerDown: scheduleIdleClose,
    onTouchStart: scheduleIdleClose,
    onKeyDown: scheduleIdleClose,
    onChange: scheduleIdleClose,
  }), [scheduleIdleClose]);
```

- [ ] **Step 3: Spread `rootInteractionHandlers` onto the menu root** — find `<div className={`fitness-sidebar-menu ${isGuestMode ? 'guest-mode' : ''}`}>` (~line 521) and replace with:

```jsx
    <div
      className={`fitness-sidebar-menu ${isGuestMode ? 'guest-mode' : ''}`}
      {...rootInteractionHandlers}
    >
```

- [ ] **Step 4: Run G tests** — expect 4 passing.

```bash
cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config ./vitest.config.mjs tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "fix(fitness): extend settings menu idle close to 5s with reset-on-interaction"
```

---

# Part H — Session list cache invalidation on delete

## Task H1: Add failing tests for `refetch(key)` (RED)

**Files:**
- Modify: `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`

- [ ] **Step 1: Append new test cases to the existing describe block**

```jsx
  it('exposes useScreenDataRefetch() which re-fetches a single key', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ temp: 70 + callCount }),
      });
    });

    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');

    const { result } = renderHook(
      () => ({ data: useScreenData('weather'), refetch: useScreenDataRefetch() }),
      { wrapper: wrapper(sources) }
    );

    await waitFor(() => { expect(result.current.data).toEqual({ temp: 71 }); });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.refetch('weather'); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await waitFor(() => { expect(result.current.data).toEqual({ temp: 72 }); });
  });

  it('refetch is a no-op for an unknown key', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');
    const { result } = renderHook(() => useScreenDataRefetch(), { wrapper: wrapper(sources) });
    await waitFor(() => { expect(mockFetch).toHaveBeenCalledTimes(1); });
    await act(async () => { await result.current('unknown-key'); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetch identity is stable across store updates', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ temp: 72 }) });
    const sources = { weather: { source: '/api/v1/home/weather', refresh: 0 } };
    const { useScreenDataRefetch } = await import('./ScreenDataProvider.jsx');
    const { result } = renderHook(
      () => ({ data: useScreenData('weather'), refetch: useScreenDataRefetch() }),
      { wrapper: wrapper(sources) }
    );
    const firstRefetch = result.current.refetch;
    await waitFor(() => { expect(result.current.data).toEqual({ temp: 72 }); });
    expect(result.current.refetch).toBe(firstRefetch);
  });
```

- [ ] **Step 2: Run — expect 3 failures** (`useScreenDataRefetch` undefined)

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/screen-framework/data/ScreenDataProvider.test.jsx
git commit -m "test(screen-framework): failing tests for useScreenDataRefetch"
```

---

## Task H2: Implement `refetch(key)` + `useScreenDataRefetch()` (GREEN)

**Files:**
- Modify: `frontend/src/screen-framework/data/ScreenDataProvider.jsx`
- Modify: `frontend/src/screen-framework/index.js`

- [ ] **Step 1: Replace `ScreenDataProvider.jsx` with**:

```jsx
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenDataProvider' });
  return _logger;
}

const ScreenDataContext = createContext({});
const ScreenDataActionsContext = createContext({ refetch: async () => {} });

/**
 * ScreenDataProvider - Fetches declared data sources once, refreshes on interval,
 * distributes via context. Exposes imperative `refetch(key)` via
 * useScreenDataRefetch() for cache invalidation after mutations.
 */
export function ScreenDataProvider({ sources = {}, children }) {
  const [store, setStore] = useState({});
  const intervalsRef = useRef([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const fetchSource = useCallback(async (key, url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setStore(prev => ({ ...prev, [key]: data }));
    } catch (err) {
      logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
    }
  }, []);

  useEffect(() => {
    const entries = Object.entries(sources);
    if (entries.length === 0) return;
    entries.forEach(([key, { source }]) => fetchSource(key, source));
    const ids = entries
      .filter(([, { refresh }]) => refresh)
      .map(([key, { source, refresh }]) =>
        setInterval(() => fetchSource(key, source), refresh * 1000)
      );
    intervalsRef.current = ids;
    return () => ids.forEach(clearInterval);
  }, [sources, fetchSource]);

  const refetch = useCallback(async (key) => {
    const entry = sourcesRef.current?.[key];
    if (!entry?.source) return;
    await fetchSource(key, entry.source);
  }, [fetchSource]);

  const actions = useMemo(() => ({ refetch }), [refetch]);

  return (
    <ScreenDataContext.Provider value={store}>
      <ScreenDataActionsContext.Provider value={actions}>
        {children}
      </ScreenDataActionsContext.Provider>
    </ScreenDataContext.Provider>
  );
}

export function useScreenData(key) {
  const store = useContext(ScreenDataContext);
  return store[key] ?? null;
}

export function useScreenDataRefetch() {
  const { refetch } = useContext(ScreenDataActionsContext);
  return refetch;
}
```

- [ ] **Step 2: Add to `frontend/src/screen-framework/index.js`** — replace the existing data export with:

```js
export { ScreenDataProvider, useScreenData, useScreenDataRefetch } from './data/ScreenDataProvider.jsx';
```

- [ ] **Step 3: Run provider tests — expect green**

```bash
cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config ./vitest.config.mjs frontend/src/screen-framework/data/ScreenDataProvider.test.jsx
```

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/screen-framework/data/ScreenDataProvider.jsx \
        frontend/src/screen-framework/index.js
git commit -m "feat(screen-framework): add useScreenDataRefetch hook for cache invalidation"
```

---

## Task H3: Add failing test for delete-then-refetch (RED)

**Files:**
- Create: `tests/isolated/modules/Fitness/FitnessSessionDetailWidgetDelete.test.jsx`

- [ ] **Step 1: Create the test file**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';

const mockRestore = vi.fn();
const mockRefetch = vi.fn().mockResolvedValue(undefined);

vi.mock('@/screen-framework/providers/ScreenProvider.jsx', () => ({
  useScreen: () => ({ restore: mockRestore, replace: () => () => {} }),
}));

vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({
  useScreenDataRefetch: () => mockRefetch,
  useScreenData: () => null,
}));

vi.mock('@/screen-framework/widgets/registry.js', () => ({
  getWidgetRegistry: () => ({ get: () => null }),
}));

vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ onNavigate: null }),
}));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ openVoiceMemoCapture: null }),
}));

vi.mock('#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/RouteMap.jsx', () => ({ default: () => null }));
vi.mock('#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx', () => ({ default: () => null }));
vi.mock('#frontend/modules/Fitness/widgets/_shared/SportIcon.jsx', () => ({ default: () => null, formatSportType: () => '' }));

import FitnessSessionDetailWidget from '#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx';

describe('FitnessSessionDetailWidget — delete flow', () => {
  beforeEach(() => {
    mockRestore.mockClear();
    mockRefetch.mockClear();
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sessionId: '20260422193014',
          session: { duration_seconds: 600 },
          summary: { media: [] },
          participants: {},
        }),
      });
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('invalidates the sessions cache after a successful DELETE, then restores right-area', async () => {
    const { container } = render(<FitnessSessionDetailWidget sessionId="20260422193014" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/fitness/sessions/20260422193014');
    });

    const deleteBtn = Array.from(container.querySelectorAll('button')).find((b) => /delete/i.test(b.textContent || ''));
    expect(deleteBtn).toBeTruthy();

    await act(async () => { deleteBtn.click(); });

    await waitFor(() => { expect(mockRefetch).toHaveBeenCalledWith('sessions'); });
    expect(mockRestore).toHaveBeenCalledWith('right-area');
    const refetchOrder = mockRefetch.mock.invocationCallOrder[0];
    const restoreOrder = mockRestore.mock.invocationCallOrder[0];
    expect(refetchOrder).toBeLessThan(restoreOrder);
  });

  it('does NOT invalidate the cache if DELETE fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'DELETE') return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sessionId: '20260422193014',
          session: { duration_seconds: 600 },
          summary: { media: [] },
          participants: {},
        }),
      });
    });

    const { container } = render(<FitnessSessionDetailWidget sessionId="20260422193014" />);
    await waitFor(() => { expect(global.fetch).toHaveBeenCalled(); });
    const deleteBtn = Array.from(container.querySelectorAll('button')).find((b) => /delete/i.test(b.textContent || ''));
    if (!deleteBtn) return;
    await act(async () => { deleteBtn.click(); });
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
```

> **Note on selector:** The test finds the delete button by text matching `/delete/i`. Confirm `FitnessSessionDetailWidget.jsx` renders such a button before running. If the widget uses an icon-only button, add `data-testid="delete-session"` to the implementation step and update the selector.

- [ ] **Step 2: Run — expect first test to FAIL**

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/modules/Fitness/FitnessSessionDetailWidgetDelete.test.jsx
git commit -m "test(fitness): failing test for session-list invalidation on delete"
```

---

## Task H4: Implement refetch-on-delete (GREEN)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx`

- [ ] **Step 1: Add the import**

After the existing `import { useScreen } from '@/screen-framework/providers/ScreenProvider.jsx';`, add:

```js
import { useScreenDataRefetch } from '@/screen-framework/data/ScreenDataProvider.jsx';
```

- [ ] **Step 2: Grab the refetch function** (after `const { restore } = useScreen();`):

```js
  const refetchScreenData = useScreenDataRefetch();
```

- [ ] **Step 3: Call `refetchScreenData('sessions')` after successful DELETE** — replace `handleDelete`:

```js
  const handleDelete = useCallback(async () => {
    if (!sessionId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/fitness/sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      await refetchScreenData?.('sessions');
      restore('right-area');
    } catch (err) {
      setDeleting(false);
      setError(`Delete failed: ${err.message}`);
    }
  }, [sessionId, deleting, restore, refetchScreenData]);
```

- [ ] **Step 4: Run tests — both should PASS**

```bash
cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config ./vitest.config.mjs tests/isolated/modules/Fitness/FitnessSessionDetailWidgetDelete.test.jsx
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "fix(fitness): refresh sessions list after deleting a session from detail"
```

---

## Task 5 (shared): Final sweep + manual smoke

- [ ] **Step 1: Full isolated suite**

```bash
cd /opt/Code/DaylightStation && npm run test:isolated -- --only=modules
```

Expected: green.

- [ ] **Step 2: Manual smoke**
  - **G:** Open settings sidebar. Tap one toggle, wait 3s — still open. Tap another — timer resets. Wait 5s without interaction — auto-closes.
  - **H:** Open a session detail. Click Delete — detail closes, session disappears from sidebar list within ~1s.

---

## Done

- **FitnessSidebarMenu:** `MENU_IDLE_CLOSE_MS = 5000` (renamed from `ACK_CLOSE_MS = 400`); new `scheduleIdleClose()` shared by both `ackSelection` and root-level interaction listener; flash-ack (300ms) preserved.
- **ScreenDataProvider:** Hoisted `fetchSource` to a `useCallback`, added `sourcesRef`, published stable `refetch(key)` via new `ScreenDataActionsContext`. New `useScreenDataRefetch()` hook in framework barrel.
- **FitnessSessionDetailWidget:** On DELETE success, calls `refetchScreenData('sessions')` before `restore('right-area')`.
- **Tests:** 4 menu cases + 3 provider cases + 2 delete cases.
- **Backend:** No changes.
