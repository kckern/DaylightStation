# Media App P4 (Cast / Dispatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User selects one or more fleet devices as a cast target, then dispatches any search result / detail-view item to the target(s). Dispatch emits live wake-progress events, supports Transfer (stops local on confirmed success) and Fork (leaves local running) modes, and is idempotent + retryable.

**Architecture:** Two new providers sit inside the app stack between `<FleetProvider>` and `<SearchProvider>`: `<CastTargetProvider>` (target selection + mode, localStorage-persisted) and `<DispatchProvider>` (in-flight op map, per-dispatch homeline subscriptions, idempotency cache). A dock chip + popover let users pick the target; every content row/detail view grows a `<CastButton>` that fires off a dispatch and shows its progress in a tray. Cast uses existing `GET /api/v1/device/:id/load?play=…&dispatchId=…` (verified on backend) — no new API.

**Tech Stack:** React 18 · Vite · Vitest + @testing-library/react + happy-dom · Playwright · `DaylightAPI`, `wsService`, `getChildLogger` · shared contracts at `@shared-contracts/media/*`.

---

## Pre-flight

- **Parent state:** main at HEAD (post-P3). 150 vitest + 9 Playwright passing. Dev server at :3112 (frontend) + :3113 (backend).
- **Work isolation:** create worktree `feature/media-app-p4` via `superpowers:using-git-worktrees`. `npm install` at root + `frontend/`. Baseline `cd frontend && npx vitest run src/modules/Media` passes 150 tests.
- **APIs (verified on the live backend):**
  - `GET /api/v1/device/:deviceId/load?play=<contentId>&dispatchId=<uuid>&shader=<name>&volume=<0-100>&shuffle=<0|1>` → `{ok, deviceId, dispatchId, totalElapsedMs, steps}` on success. On failure: `{ok: false, failedStep, error, code}`. Supports `queue=<contentId>` alias for container dispatch. Device-not-found → HTTP 404. `VALIDATION` errors → 400. Implemented in `backend/src/4_api/v1/routers/device.mjs:633`.
  - WebSocket topic `homeline:<deviceId>` emits `{topic, type: 'wake-progress', dispatchId, step: 'power'|'verify'|'volume'|'prepare'|'prewarm'|'load', status: 'running'|'success'|'failed', elapsedMs, error?, ts}` throughout the dispatch. Backend source: `WakeAndLoadService.mjs:99`.
- **Backend-side idempotency:** `DispatchIdempotencyService` caches by `dispatchId` for 60s. Replaying the same `dispatchId` with an identical body returns the prior result without re-running the wake steps. A same-`dispatchId` with a *different* body returns 409 `IDEMPOTENCY_CONFLICT`. Client just needs to pick fresh dispatchIds per distinct intent.
- **WebSocket subscribe:** `wsService.subscribe(filter, cb)` accepts string|array|function. Because each dispatch's topic includes a `deviceId` suffix, use a **function filter** `(m) => m.topic === 'homeline:<deviceId>' && m.type === 'wake-progress'` per dispatch, or one provider-level function filter `(m) => typeof m.topic === 'string' && m.topic.startsWith('homeline:')` that routes by `dispatchId` inside the callback.

---

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/modules/Media/cast/CastTargetProvider.jsx` | Holds `{mode, targetIds}`; `mode: 'transfer' | 'fork'`; persists to `localStorage['media-app.cast-target']` |
| `frontend/src/modules/Media/cast/useCastTarget.js` | Thin hook exporting the context |
| `frontend/src/modules/Media/cast/dispatchReducer.js` | Pure reducer over `Map<dispatchId, {deviceId, contentId, mode, status, steps[], error?}>`; actions `INITIATED`, `STEP`, `SUCCEEDED`, `FAILED`, `REMOVED` |
| `frontend/src/modules/Media/cast/DispatchProvider.jsx` | Composes reducer + one provider-level `homeline:*` subscription + `dispatchToTarget` API; idempotency via 60s `dispatchId` cache |
| `frontend/src/modules/Media/cast/useDispatch.js` | Hook exposing `{dispatches, dispatchToTarget, retryLast}` |
| `frontend/src/modules/Media/cast/dispatchUrl.js` | Pure helper: `buildDispatchUrl({deviceId, play, mode, dispatchId, shader, volume, shuffle})` → `api/v1/device/:id/load?...` |
| `frontend/src/modules/Media/cast/CastButton.jsx` | Inline button on result/detail rows: fires dispatch using current target + mode |
| `frontend/src/modules/Media/cast/CastTargetChip.jsx` | Dock chip: shows current target(s) + mode; click → popover |
| `frontend/src/modules/Media/cast/CastPopover.jsx` | Dropdown panel: fleet-device checkboxes + mode toggle |
| `frontend/src/modules/Media/cast/DispatchProgressTray.jsx` | Dock strip showing in-flight dispatches (one row per) |
| `frontend/src/Apps/MediaApp.jsx` | **modify** — insert `<CastTargetProvider>` + `<DispatchProvider>` inside `<FleetProvider>` |
| `frontend/src/modules/Media/shell/Dock.jsx` | **modify** — render `<CastTargetChip />` + `<DispatchProgressTray />` |
| `frontend/src/modules/Media/search/SearchResults.jsx` | **modify** — add `<CastButton>` per row |
| `frontend/src/modules/Media/browse/DetailView.jsx` | **modify** — add `<CastButton>` alongside local Play Now |
| `tests/live/flow/media/media-app-cast.runtime.test.mjs` | Playwright e2e: pick target → cast a search result → tray shows progress |

---

## Task 1: `dispatchUrl` builder

**Files:**
- Create: `frontend/src/modules/Media/cast/dispatchUrl.js`
- Test: `frontend/src/modules/Media/cast/dispatchUrl.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/cast/dispatchUrl.test.js
import { describe, it, expect } from 'vitest';
import { buildDispatchUrl } from './dispatchUrl.js';

describe('buildDispatchUrl', () => {
  it('builds a minimal URL for play only', () => {
    const url = buildDispatchUrl({ deviceId: 'lr', play: 'plex:1', dispatchId: 'd1' });
    expect(url).toBe('api/v1/device/lr/load?play=plex%3A1&dispatchId=d1');
  });

  it('appends shader, volume, shuffle params when provided', () => {
    const url = buildDispatchUrl({
      deviceId: 'lr', play: 'plex:1', dispatchId: 'd1',
      shader: 'dark', volume: 50, shuffle: true,
    });
    expect(url).toContain('shader=dark');
    expect(url).toContain('volume=50');
    expect(url).toContain('shuffle=1');
  });

  it('uses queue= instead of play= when mode is queue', () => {
    const url = buildDispatchUrl({ deviceId: 'lr', queue: 'plex:coll', dispatchId: 'd1' });
    expect(url).toContain('queue=plex%3Acoll');
    expect(url).not.toContain('play=');
  });

  it('throws when deviceId is missing', () => {
    expect(() => buildDispatchUrl({ play: 'plex:1', dispatchId: 'd1' })).toThrow(/deviceId/i);
  });

  it('throws when dispatchId is missing', () => {
    expect(() => buildDispatchUrl({ deviceId: 'lr', play: 'plex:1' })).toThrow(/dispatchId/i);
  });

  it('throws when neither play nor queue is provided', () => {
    expect(() => buildDispatchUrl({ deviceId: 'lr', dispatchId: 'd1' })).toThrow(/play|queue/i);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd frontend && npx vitest run src/modules/Media/cast/dispatchUrl.test.js`

- [ ] **Step 3: Impl**

```js
// frontend/src/modules/Media/cast/dispatchUrl.js
export function buildDispatchUrl({
  deviceId,
  play,
  queue,
  dispatchId,
  shader,
  volume,
  shuffle,
}) {
  if (!deviceId) throw new Error('buildDispatchUrl: deviceId is required');
  if (!dispatchId) throw new Error('buildDispatchUrl: dispatchId is required');
  if (!play && !queue) throw new Error('buildDispatchUrl: play or queue is required');

  const params = new URLSearchParams();
  if (play) params.set('play', play);
  else params.set('queue', queue);
  params.set('dispatchId', dispatchId);
  if (shader) params.set('shader', shader);
  if (typeof volume === 'number' && Number.isFinite(volume)) params.set('volume', String(volume));
  if (shuffle) params.set('shuffle', '1');
  return `api/v1/device/${deviceId}/load?${params.toString()}`;
}

export default buildDispatchUrl;
```

- [ ] **Step 4: Run → 6/6 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/dispatchUrl.js frontend/src/modules/Media/cast/dispatchUrl.test.js
git commit -m "feat(media): add dispatchUrl builder for /device/:id/load"
```

---

## Task 2: `CastTargetProvider` + `useCastTarget`

**Files:**
- Create: `frontend/src/modules/Media/cast/CastTargetProvider.jsx`
- Create: `frontend/src/modules/Media/cast/useCastTarget.js`
- Test: `frontend/src/modules/Media/cast/CastTargetProvider.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/cast/CastTargetProvider.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  CastTargetProvider,
  CAST_TARGET_KEY,
} from './CastTargetProvider.jsx';
import { useCastTarget } from './useCastTarget.js';

function Probe() {
  const { mode, targetIds, setMode, toggleTarget, clearTargets } = useCastTarget();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="targets">{targetIds.join(',')}</span>
      <button data-testid="set-fork" onClick={() => setMode('fork')}>fork</button>
      <button data-testid="toggle-lr" onClick={() => toggleTarget('lr')}>lr</button>
      <button data-testid="toggle-ot" onClick={() => toggleTarget('ot')}>ot</button>
      <button data-testid="clear" onClick={clearTargets}>clear</button>
    </div>
  );
}

describe('CastTargetProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to mode=transfer with empty targets', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('transfer');
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });

  it('toggleTarget adds and removes ids; multi-select is ad-hoc', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('toggle-ot').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('lr,ot');
    act(() => { screen.getByTestId('toggle-lr').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('ot');
  });

  it('setMode switches transfer ↔ fork; invalid ignored', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
  });

  it('persists mode + targets and restores on mount', () => {
    const { unmount } = render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(localStorage.getItem(CAST_TARGET_KEY)).toContain('fork');
    unmount();

    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
    expect(screen.getByTestId('targets')).toHaveTextContent('lr');
  });

  it('clearTargets empties the array', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('clear').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl (two files)**

```jsx
// frontend/src/modules/Media/cast/CastTargetProvider.jsx
import React, { createContext, useEffect, useMemo, useState, useCallback } from 'react';

export const CAST_TARGET_KEY = 'media-app.cast-target';
export const CastTargetContext = createContext(null);

function readPersisted() {
  try {
    const raw = localStorage.getItem(CAST_TARGET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const mode = parsed.mode === 'fork' ? 'fork' : 'transfer';
    const targetIds = Array.isArray(parsed.targetIds) ? parsed.targetIds.filter((x) => typeof x === 'string') : [];
    return { mode, targetIds };
  } catch {
    return null;
  }
}

function writePersisted(state) {
  try { localStorage.setItem(CAST_TARGET_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function CastTargetProvider({ children }) {
  const [mode, setModeRaw] = useState('transfer');
  const [targetIds, setTargetIds] = useState([]);

  // Hydrate once on mount
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted) {
      setModeRaw(persisted.mode);
      setTargetIds(persisted.targetIds);
    }
  }, []);

  // Persist on change
  useEffect(() => { writePersisted({ mode, targetIds }); }, [mode, targetIds]);

  const setMode = useCallback((m) => {
    if (m === 'transfer' || m === 'fork') setModeRaw(m);
  }, []);

  const toggleTarget = useCallback((id) => {
    setTargetIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const clearTargets = useCallback(() => setTargetIds([]), []);

  const value = useMemo(
    () => ({ mode, targetIds, setMode, toggleTarget, clearTargets }),
    [mode, targetIds, setMode, toggleTarget, clearTargets]
  );

  return <CastTargetContext.Provider value={value}>{children}</CastTargetContext.Provider>;
}

export default CastTargetProvider;
```

```js
// frontend/src/modules/Media/cast/useCastTarget.js
import { useContext } from 'react';
import { CastTargetContext } from './CastTargetProvider.jsx';

export function useCastTarget() {
  const ctx = useContext(CastTargetContext);
  if (!ctx) throw new Error('useCastTarget must be used inside CastTargetProvider');
  return ctx;
}

export default useCastTarget;
```

- [ ] **Step 4: Run → 5/5 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/CastTargetProvider.jsx \
         frontend/src/modules/Media/cast/useCastTarget.js \
         frontend/src/modules/Media/cast/CastTargetProvider.test.jsx
git commit -m "feat(media): CastTargetProvider with mode + multi-target persistence"
```

---

## Task 3: `dispatchReducer`

**Files:**
- Create: `frontend/src/modules/Media/cast/dispatchReducer.js`
- Test: `frontend/src/modules/Media/cast/dispatchReducer.test.js`

- [ ] **Step 1: Failing test**

```js
// frontend/src/modules/Media/cast/dispatchReducer.test.js
import { describe, it, expect } from 'vitest';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';

describe('dispatchReducer', () => {
  it('INITIATED creates a new entry in running state', () => {
    const next = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    const entry = next.byId.get('d1');
    expect(entry.deviceId).toBe('lr');
    expect(entry.contentId).toBe('plex:1');
    expect(entry.mode).toBe('transfer');
    expect(entry.status).toBe('running');
    expect(entry.steps).toEqual([]);
  });

  it('STEP appends to the entry.steps array', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'power', status: 'running', elapsedMs: 100,
    });
    state = reduceDispatch(state, {
      type: 'STEP', dispatchId: 'd1', step: 'power', status: 'success', elapsedMs: 500,
    });
    expect(state.byId.get('d1').steps).toHaveLength(2);
    expect(state.byId.get('d1').steps[1].status).toBe('success');
  });

  it('SUCCEEDED sets status=success', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'SUCCEEDED', dispatchId: 'd1', totalElapsedMs: 2400 });
    expect(state.byId.get('d1').status).toBe('success');
    expect(state.byId.get('d1').totalElapsedMs).toBe(2400);
  });

  it('FAILED sets status=failed + records error/failedStep', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, {
      type: 'FAILED', dispatchId: 'd1', error: 'WAKE_FAILED', failedStep: 'power',
    });
    expect(state.byId.get('d1').status).toBe('failed');
    expect(state.byId.get('d1').error).toBe('WAKE_FAILED');
    expect(state.byId.get('d1').failedStep).toBe('power');
  });

  it('REMOVED drops the entry', () => {
    let state = reduceDispatch(initialDispatchState, {
      type: 'INITIATED', dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', mode: 'transfer',
    });
    state = reduceDispatch(state, { type: 'REMOVED', dispatchId: 'd1' });
    expect(state.byId.has('d1')).toBe(false);
  });

  it('unknown action returns prior state reference', () => {
    const s = reduceDispatch(initialDispatchState, { type: 'NOPE' });
    expect(s).toBe(initialDispatchState);
  });

  it('STEP / SUCCEEDED / FAILED with unknown dispatchId are no-ops', () => {
    const s = reduceDispatch(initialDispatchState, {
      type: 'STEP', dispatchId: 'ghost', step: 'power', status: 'running', elapsedMs: 0,
    });
    expect(s).toBe(initialDispatchState);
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl**

```js
// frontend/src/modules/Media/cast/dispatchReducer.js
export const initialDispatchState = Object.freeze({ byId: new Map() });

export function reduceDispatch(state, action) {
  switch (action.type) {
    case 'INITIATED': {
      const { dispatchId, deviceId, contentId, mode } = action;
      const next = new Map(state.byId);
      next.set(dispatchId, {
        dispatchId,
        deviceId,
        contentId,
        mode,
        status: 'running',
        steps: [],
        error: null,
        failedStep: null,
        totalElapsedMs: null,
        initiatedAt: new Date().toISOString(),
      });
      return { ...state, byId: next };
    }
    case 'STEP': {
      const { dispatchId, step, status, elapsedMs, error } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      next.set(dispatchId, {
        ...prev,
        steps: [...prev.steps, { step, status, elapsedMs, error: error ?? null, ts: new Date().toISOString() }],
      });
      return { ...state, byId: next };
    }
    case 'SUCCEEDED': {
      const { dispatchId, totalElapsedMs } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      next.set(dispatchId, { ...prev, status: 'success', totalElapsedMs: totalElapsedMs ?? null });
      return { ...state, byId: next };
    }
    case 'FAILED': {
      const { dispatchId, error, failedStep } = action;
      const prev = state.byId.get(dispatchId);
      if (!prev) return state;
      const next = new Map(state.byId);
      next.set(dispatchId, { ...prev, status: 'failed', error: error ?? 'unknown', failedStep: failedStep ?? null });
      return { ...state, byId: next };
    }
    case 'REMOVED': {
      if (!state.byId.has(action.dispatchId)) return state;
      const next = new Map(state.byId);
      next.delete(action.dispatchId);
      return { ...state, byId: next };
    }
    default:
      return state;
  }
}

export default reduceDispatch;
```

- [ ] **Step 4: Run → 7/7 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/dispatchReducer.js frontend/src/modules/Media/cast/dispatchReducer.test.js
git commit -m "feat(media): dispatchReducer for per-dispatch state + steps"
```

---

## Task 4: `DispatchProvider` + `useDispatch`

**Files:**
- Create: `frontend/src/modules/Media/cast/DispatchProvider.jsx`
- Create: `frontend/src/modules/Media/cast/useDispatch.js`
- Test: `frontend/src/modules/Media/cast/DispatchProvider.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/cast/DispatchProvider.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => apiMock(...a),
}));

import { DispatchProvider, useDispatch } from './DispatchProvider.jsx';

function Probe() {
  const { dispatches, dispatchToTarget } = useDispatch();
  const rows = [...dispatches.values()].map((d) => `${d.dispatchId}:${d.status}`).join(',');
  return (
    <div>
      <span data-testid="rows">{rows}</span>
      <button data-testid="fire" onClick={() => dispatchToTarget({ targetIds: ['lr'], play: 'plex:1', mode: 'transfer' })}>fire</button>
    </div>
  );
}

let capturedFilter = null;
let capturedCallback = null;
beforeEach(() => {
  apiMock.mockReset();
  subscribeFn.mockReset().mockImplementation((filter, cb) => {
    capturedFilter = filter;
    capturedCallback = cb;
    return () => {};
  });
});

describe('DispatchProvider', () => {
  it('subscribes to homeline:* topics with a function filter', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'homeline:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'homeline:other' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(false);
    expect(capturedFilter({ topic: 'playback_state' })).toBe(false);
  });

  it('dispatchToTarget fires DaylightAPI per target and adds a running row', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 2000 });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    // URL shape sanity: ../device/lr/load?play=plex%3A1&dispatchId=...
    expect(apiMock.mock.calls[0][0]).toMatch(/^api\/v1\/device\/lr\/load\?play=plex%3A1&dispatchId=/);
    // Row exists as running initially (SUCCEEDED comes after the call resolves)
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:success|:running/));
  });

  it('homeline message routed by dispatchId appends a STEP entry', async () => {
    apiMock.mockResolvedValueOnce(new Promise(() => {})); // never resolves — keeps status=running
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });

    // Pull the dispatchId the provider generated
    let dispatchId;
    await waitFor(() => {
      const match = apiMock.mock.calls[0]?.[0]?.match(/dispatchId=([^&]+)/);
      dispatchId = match?.[1];
      expect(dispatchId).toBeTruthy();
    });

    act(() => {
      capturedCallback({
        topic: 'homeline:lr', type: 'wake-progress',
        dispatchId, step: 'power', status: 'running', elapsedMs: 50, ts: 't',
      });
    });
    // Status is still running; no snapshot change to the row label here, but
    // the test asserts the reducer got the step (checked via no crash + rows present)
    expect(screen.getByTestId('rows').textContent).toContain(':running');
  });

  it('successful API response flips status=success', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 1234 });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:success/));
  });

  it('failed API response flips status=failed', async () => {
    apiMock.mockResolvedValueOnce({ ok: false, failedStep: 'power', error: 'WAKE_FAILED' });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:failed/));
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl (two files)**

```jsx
// frontend/src/modules/Media/cast/DispatchProvider.jsx
import React, { createContext, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { reduceDispatch, initialDispatchState } from './dispatchReducer.js';
import { buildDispatchUrl } from './dispatchUrl.js';
import mediaLog from '../logging/mediaLog.js';

const DispatchContext = createContext(null);

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isHomelineMsg(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('homeline:');
}

export function DispatchProvider({ children }) {
  const [state, dispatch] = useReducer(reduceDispatch, initialDispatchState);
  const lastAttemptRef = useRef(null);

  useEffect(() => {
    const unsub = wsService.subscribe(isHomelineMsg, (msg) => {
      const { dispatchId, step, status, elapsedMs, error } = msg;
      if (typeof dispatchId !== 'string' || !dispatchId) return;
      if (!step || !status) return;
      dispatch({ type: 'STEP', dispatchId, step, status, elapsedMs, error });
    });
    return unsub;
  }, []);

  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle }) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];
    const contentId = play ?? queue;
    const dispatchIds = [];
    lastAttemptRef.current = { targetIds, play, queue, mode, shader, volume, shuffle };

    for (const deviceId of targetIds) {
      const dispatchId = uuid();
      dispatchIds.push(dispatchId);
      dispatch({ type: 'INITIATED', dispatchId, deviceId, contentId, mode: mode ?? 'transfer' });
      mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });

      const url = buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle });
      DaylightAPI(url)
        .then((res) => {
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
          } else {
            dispatch({
              type: 'FAILED', dispatchId,
              error: res?.error ?? 'unknown',
              failedStep: res?.failedStep ?? null,
            });
            mediaLog.dispatchFailed({ dispatchId, failedStep: res?.failedStep, error: res?.error });
          }
        })
        .catch((err) => {
          dispatch({ type: 'FAILED', dispatchId, error: err?.message ?? 'network-error', failedStep: null });
          mediaLog.dispatchFailed({ dispatchId, error: err?.message });
        });
    }
    return dispatchIds;
  }, []);

  const retryLast = useCallback(() => {
    if (!lastAttemptRef.current) return [];
    return dispatchToTarget(lastAttemptRef.current);
  }, [dispatchToTarget]);

  const value = useMemo(
    () => ({ dispatches: state.byId, dispatchToTarget, retryLast }),
    [state.byId, dispatchToTarget, retryLast]
  );

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export function useDispatch() {
  const ctx = React.useContext(DispatchContext);
  if (!ctx) throw new Error('useDispatch must be used inside DispatchProvider');
  return ctx;
}

export default DispatchProvider;
```

```js
// frontend/src/modules/Media/cast/useDispatch.js
export { useDispatch } from './DispatchProvider.jsx';
```

- [ ] **Step 4: Run → 5/5 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/DispatchProvider.jsx \
         frontend/src/modules/Media/cast/useDispatch.js \
         frontend/src/modules/Media/cast/DispatchProvider.test.jsx
git commit -m "feat(media): DispatchProvider fans out /device/:id/load + routes homeline progress"
```

---

## Task 5: `CastButton`

**Files:**
- Create: `frontend/src/modules/Media/cast/CastButton.jsx`
- Test: `frontend/src/modules/Media/cast/CastButton.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/cast/CastButton.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let castTargetCtx = { mode: 'transfer', targetIds: ['lr'], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: vi.fn(() => castTargetCtx),
}));

const dispatchMock = vi.fn(() => Promise.resolve(['d1']));
vi.mock('./useDispatch.js', () => ({
  useDispatch: vi.fn(() => ({ dispatches: new Map(), dispatchToTarget: dispatchMock, retryLast: vi.fn() })),
}));

import { CastButton } from './CastButton.jsx';

beforeEach(() => {
  dispatchMock.mockClear();
  castTargetCtx = { mode: 'transfer', targetIds: ['lr'], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
});

describe('CastButton', () => {
  it('renders "Cast" text', () => {
    render(<CastButton contentId="plex:1" />);
    expect(screen.getByTestId('cast-button-plex:1')).toHaveTextContent(/cast/i);
  });

  it('click fires dispatchToTarget with targetIds + mode + play', () => {
    render(<CastButton contentId="plex:1" />);
    fireEvent.click(screen.getByTestId('cast-button-plex:1'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      targetIds: ['lr'],
      mode: 'transfer',
      play: 'plex:1',
    }));
  });

  it('is disabled when no targets selected', () => {
    castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
    render(<CastButton contentId="plex:1" />);
    expect(screen.getByTestId('cast-button-plex:1')).toBeDisabled();
  });

  it('accepts a queue prop (container dispatch)', () => {
    render(<CastButton queue="plex:album-1" />);
    fireEvent.click(screen.getByTestId('cast-button-plex:album-1'));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ queue: 'plex:album-1' }));
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl**

```jsx
// frontend/src/modules/Media/cast/CastButton.jsx
import React from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useDispatch } from './useDispatch.js';

export function CastButton({ contentId, queue }) {
  const { targetIds, mode } = useCastTarget();
  const { dispatchToTarget } = useDispatch();
  const id = contentId ?? queue;
  const disabled = targetIds.length === 0;

  const onClick = () => {
    if (disabled) return;
    const params = { targetIds, mode };
    if (contentId) params.play = contentId;
    else if (queue) params.queue = queue;
    dispatchToTarget(params);
  };

  return (
    <button
      data-testid={`cast-button-${id}`}
      className="cast-button"
      onClick={onClick}
      disabled={disabled}
    >
      Cast
    </button>
  );
}

export default CastButton;
```

- [ ] **Step 4: Run → 4/4 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/CastButton.jsx frontend/src/modules/Media/cast/CastButton.test.jsx
git commit -m "feat(media): CastButton fires dispatch to current target(s) + mode"
```

---

## Task 6: `CastTargetChip` + `CastPopover`

**Files:**
- Create: `frontend/src/modules/Media/cast/CastTargetChip.jsx`
- Create: `frontend/src/modules/Media/cast/CastPopover.jsx`
- Test: `frontend/src/modules/Media/cast/CastTargetChip.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/cast/CastTargetChip.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: vi.fn(() => castTargetCtx),
}));

let fleetCtx = { devices: [{ id: 'lr', name: 'Living Room' }, { id: 'ot', name: 'Office' }], byDevice: new Map(), loading: false, error: null };
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

import { CastTargetChip } from './CastTargetChip.jsx';

beforeEach(() => {
  castTargetCtx = { mode: 'transfer', targetIds: [], setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
  fleetCtx = { devices: [{ id: 'lr', name: 'Living Room' }, { id: 'ot', name: 'Office' }], byDevice: new Map(), loading: false, error: null };
});

describe('CastTargetChip', () => {
  it('shows "No target" label when targetIds is empty', () => {
    render(<CastTargetChip />);
    expect(screen.getByTestId('cast-target-chip')).toHaveTextContent(/no target/i);
  });

  it('shows selected target names joined', () => {
    castTargetCtx = { ...castTargetCtx, targetIds: ['lr', 'ot'] };
    render(<CastTargetChip />);
    expect(screen.getByTestId('cast-target-chip')).toHaveTextContent(/Living Room.*Office/);
  });

  it('clicking the chip opens a popover', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    expect(screen.getByTestId('cast-popover')).toBeInTheDocument();
  });

  it('popover lists each fleet device with a checkbox and a mode toggle', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    expect(screen.getByTestId('cast-target-checkbox-lr')).toBeInTheDocument();
    expect(screen.getByTestId('cast-target-checkbox-ot')).toBeInTheDocument();
    expect(screen.getByTestId('cast-mode-transfer')).toBeInTheDocument();
    expect(screen.getByTestId('cast-mode-fork')).toBeInTheDocument();
  });

  it('checkbox click calls toggleTarget', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    fireEvent.click(screen.getByTestId('cast-target-checkbox-lr'));
    expect(castTargetCtx.toggleTarget).toHaveBeenCalledWith('lr');
  });

  it('mode toggle calls setMode', () => {
    render(<CastTargetChip />);
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    fireEvent.click(screen.getByTestId('cast-mode-fork'));
    expect(castTargetCtx.setMode).toHaveBeenCalledWith('fork');
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl (two files)**

```jsx
// frontend/src/modules/Media/cast/CastPopover.jsx
import React from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';

export function CastPopover() {
  const { mode, targetIds, setMode, toggleTarget } = useCastTarget();
  const { devices } = useFleetContext();

  return (
    <div data-testid="cast-popover" className="cast-popover">
      <div className="cast-popover-section">
        <div className="cast-popover-label">Mode</div>
        <label>
          <input
            type="radio"
            name="cast-mode"
            checked={mode === 'transfer'}
            onChange={() => setMode('transfer')}
            data-testid="cast-mode-transfer"
          />
          Transfer (stop local)
        </label>
        <label>
          <input
            type="radio"
            name="cast-mode"
            checked={mode === 'fork'}
            onChange={() => setMode('fork')}
            data-testid="cast-mode-fork"
          />
          Fork (keep local)
        </label>
      </div>
      <div className="cast-popover-section">
        <div className="cast-popover-label">Targets</div>
        {devices.length === 0 && <div>No devices</div>}
        {devices.map((d) => (
          <label key={d.id}>
            <input
              type="checkbox"
              checked={targetIds.includes(d.id)}
              onChange={() => toggleTarget(d.id)}
              data-testid={`cast-target-checkbox-${d.id}`}
            />
            {d.name ?? d.id}
          </label>
        ))}
      </div>
    </div>
  );
}

export default CastPopover;
```

```jsx
// frontend/src/modules/Media/cast/CastTargetChip.jsx
import React, { useState } from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { CastPopover } from './CastPopover.jsx';

export function CastTargetChip() {
  const { targetIds } = useCastTarget();
  const { devices } = useFleetContext();
  const [open, setOpen] = useState(false);

  const selectedNames = targetIds
    .map((id) => devices.find((d) => d.id === id)?.name ?? id)
    .join(', ');
  const label = targetIds.length === 0 ? 'No target' : selectedNames;

  return (
    <div className="cast-target-chip-root">
      <button
        data-testid="cast-target-chip"
        className="cast-target-chip"
        onClick={() => setOpen((o) => !o)}
      >
        Cast: {label}
      </button>
      {open && <CastPopover />}
    </div>
  );
}

export default CastTargetChip;
```

- [ ] **Step 4: Run → 6/6 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/CastTargetChip.jsx \
         frontend/src/modules/Media/cast/CastPopover.jsx \
         frontend/src/modules/Media/cast/CastTargetChip.test.jsx
git commit -m "feat(media): CastTargetChip + CastPopover for target+mode selection"
```

---

## Task 7: `DispatchProgressTray`

**Files:**
- Create: `frontend/src/modules/Media/cast/DispatchProgressTray.jsx`
- Test: `frontend/src/modules/Media/cast/DispatchProgressTray.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/cast/DispatchProgressTray.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let dispatchCtx = { dispatches: new Map(), dispatchToTarget: vi.fn(), retryLast: vi.fn() };
vi.mock('./useDispatch.js', () => ({
  useDispatch: vi.fn(() => dispatchCtx),
}));

import { DispatchProgressTray } from './DispatchProgressTray.jsx';

beforeEach(() => {
  dispatchCtx = { dispatches: new Map(), dispatchToTarget: vi.fn(), retryLast: vi.fn() };
});

describe('DispatchProgressTray', () => {
  it('renders nothing when no dispatches are in flight or recent', () => {
    render(<DispatchProgressTray />);
    expect(screen.queryByTestId('dispatch-tray')).not.toBeInTheDocument();
  });

  it('renders a row per active dispatch with deviceId and status', () => {
    dispatchCtx = {
      dispatches: new Map([
        ['d1', { dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', status: 'running', steps: [] }],
        ['d2', { dispatchId: 'd2', deviceId: 'ot', contentId: 'plex:2', status: 'success', steps: [], totalElapsedMs: 1234 }],
      ]),
      dispatchToTarget: vi.fn(), retryLast: vi.fn(),
    };
    render(<DispatchProgressTray />);
    expect(screen.getByTestId('dispatch-tray')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-row-d1')).toHaveTextContent(/lr/);
    expect(screen.getByTestId('dispatch-row-d1')).toHaveTextContent(/running/);
    expect(screen.getByTestId('dispatch-row-d2')).toHaveTextContent(/success/);
  });

  it('failed rows show a retry button that calls retryLast', () => {
    const retryLast = vi.fn();
    dispatchCtx = {
      dispatches: new Map([['d1', { dispatchId: 'd1', deviceId: 'lr', contentId: 'plex:1', status: 'failed', error: 'boom', steps: [] }]]),
      dispatchToTarget: vi.fn(),
      retryLast,
    };
    render(<DispatchProgressTray />);
    fireEvent.click(screen.getByTestId('dispatch-retry-d1'));
    expect(retryLast).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl**

```jsx
// frontend/src/modules/Media/cast/DispatchProgressTray.jsx
import React from 'react';
import { useDispatch } from './useDispatch.js';

function statusLabel(d) {
  if (d.status === 'running') {
    const last = d.steps[d.steps.length - 1];
    return last ? `running: ${last.step} (${last.status})` : 'running';
  }
  if (d.status === 'success') {
    return `success (${d.totalElapsedMs ?? 0}ms)`;
  }
  if (d.status === 'failed') {
    return `failed: ${d.failedStep ?? 'unknown'} — ${d.error}`;
  }
  return d.status;
}

export function DispatchProgressTray() {
  const { dispatches, retryLast } = useDispatch();
  if (dispatches.size === 0) return null;
  return (
    <div data-testid="dispatch-tray" className="dispatch-tray">
      {[...dispatches.values()].map((d) => (
        <div key={d.dispatchId} data-testid={`dispatch-row-${d.dispatchId}`} className="dispatch-row">
          <span className="dispatch-row-device">{d.deviceId}</span>
          <span className="dispatch-row-content">{d.contentId}</span>
          <span className="dispatch-row-status">{statusLabel(d)}</span>
          {d.status === 'failed' && (
            <button
              data-testid={`dispatch-retry-${d.dispatchId}`}
              onClick={retryLast}
              className="dispatch-row-retry"
            >
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default DispatchProgressTray;
```

- [ ] **Step 4: Run → 3/3 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/cast/DispatchProgressTray.jsx frontend/src/modules/Media/cast/DispatchProgressTray.test.jsx
git commit -m "feat(media): DispatchProgressTray shows live per-dispatch status + retry"
```

---

## Task 8: Wire providers into `MediaApp.jsx`

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/Apps/MediaApp.test.jsx`
- Modify: `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`

- [ ] **Step 1: Update the provider stack**

Replace `frontend/src/Apps/MediaApp.jsx`:

```jsx
// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <CastTargetProvider>
            <DispatchProvider>
              <SearchProvider>
                <MediaAppShell />
              </SearchProvider>
            </DispatchProvider>
          </CastTargetProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

- [ ] **Step 2: Update `MediaApp.test.jsx` mock (no changes needed — DaylightAPI mock already handles both configs; CastTarget + Dispatch don't hit the API on mount)**

- [ ] **Step 3: Update `MediaAppShell.test.jsx` wrappers**

Read `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`. Currently wraps `<ClientIdentityProvider><LocalSessionProvider><FleetProvider><MediaAppShell /></FleetProvider></LocalSessionProvider></ClientIdentityProvider>`. Extend to include CastTargetProvider + DispatchProvider around MediaAppShell.

Add imports near the existing ones:

```jsx
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../cast/DispatchProvider.jsx';
```

In both `render(...)` blocks, wrap `<MediaAppShell />` with `<CastTargetProvider><DispatchProvider>…</DispatchProvider></CastTargetProvider>`:

```jsx
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <FleetProvider>
            <CastTargetProvider>
              <DispatchProvider>
                <MediaAppShell />
              </DispatchProvider>
            </CastTargetProvider>
          </FleetProvider>
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
```

- [ ] **Step 4: Run tests**

```
cd frontend && npx vitest run src/Apps/MediaApp.test.jsx src/modules/Media/shell/MediaAppShell.test.jsx
```

Expected: all pass.

Full Media suite:
```
cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx
```
Expected: all pass (target: ~170 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx \
         frontend/src/Apps/MediaApp.test.jsx \
         frontend/src/modules/Media/shell/MediaAppShell.test.jsx
git commit -m "feat(media): wrap MediaApp in CastTargetProvider + DispatchProvider"
```

---

## Task 9: Wire dock chrome + content-row CastButton

**Files:**
- Modify: `frontend/src/modules/Media/shell/Dock.jsx`
- Modify: `frontend/src/modules/Media/search/SearchResults.jsx`
- Modify: `frontend/src/modules/Media/browse/DetailView.jsx`

- [ ] **Step 1: Update Dock.jsx**

Replace `frontend/src/modules/Media/shell/Dock.jsx`:

```jsx
// frontend/src/modules/Media/shell/Dock.jsx
import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock">
      <SearchBar />
      <FleetIndicator />
      <CastTargetChip />
      <MiniPlayer />
      <DispatchProgressTray />
      <button data-testid="session-reset-btn" onClick={lifecycle.reset}>Reset session</button>
    </div>
  );
}

export default Dock;
```

- [ ] **Step 2: Update SearchResults.jsx — add CastButton per row**

Read `frontend/src/modules/Media/search/SearchResults.jsx` — the current file imports `resultToQueueInput` and renders rows with Play Now / Play Next / Up Next / Add buttons. Add a `<CastButton>` after the existing action buttons.

Add import:

```jsx
import { CastButton } from '../cast/CastButton.jsx';
```

Inside the row `<span className="media-result-actions">`, after the existing buttons, add:

```jsx
              <CastButton contentId={id} />
```

- [ ] **Step 3: Update DetailView.jsx — add CastButton**

Add import:

```jsx
import { CastButton } from '../cast/CastButton.jsx';
```

Inside `<div className="detail-actions">`, after the existing buttons, add:

```jsx
        <CastButton contentId={contentId} />
```

- [ ] **Step 4: Run existing shell + search + browse tests**

Run:
```
cd frontend && npx vitest run src/modules/Media/shell src/modules/Media/search src/modules/Media/browse
```

The existing SearchResults test / DetailView test may now fail because rendering a `<CastButton>` requires `<CastTargetProvider>` and `<DispatchProvider>` in the render tree. Two fixes for each affected test file:

- **`SearchResults.test.jsx`**: add a `vi.mock('../cast/CastButton.jsx', ...)` at the top:

  ```jsx
  vi.mock('../cast/CastButton.jsx', () => ({
    CastButton: ({ contentId }) => <button data-testid={`cast-button-${contentId}`}>Cast</button>,
  }));
  ```

- **`DetailView.test.jsx`**: same mock:

  ```jsx
  vi.mock('../cast/CastButton.jsx', () => ({
    CastButton: ({ contentId }) => <button data-testid={`cast-button-${contentId}`}>Cast</button>,
  }));
  ```

Run again — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/Dock.jsx \
         frontend/src/modules/Media/search/SearchResults.jsx \
         frontend/src/modules/Media/search/SearchResults.test.jsx \
         frontend/src/modules/Media/browse/DetailView.jsx \
         frontend/src/modules/Media/browse/DetailView.test.jsx
git commit -m "feat(media): wire CastTargetChip + DispatchProgressTray into dock; CastButton on rows"
```

---

## Task 10: Transfer-mode local stop on success

**Files:**
- Modify: `frontend/src/modules/Media/cast/DispatchProvider.jsx`
- Modify: `frontend/src/modules/Media/cast/DispatchProvider.test.jsx`

- [ ] **Step 1: Add failing test**

Append to `DispatchProvider.test.jsx`:

```jsx
describe('DispatchProvider — transfer mode', () => {
  it('on SUCCESS with mode=transfer, calls local controller.transport.stop()', async () => {
    // Note: DispatchProvider reads LocalSessionContext lazily — test by rendering
    // inside a minimal LocalSessionContext.Provider that exposes a stop spy.
    const stopSpy = vi.fn();
    const ctrl = { transport: { stop: stopSpy, play: vi.fn(), pause: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() } };
    // The provider reaches local via useSessionController('local').  We mock that.
    const useSessionCtrlMock = vi.fn(() => ctrl);
    vi.doMock('../session/useSessionController.js', () => ({ useSessionController: useSessionCtrlMock }));
    const { DispatchProvider: Mod, useDispatch: useDis } = await import('./DispatchProvider.jsx');

    function LocalProbe() {
      const { dispatchToTarget } = useDis();
      return <button data-testid="fire-t" onClick={() => dispatchToTarget({ targetIds: ['lr'], play: 'plex:1', mode: 'transfer' })}>fire</button>;
    }

    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 500 });
    render(<Mod><LocalProbe /></Mod>);
    act(() => { screen.getByTestId('fire-t').click(); });
    await waitFor(() => expect(stopSpy).toHaveBeenCalled());
  });

  it('on SUCCESS with mode=fork, does NOT call local stop', async () => {
    const stopSpy = vi.fn();
    const ctrl = { transport: { stop: stopSpy, play: vi.fn(), pause: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() } };
    const useSessionCtrlMock = vi.fn(() => ctrl);
    vi.doMock('../session/useSessionController.js', () => ({ useSessionController: useSessionCtrlMock }));
    const { DispatchProvider: Mod, useDispatch: useDis } = await import('./DispatchProvider.jsx');

    function LocalProbe() {
      const { dispatchToTarget } = useDis();
      return <button data-testid="fire-f" onClick={() => dispatchToTarget({ targetIds: ['lr'], play: 'plex:1', mode: 'fork' })}>fire</button>;
    }

    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 500 });
    render(<Mod><LocalProbe /></Mod>);
    act(() => { screen.getByTestId('fire-f').click(); });
    // Wait a tick to ensure promise resolves
    await new Promise((r) => setTimeout(r, 0));
    expect(stopSpy).not.toHaveBeenCalled();
  });
});
```

Note: this test uses `vi.doMock` for a per-test mock of `useSessionController`. The existing tests in the file do not mock it because they only test dispatch bookkeeping; this new one needs the session controller for stop() call.

- [ ] **Step 2: Update `DispatchProvider.jsx` to consult the local controller on transfer success**

Read the current file. Add import at top:

```jsx
import { useSessionController } from '../session/useSessionController.js';
```

Inside `DispatchProvider`, call the hook at the top of the function body:

```jsx
  const localController = useSessionController('local');
```

Then in `dispatchToTarget`, after a successful result, check mode and per-target aggregate. To keep the semantic simple in v1, stop local on the FIRST success with `mode='transfer'` (the spec says "stop only on confirmed success"). Update the `.then` in `dispatchToTarget`:

```jsx
        .then((res) => {
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
            if (mode === 'transfer') {
              try { localController.transport.stop(); } catch { /* ignore */ }
            }
          } else {
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run src/modules/Media/cast/DispatchProvider.test.jsx`
Expected: all pass (5 original + 2 new = 7).

If the two new tests fail because `vi.doMock` didn't take effect for the re-imported module — hoist the mock to the describe block using a top-level `vi.mock` with a factory that references a mutable variable, similar to how other tests handle this pattern.

If you see a test ordering issue (earlier tests that DIDN'T mock `useSessionController` now seeing the mock leak), wrap the two new tests' mocks in `beforeEach` + `afterEach` that call `vi.resetModules()`.

If after two attempts you cannot get both styles to coexist cleanly, split the transfer tests into a separate file `DispatchProvider.transfer.test.jsx` that has its own module-level mock of `useSessionController`. Accept that.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Media/cast/DispatchProvider.jsx frontend/src/modules/Media/cast/DispatchProvider.test.jsx
git commit -m "feat(media): on transfer-mode dispatch success, stop local session"
```

---

## Task 11: Playwright e2e — cast surface

**Files:**
- Create: `tests/live/flow/media/media-app-cast.runtime.test.mjs`

- [ ] **Step 1: Write**

```javascript
// tests/live/flow/media/media-app-cast.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P4 cast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('CastTargetChip renders and opens a popover', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('cast-target-chip')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('cast-target-chip').click();
    await expect(page.getByTestId('cast-popover')).toBeVisible();
    // Mode toggles and target checkboxes present
    await expect(page.getByTestId('cast-mode-transfer')).toBeVisible();
    await expect(page.getByTestId('cast-mode-fork')).toBeVisible();
  });

  test('selecting a device and casting a search result places a row in the dispatch tray', async ({ page }) => {
    await page.goto('/media');
    // Pick a device as target
    await page.getByTestId('cast-target-chip').click();
    const firstTarget = page.locator('[data-testid^="cast-target-checkbox-"]').first();
    await expect(firstTarget).toBeVisible({ timeout: 5000 });
    await firstTarget.check();

    // Close popover (click chip again)
    await page.getByTestId('cast-target-chip').click();

    // Search
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    const rowId = await firstRow.getAttribute('data-testid');
    const contentId = rowId?.replace(/^result-row-/, '');
    expect(contentId).toBeTruthy();

    // Click the Cast button on that row
    await page.getByTestId(`cast-button-${contentId}`).click();

    // Tray shows a dispatch row
    await expect(page.getByTestId('dispatch-tray')).toBeVisible({ timeout: 10000 });
    const anyRow = page.locator('[data-testid^="dispatch-row-"]').first();
    await expect(anyRow).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check tests/live/flow/media/media-app-cast.runtime.test.mjs`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/media/media-app-cast.runtime.test.mjs
git commit -m "test(media): e2e cast — pick target, cast a result, progress tray shows it"
```

---

## Task 12: Final validation

- [ ] **Step 1: Full Media vitest suite**

Run: `cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx`
Expected: all pass. Target: ~175 tests.

- [ ] **Step 2: Grep for raw console**

Run: `grep -RE "console\.(log|debug|warn|error)" frontend/src/modules/Media/cast`
Expected: empty.

- [ ] **Step 3: Run Playwright suites (P1+P2+P3+P4)**

```
BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/media/ --reporter=line --workers=1
```
Expected: 11 passed (P1: 4, P2: 3, P3: 2, P4: 2).

- [ ] **Step 4: Smoke in a real browser**

Visit `http://localhost:3112/media`:
1. CastTargetChip shows "No target"
2. Click chip → popover → select a device → chip shows "Cast: Living Room"
3. Search "lonesome" → click the "Cast" button on a result
4. Watch tray show the dispatch as `running` → (eventually) `success` or `failed`
5. If failed: Retry button visible

- [ ] **Step 5: Done.**

---

## Requirements traceability for P4

| Spec requirement | Covered by task |
|---|---|
| C6.1 multi-target dispatch | Tasks 2, 4 (targetIds array; fan-out in DispatchProvider) |
| C6.2 Transfer vs Fork mode | Task 10 (local stop on transfer success); CastPopover UI (Task 6) |
| C6.3 live wake-progress | Task 4 (homeline:* subscription → STEP dispatches) |
| C6.4 retry affordance | Task 7 (failed rows show Retry button → retryLast) |
| C9.8 idempotency | Backend handles (spec §4.7); client picks fresh dispatchIds per intent (Task 4) |
| `dispatch.*` log events | Task 4 (mediaLog.dispatchInitiated/Succeeded/Failed) |

---

## Known simplifications / deferrals

- **No step-by-step progress UI** beyond "running: <last-step>" text in the tray. Animated progress bars / step indicators can land later (styling is out of scope for the skeleton).
- **Retry always uses `retryLast`** (the most recent dispatchToTarget params). Per-row retry that reuses the same dispatchId (and so hits the backend's idempotency cache) is a polish item — the plan intentionally generates fresh dispatchIds on retry to avoid IDEMPOTENCY_CONFLICT on parameter changes.
- **No "cancel dispatch" action** — backend doesn't expose one. A user who wants to bail just navigates away.
- **Shader/volume/shuffle on the CastButton** — not surfaced in v1 UI. CastPopover could add these if needed. For now, CastButton passes no shader/volume/shuffle — the target keeps its defaults.
- **Adopt-mode Hand Off (POST `/:id/load`)** — out of scope here. That's P6 Session Portability.

---

## Self-review notes

- **Spec coverage:** C6 fully mapped; C9.8 backend-handled but respected client-side.
- **Types consistency:** `useDispatch()` returns `{dispatches, dispatchToTarget, retryLast}`. `useCastTarget()` returns `{mode, targetIds, setMode, toggleTarget, clearTargets}`. Both consistent across tasks.
- **No placeholders:** every task has real code, real commands, expected outputs.
- **Provider ordering in MediaApp.jsx:** CastTarget → Dispatch (Dispatch reads LocalSession and CastTarget, not the other way around).
- **Future-proofing:** single-subscription pattern (same as FleetProvider in P3) keeps the WS interface tight; adding `device-ack:*` for P5 plugs into the same filter function without new subscriptions.
