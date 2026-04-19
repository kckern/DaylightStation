# Media App P3 (Fleet Observation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only fleet observation — enumerate playback-capable remote devices from `/api/v1/device/config`, subscribe to per-device `device-state:<id>` broadcasts, surface each device's current item / state / online status in a FleetView canvas and a FleetIndicator dock chip.

**Architecture:** A new `FleetProvider` lives inside the app-level stack below `<LocalSessionProvider>`. On mount it fetches the device config (filtering to entries with `content_control` — playback surfaces only) and opens a single `device-state:*` subscription on the WebSocket singleton. Per-device snapshots, last-seen timestamps, and offline/stale flags are stored in a context-level `Map`. The view layer consumes selectors (`useFleetSummary`, `useDevice`). P3 is strictly read-only; transport/queue control is P5.

**Tech Stack:** React 18 · Vite · Vitest + @testing-library/react + happy-dom · Playwright · existing `wsService` singleton + `DaylightAPI` + `@shared-contracts/media/*` validators.

---

## Pre-flight

- **Parent branch state:** main at HEAD (post-P2 + hide-fix). 124 unit + 7 Playwright passing. Dev server at `:3112` live.
- **Work isolation:** create worktree via `superpowers:using-git-worktrees` (branch `feature/media-app-p3`). Install deps (`npm install` at root + `frontend/`). Baseline: `cd frontend && npx vitest run src/modules/Media` passes 124 tests.
- **APIs in use (verified against prod container at :3111):**
  - `GET /api/v1/device/config` → `{devices: {<id>: {type, screen_path?, content_control?, ...}}}` — 6 current entries: `livingroom-tv`, `office-tv`, `piano`, `driveway-camera`, `doorbell`, `symbol-scanner`. Only `livingroom-tv` (shield-tv) and `office-tv` (linux-pc) have `content_control`.
- **WS topics (backend-side wired in `WebSocketEventBus.mjs`):**
  - `device-state:<deviceId>` — per-device state broadcast. Payload = `DeviceStateBroadcast` (§9.7): `{topic, deviceId, reason: 'change'|'heartbeat'|'initial'|'offline', snapshot, ts}`. Backend replays last-known snapshot on subscribe (§7.4). Devices may or may not currently publish — P3 UI must render gracefully when they don't.
  - `device-ack:<deviceId>` — ack for any command. Not consumed by P3 (no commands sent) but the subscription infrastructure is laid so P5 plugs in.
- **WebSocketService API:** `wsService.subscribe(filter, callback) → unsubscribe`. Filter can be a string, array of strings, or function. Message envelope has `topic` at the top level (e.g., `{topic: 'device-state:livingroom-tv', deviceId: 'livingroom-tv', snapshot: {...}, ...}`). Because topics include a deviceId suffix, use a **function filter** `(msg) => typeof msg.topic === 'string' && msg.topic.startsWith('device-state:')` rather than enumerating every topic.
- **Shared contracts:** `validateDeviceStateBroadcast` from `@shared-contracts/media/envelopes.mjs`. Use for inbound validation; ignore bad payloads silently (log via `mediaLog`).
- **Filter rule for "playback surfaces":** include devices where `content_control` is truthy. Exclude cameras, midi-keyboards, scanners.

---

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/modules/Media/fleet/useDevices.js` | Fetches `/api/v1/device/config`, returns `{devices, loading, error, refresh}` — filtered to playback surfaces |
| `frontend/src/modules/Media/fleet/useDeviceStateSubscription.js` | Subscribes to a single `device-state:<id>` topic; manages snapshot + lastSeenAt + isStale for one device |
| `frontend/src/modules/Media/fleet/fleetReducer.js` | Pure reducer over `Map<deviceId, {snapshot, reason, lastSeenAt, isStale}>`; actions: `RECEIVED`, `OFFLINE`, `STALE`, `RESET` |
| `frontend/src/modules/Media/fleet/FleetProvider.jsx` | Composes useDevices + one subscription + reducer; provides context |
| `frontend/src/modules/Media/fleet/useDevice.js` | Selector: `useDevice(deviceId)` → `{config, snapshot, isStale, lastSeenAt}` |
| `frontend/src/modules/Media/fleet/useFleetSummary.js` | Selector: summary counts + online list |
| `frontend/src/modules/Media/shell/FleetIndicator.jsx` | Dock chip showing online/total count; click → navigate to fleet view |
| `frontend/src/modules/Media/shell/FleetView.jsx` | Canvas view: one card per device with live state |
| `frontend/src/modules/Media/shell/Canvas.jsx` | **modify** — add `fleet` case |
| `frontend/src/modules/Media/shell/Dock.jsx` | **modify** — render `<FleetIndicator />` |
| `frontend/src/Apps/MediaApp.jsx` | **modify** — insert `<FleetProvider>` below `<LocalSessionProvider>` |
| `tests/live/flow/media/media-app-fleet.runtime.test.mjs` | End-to-end Playwright: fleet view renders, cards for known devices appear |

---

## Task 1: `useDevices` hook

**Files:**
- Create: `frontend/src/modules/Media/fleet/useDevices.js`
- Test: `frontend/src/modules/Media/fleet/useDevices.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/fleet/useDevices.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useDevices } from './useDevices.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useDevices', () => {
  it('fetches /api/v1/device/config on mount', async () => {
    apiMock.mockResolvedValueOnce({
      devices: {
        'livingroom-tv': { type: 'shield-tv', content_control: { provider: 'fully-kiosk' } },
        'office-tv': { type: 'linux-pc', content_control: { provider: 'x' } },
      },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledWith('api/v1/device/config');
    expect(result.current.devices.map((d) => d.id)).toEqual(['livingroom-tv', 'office-tv']);
    expect(result.current.error).toBeNull();
  });

  it('filters out devices without content_control (cameras, piano, scanner)', async () => {
    apiMock.mockResolvedValueOnce({
      devices: {
        'livingroom-tv': { type: 'shield-tv', content_control: { provider: 'x' } },
        'piano': { type: 'midi-keyboard' },
        'camera-1': { type: 'ip-camera' },
      },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices.map((d) => d.id)).toEqual(['livingroom-tv']);
  });

  it('each device entry exposes {id, type, name, ...config}', async () => {
    apiMock.mockResolvedValueOnce({
      devices: { 'lr': { type: 'shield-tv', name: 'Living Room', content_control: { x: 1 } } },
    });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices[0]).toMatchObject({ id: 'lr', type: 'shield-tv', name: 'Living Room' });
  });

  it('refresh() re-fetches', async () => {
    apiMock
      .mockResolvedValueOnce({ devices: { 'a': { type: 'shield-tv', content_control: {} } } })
      .mockResolvedValueOnce({ devices: { 'a': { type: 'shield-tv', content_control: {} }, 'b': { type: 'linux-pc', content_control: {} } } });
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('captures error and exposes empty device list', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.devices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/useDevices.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/fleet/useDevices.js
import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

function filterPlaybackSurfaces(rawDevices) {
  if (!rawDevices || typeof rawDevices !== 'object') return [];
  return Object.entries(rawDevices)
    .filter(([, cfg]) => cfg && cfg.content_control)
    .map(([id, cfg]) => ({ id, ...cfg }));
}

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await DaylightAPI('api/v1/device/config');
      setDevices(filterPlaybackSurfaces(res?.devices));
      setLoading(false);
    } catch (err) {
      setError(err);
      setDevices([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { devices, loading, error, refresh: load };
}

export default useDevices;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/useDevices.test.jsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet/useDevices.js frontend/src/modules/Media/fleet/useDevices.test.jsx
git commit -m "feat(media): add useDevices hook (filters to playback surfaces)"
```

---

## Task 2: `fleetReducer`

**Files:**
- Create: `frontend/src/modules/Media/fleet/fleetReducer.js`
- Test: `frontend/src/modules/Media/fleet/fleetReducer.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Media/fleet/fleetReducer.test.js
import { describe, it, expect } from 'vitest';
import { reduceFleet, initialFleetState } from './fleetReducer.js';

const makeSnap = (state = 'playing', contentId = 'plex:1') => ({
  sessionId: 's1', state, currentItem: { contentId, format: 'video' }, position: 0,
  queue: { items: [], currentIndex: -1, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'lr', updatedAt: '2026-04-18T00:00:00Z' },
});

describe('fleetReducer', () => {
  it('RECEIVED stores snapshot + clears stale flag + updates lastSeenAt', () => {
    const state = reduceFleet(initialFleetState, {
      type: 'RECEIVED',
      deviceId: 'lr',
      snapshot: makeSnap(),
      reason: 'heartbeat',
      ts: '2026-04-18T10:00:00Z',
    });
    const entry = state.byDevice.get('lr');
    expect(entry.snapshot.state).toBe('playing');
    expect(entry.reason).toBe('heartbeat');
    expect(entry.isStale).toBe(false);
    expect(entry.offline).toBe(false);
    expect(entry.lastSeenAt).toBe('2026-04-18T10:00:00Z');
  });

  it('OFFLINE (via RECEIVED with reason="offline") flips offline flag but keeps last snapshot', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'lr', snapshot: makeSnap('playing'), reason: 'heartbeat', ts: 't1',
    });
    state = reduceFleet(state, {
      type: 'RECEIVED', deviceId: 'lr', snapshot: makeSnap('playing'), reason: 'offline', ts: 't2',
    });
    const entry = state.byDevice.get('lr');
    expect(entry.offline).toBe(true);
    expect(entry.snapshot.state).toBe('playing'); // preserved
    expect(entry.reason).toBe('offline');
  });

  it('STALE marks every entry stale without clearing snapshots', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'a', snapshot: makeSnap(), reason: 'heartbeat', ts: 't1',
    });
    state = reduceFleet(state, {
      type: 'RECEIVED', deviceId: 'b', snapshot: makeSnap(), reason: 'change', ts: 't2',
    });
    state = reduceFleet(state, { type: 'STALE' });
    expect(state.byDevice.get('a').isStale).toBe(true);
    expect(state.byDevice.get('b').isStale).toBe(true);
    expect(state.byDevice.get('a').snapshot.state).toBe('playing');
  });

  it('RESET empties byDevice', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'a', snapshot: makeSnap(), reason: 'initial', ts: 't',
    });
    state = reduceFleet(state, { type: 'RESET' });
    expect(state.byDevice.size).toBe(0);
  });

  it('unknown action type returns prior state reference', () => {
    const s1 = reduceFleet(initialFleetState, { type: 'NOPE' });
    expect(s1).toBe(initialFleetState);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/fleetReducer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/modules/Media/fleet/fleetReducer.js
export const initialFleetState = Object.freeze({
  byDevice: new Map(),
});

export function reduceFleet(state, action) {
  switch (action.type) {
    case 'RECEIVED': {
      const { deviceId, snapshot, reason, ts } = action;
      const prev = state.byDevice.get(deviceId) ?? {};
      const next = new Map(state.byDevice);
      next.set(deviceId, {
        snapshot: snapshot ?? prev.snapshot ?? null,
        reason: reason ?? 'change',
        lastSeenAt: ts ?? new Date().toISOString(),
        isStale: false,
        offline: reason === 'offline',
      });
      return { ...state, byDevice: next };
    }
    case 'STALE': {
      const next = new Map();
      for (const [id, entry] of state.byDevice.entries()) {
        next.set(id, { ...entry, isStale: true });
      }
      return { ...state, byDevice: next };
    }
    case 'RESET':
      return { ...state, byDevice: new Map() };
    default:
      return state;
  }
}

export default reduceFleet;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/fleetReducer.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet/fleetReducer.js frontend/src/modules/Media/fleet/fleetReducer.test.js
git commit -m "feat(media): fleetReducer for per-device snapshot + stale/offline flags"
```

---

## Task 3: `FleetProvider`

**Files:**
- Create: `frontend/src/modules/Media/fleet/FleetProvider.jsx`
- Test: `frontend/src/modules/Media/fleet/FleetProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/fleet/FleetProvider.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const subscribeFn = vi.fn();
const onStatusChangeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
    subscribe: (...args) => subscribeFn(...args),
    onStatusChange: (...args) => onStatusChangeFn(...args),
  },
  default: { send: vi.fn(), subscribe: (...args) => subscribeFn(...args), onStatusChange: (...args) => onStatusChangeFn(...args) },
}));

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { FleetProvider, useFleetContext } from './FleetProvider.jsx';

function Probe() {
  const { devices, byDevice } = useFleetContext();
  const ids = devices.map((d) => d.id).join(',');
  const states = [...byDevice.entries()].map(([id, e]) => `${id}:${e.snapshot?.state ?? '?'}`).join(',');
  return <div>devices={ids};states={states}</div>;
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
  onStatusChangeFn.mockReset().mockReturnValue(() => {});
});

describe('FleetProvider', () => {
  it('loads devices from /api/v1/device/config and subscribes to device-state:*', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/devices=lr;/)).toBeInTheDocument());
    expect(typeof capturedFilter).toBe('function');
    // Filter accepts device-state:* topics, rejects others
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:other-id' })).toBe(true);
    expect(capturedFilter({ topic: 'playback_state' })).toBe(false);
    expect(capturedFilter({ topic: 'device-ack:lr' })).toBe(false);
  });

  it('routes incoming device-state broadcasts into byDevice', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({
        topic: 'device-state:lr',
        deviceId: 'lr',
        reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'playing', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: '2026-04-18T00:00:00Z',
      });
    });
    await waitFor(() => expect(screen.getByText(/lr:playing/)).toBeInTheDocument());
  });

  it('ignores malformed broadcasts (missing deviceId or snapshot)', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({ topic: 'device-state:lr' }); // no deviceId, no snapshot
      capturedCallback({ topic: 'device-state:', deviceId: '', snapshot: {} }); // empty id
    });
    await waitFor(() => expect(screen.getByText(/states=$|states=[^:]/)).toBeInTheDocument());
  });

  it('marks all devices stale on WS disconnect status', async () => {
    let statusListener;
    onStatusChangeFn.mockImplementation((cb) => { statusListener = cb; return () => {}; });
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });

    function StaleProbe() {
      const { byDevice } = useFleetContext();
      const entry = byDevice.get('lr');
      return <div>stale={String(entry?.isStale ?? 'none')}</div>;
    }

    render(<FleetProvider><StaleProbe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'idle', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/stale=false/)).toBeInTheDocument());

    act(() => { statusListener?.({ connected: false }); });
    await waitFor(() => expect(screen.getByText(/stale=true/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/FleetProvider.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/fleet/FleetProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { useDevices } from './useDevices.js';
import { reduceFleet, initialFleetState } from './fleetReducer.js';
import mediaLog from '../logging/mediaLog.js';

const FleetContext = createContext(null);

function isDeviceStateBroadcast(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('device-state:');
}

export function FleetProvider({ children }) {
  const { devices, loading, error, refresh } = useDevices();
  const [fleetState, dispatch] = useReducer(reduceFleet, initialFleetState);

  // Subscribe to every device-state:* broadcast (one subscription, filter function).
  useEffect(() => {
    const unsub = wsService.subscribe(isDeviceStateBroadcast, (msg) => {
      const deviceId = msg.deviceId;
      if (typeof deviceId !== 'string' || deviceId.length === 0) return;
      if (!msg.snapshot && msg.reason !== 'offline') return;
      dispatch({
        type: 'RECEIVED',
        deviceId,
        snapshot: msg.snapshot ?? null,
        reason: msg.reason ?? 'change',
        ts: msg.ts ?? new Date().toISOString(),
      });
    });
    return unsub;
  }, []);

  // Mark all devices stale on WS disconnect.
  useEffect(() => {
    const unsub = wsService.onStatusChange((status) => {
      if (status && status.connected === false) {
        dispatch({ type: 'STALE' });
        mediaLog.wsDisconnected({});
      } else if (status && status.connected === true) {
        mediaLog.wsConnected({});
      }
    });
    return unsub;
  }, []);

  const value = useMemo(
    () => ({ devices, byDevice: fleetState.byDevice, loading, error, refresh }),
    [devices, fleetState.byDevice, loading, error, refresh]
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleetContext() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
}

export default FleetProvider;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/FleetProvider.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet/FleetProvider.jsx frontend/src/modules/Media/fleet/FleetProvider.test.jsx
git commit -m "feat(media): FleetProvider composes useDevices + device-state:* subscription"
```

---

## Task 4: `useDevice` + `useFleetSummary` selectors

**Files:**
- Create: `frontend/src/modules/Media/fleet/useDevice.js`
- Create: `frontend/src/modules/Media/fleet/useFleetSummary.js`
- Test: `frontend/src/modules/Media/fleet/selectors.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/fleet/selectors.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
    subscribe: (...args) => subscribeFn(...args),
    onStatusChange: vi.fn(() => () => {}),
  },
  default: { send: vi.fn(), subscribe: (...args) => subscribeFn(...args), onStatusChange: vi.fn(() => () => {}) },
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({
    devices: {
      'lr': { type: 'shield-tv', content_control: { x: 1 }, name: 'Living Room' },
      'ot': { type: 'linux-pc', content_control: { x: 1 }, name: 'Office' },
    },
  })),
}));

import { FleetProvider } from './FleetProvider.jsx';
import { useDevice } from './useDevice.js';
import { useFleetSummary } from './useFleetSummary.js';

let capturedCallback = null;
beforeEach(() => {
  subscribeFn.mockReset().mockImplementation((_f, cb) => { capturedCallback = cb; return () => {}; });
});

function DeviceProbe({ id }) {
  const d = useDevice(id);
  if (!d) return <div>none</div>;
  return <div>name={d.config.name};state={d.snapshot?.state ?? '?'};stale={String(d.isStale)}</div>;
}
function SummaryProbe() {
  const s = useFleetSummary();
  return <div>total={s.total};online={s.online};offline={s.offline}</div>;
}

describe('useDevice / useFleetSummary', () => {
  it('useDevice returns config + snapshot + isStale for a known id', async () => {
    render(<FleetProvider><DeviceProbe id="lr" /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/name=Living Room/)).toBeInTheDocument());
    expect(screen.getByText(/state=\?/)).toBeInTheDocument();

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'change',
        snapshot: {
          sessionId: 's', state: 'paused', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/state=paused/)).toBeInTheDocument());
  });

  it('useDevice returns null for an unknown id', async () => {
    render(<FleetProvider><DeviceProbe id="ghost" /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/none/)).toBeInTheDocument());
  });

  it('useFleetSummary reports total / online / offline counts', async () => {
    render(<FleetProvider><SummaryProbe /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/total=2/)).toBeInTheDocument());
    expect(screen.getByText(/online=0/)).toBeInTheDocument();

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'playing', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/online=1/)).toBeInTheDocument());

    act(() => {
      capturedCallback({ topic: 'device-state:ot', deviceId: 'ot', reason: 'offline', snapshot: null, ts: 't' });
    });
    await waitFor(() => expect(screen.getByText(/offline=1/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/selectors.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```js
// frontend/src/modules/Media/fleet/useDevice.js
import { useFleetContext } from './FleetProvider.jsx';

export function useDevice(deviceId) {
  const { devices, byDevice } = useFleetContext();
  const config = devices.find((d) => d.id === deviceId);
  if (!config) return null;
  const entry = byDevice.get(deviceId);
  return {
    config,
    snapshot: entry?.snapshot ?? null,
    reason: entry?.reason ?? null,
    lastSeenAt: entry?.lastSeenAt ?? null,
    isStale: entry?.isStale ?? false,
    offline: entry?.offline ?? false,
  };
}

export default useDevice;
```

```js
// frontend/src/modules/Media/fleet/useFleetSummary.js
import { useMemo } from 'react';
import { useFleetContext } from './FleetProvider.jsx';

export function useFleetSummary() {
  const { devices, byDevice } = useFleetContext();
  return useMemo(() => {
    const total = devices.length;
    let online = 0;
    let offline = 0;
    for (const d of devices) {
      const entry = byDevice.get(d.id);
      if (!entry) continue;
      if (entry.offline) { offline += 1; continue; }
      if (entry.snapshot) online += 1;
    }
    return { total, online, offline };
  }, [devices, byDevice]);
}

export default useFleetSummary;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/selectors.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet/useDevice.js \
         frontend/src/modules/Media/fleet/useFleetSummary.js \
         frontend/src/modules/Media/fleet/selectors.test.jsx
git commit -m "feat(media): add useDevice + useFleetSummary selectors over FleetProvider"
```

---

## Task 5: `FleetIndicator` (dock chip)

**Files:**
- Create: `frontend/src/modules/Media/shell/FleetIndicator.jsx`
- Test: `frontend/src/modules/Media/shell/FleetIndicator.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/shell/FleetIndicator.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let summary = { total: 0, online: 0, offline: 0 };
vi.mock('../fleet/useFleetSummary.js', () => ({
  useFleetSummary: vi.fn(() => summary),
}));

const navCtx = { push: vi.fn() };
vi.mock('./NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { FleetIndicator } from './FleetIndicator.jsx';

beforeEach(() => {
  navCtx.push.mockClear();
  summary = { total: 0, online: 0, offline: 0 };
});

describe('FleetIndicator', () => {
  it('renders total/online counts', () => {
    summary = { total: 2, online: 1, offline: 0 };
    render(<FleetIndicator />);
    expect(screen.getByTestId('fleet-indicator')).toHaveTextContent('1/2');
  });

  it('renders nothing meaningful when total=0 (no devices)', () => {
    summary = { total: 0, online: 0, offline: 0 };
    render(<FleetIndicator />);
    expect(screen.getByTestId('fleet-indicator')).toHaveTextContent('0/0');
  });

  it('click navigates to fleet view', () => {
    summary = { total: 2, online: 2, offline: 0 };
    render(<FleetIndicator />);
    fireEvent.click(screen.getByTestId('fleet-indicator'));
    expect(navCtx.push).toHaveBeenCalledWith('fleet', {});
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/shell/FleetIndicator.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/shell/FleetIndicator.jsx
import React from 'react';
import { useFleetSummary } from '../fleet/useFleetSummary.js';
import { useNav } from './NavProvider.jsx';

export function FleetIndicator() {
  const { total, online } = useFleetSummary();
  const { push } = useNav();
  return (
    <button
      data-testid="fleet-indicator"
      onClick={() => push('fleet', {})}
      className="fleet-indicator"
      title="Fleet"
    >
      Fleet {online}/{total}
    </button>
  );
}

export default FleetIndicator;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/shell/FleetIndicator.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/FleetIndicator.jsx frontend/src/modules/Media/shell/FleetIndicator.test.jsx
git commit -m "feat(media): FleetIndicator dock chip with online/total count"
```

---

## Task 6: `FleetView`

**Files:**
- Create: `frontend/src/modules/Media/shell/FleetView.jsx`
- Test: `frontend/src/modules/Media/shell/FleetView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Media/shell/FleetView.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let fleetCtx = { devices: [], byDevice: new Map(), loading: true, error: null };
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

import { FleetView } from './FleetView.jsx';

beforeEach(() => {
  fleetCtx = { devices: [], byDevice: new Map(), loading: true, error: null };
});

describe('FleetView', () => {
  it('shows loading state', () => {
    render(<FleetView />);
    expect(screen.getByTestId('fleet-loading')).toBeInTheDocument();
  });

  it('renders one card per device with name + current state', () => {
    fleetCtx = {
      devices: [
        { id: 'lr', name: 'Living Room', type: 'shield-tv' },
        { id: 'ot', name: 'Office', type: 'linux-pc' },
      ],
      byDevice: new Map([
        ['lr', { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Song X' } }, isStale: false, offline: false }],
        // 'ot' has no entry — appears as "unknown"
      ]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('Living Room');
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('playing');
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('Song X');
    expect(screen.getByTestId('fleet-card-ot')).toHaveTextContent('Office');
    expect(screen.getByTestId('fleet-card-ot')).toHaveTextContent(/unknown|—/);
  });

  it('stale entries render a stale indicator', () => {
    fleetCtx = {
      devices: [{ id: 'lr', name: 'Living Room', type: 'shield-tv' }],
      byDevice: new Map([['lr', { snapshot: { state: 'playing', currentItem: null }, isStale: true, offline: false }]]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent(/stale/i);
  });

  it('offline entries render offline badge + preserved snapshot', () => {
    fleetCtx = {
      devices: [{ id: 'lr', name: 'Living Room', type: 'shield-tv' }],
      byDevice: new Map([['lr', { snapshot: { state: 'paused', currentItem: { contentId: 'plex:1' } }, isStale: false, offline: true }]]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent(/offline/i);
    // Last-known snapshot still shown
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('paused');
  });

  it('renders empty state when there are no playback surfaces', () => {
    fleetCtx = { devices: [], byDevice: new Map(), loading: false, error: null };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/shell/FleetView.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Media/shell/FleetView.jsx
import React from 'react';
import { useFleetContext } from '../fleet/FleetProvider.jsx';

function stateLabel(entry) {
  if (!entry) return 'unknown';
  if (entry.offline) return `offline (last: ${entry.snapshot?.state ?? 'unknown'})`;
  return entry.snapshot?.state ?? 'unknown';
}

function currentItemLabel(entry) {
  const item = entry?.snapshot?.currentItem;
  if (!item) return '—';
  return item.title ?? item.contentId;
}

export function FleetView() {
  const { devices, byDevice, loading, error } = useFleetContext();

  if (loading) return <div data-testid="fleet-loading">Loading fleet…</div>;
  if (error) return <div data-testid="fleet-error">{error.message}</div>;
  if (!devices.length) return <div data-testid="fleet-empty">No playback devices configured.</div>;

  return (
    <div data-testid="fleet-view" className="fleet-view">
      <h1>Fleet</h1>
      <ul className="fleet-cards">
        {devices.map((d) => {
          const entry = byDevice.get(d.id);
          return (
            <li key={d.id} data-testid={`fleet-card-${d.id}`} className="fleet-card">
              <div className="fleet-card-name">{d.name ?? d.id}</div>
              <div className="fleet-card-type">{d.type}</div>
              <div className="fleet-card-state">{stateLabel(entry)}</div>
              <div className="fleet-card-item">{currentItemLabel(entry)}</div>
              {entry?.isStale && <span className="fleet-card-stale">stale</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default FleetView;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/shell/FleetView.test.jsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/FleetView.jsx frontend/src/modules/Media/shell/FleetView.test.jsx
git commit -m "feat(media): FleetView canvas view — device cards with live state"
```

---

## Task 7: Canvas + Dock wiring

**Files:**
- Modify: `frontend/src/modules/Media/shell/Canvas.jsx`
- Modify: `frontend/src/modules/Media/shell/Dock.jsx`

- [ ] **Step 1: Update `Canvas.jsx` to include the fleet view**

Replace `renderView` in `frontend/src/modules/Media/shell/Canvas.jsx`:

```jsx
// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';
import { NowPlayingView } from './NowPlayingView.jsx';
import { HomeView } from '../browse/HomeView.jsx';
import { BrowseView } from '../browse/BrowseView.jsx';
import { DetailView } from '../browse/DetailView.jsx';
import { FleetView } from './FleetView.jsx';

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} modifiers={params.modifiers} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    case 'fleet': return <FleetView />;
    default: return <HomeView />;
  }
}

export function Canvas() {
  const { view, params } = useNav();
  return (
    <div data-testid="media-canvas" className="media-canvas">
      {renderView(view, params)}
    </div>
  );
}

export default Canvas;
```

- [ ] **Step 2: Update `Dock.jsx` to include the FleetIndicator**

Replace `frontend/src/modules/Media/shell/Dock.jsx`:

```jsx
// frontend/src/modules/Media/shell/Dock.jsx
import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock">
      <SearchBar />
      <FleetIndicator />
      <MiniPlayer />
      <button data-testid="session-reset-btn" onClick={lifecycle.reset}>Reset session</button>
    </div>
  );
}

export default Dock;
```

- [ ] **Step 3: Run the shell suite to confirm no regressions**

Run: `cd frontend && npx vitest run src/modules/Media/shell`
Expected: all previous tests still pass + FleetIndicator + FleetView cases.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Media/shell/Canvas.jsx frontend/src/modules/Media/shell/Dock.jsx
git commit -m "feat(media): Canvas gains fleet view; Dock gains FleetIndicator"
```

---

## Task 8: Wire `<FleetProvider>` into `MediaApp.jsx`

**Files:**
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/Apps/MediaApp.test.jsx`
- Modify: `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`

- [ ] **Step 1: Update MediaApp entry**

Replace `frontend/src/Apps/MediaApp.jsx`:

```jsx
// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <SearchProvider>
            <MediaAppShell />
          </SearchProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

- [ ] **Step 2: Update `MediaApp.test.jsx` to mock `/api/v1/device/config`**

Find the existing `DaylightAPI` mock and extend it:

```jsx
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') {
      return { browse: [], searchScopes: [{ label: 'All', key: 'all', params: 'take=50' }] };
    }
    if (path === 'api/v1/device/config') {
      return { devices: {} };
    }
    return {};
  }),
}));
```

- [ ] **Step 3: Update `MediaAppShell.test.jsx` to wrap in FleetProvider**

The existing test renders `<MediaAppShell />` directly (not through `<MediaApp />`). After P3, `MediaAppShell` depends on `FleetProvider` (via `<Dock>` → `<FleetIndicator>` → `useFleetContext`). Add FleetProvider to the test wrapper.

Read `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`. Find the two `render(...)` calls that wrap `<LocalSessionProvider><MediaAppShell /></LocalSessionProvider>` inside `<ClientIdentityProvider>`. Add `<FleetProvider>` around `<MediaAppShell />` in both.

Also ensure the existing DaylightAPI mock at the top of that file returns an empty device-config:

```jsx
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') return { browse: [], searchScopes: [] };
    if (path === 'api/v1/device/config') return { devices: {} };
    return {};
  }),
}));
```

Add the import near the existing ones:

```jsx
import { FleetProvider } from '../fleet/FleetProvider.jsx';
```

And wrap:

```jsx
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <FleetProvider>
            <MediaAppShell />
          </FleetProvider>
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
```

in both test cases.

- [ ] **Step 4: Run the app-entry tests**

Run:
```
cd frontend && npx vitest run src/Apps/MediaApp.test.jsx src/modules/Media/shell/MediaAppShell.test.jsx
```
Expected: all pass.

Full Media suite:
```
cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/MediaApp.jsx \
         frontend/src/Apps/MediaApp.test.jsx \
         frontend/src/modules/Media/shell/MediaAppShell.test.jsx
git commit -m "feat(media): wrap MediaApp in FleetProvider; update tests for fleet context"
```

---

## Task 9: Visibility-change config refresh

**Files:**
- Modify: `frontend/src/modules/Media/fleet/FleetProvider.jsx`
- Modify: `frontend/src/modules/Media/fleet/FleetProvider.test.jsx`

- [ ] **Step 1: Append a test**

```jsx
// append to frontend/src/modules/Media/fleet/FleetProvider.test.jsx

describe('FleetProvider — visibility refresh', () => {
  it('refetches device config when the tab becomes visible', async () => {
    apiMock
      .mockResolvedValueOnce({ devices: { 'a': { type: 'shield-tv', content_control: { x: 1 } } } })
      .mockResolvedValueOnce({
        devices: {
          'a': { type: 'shield-tv', content_control: { x: 1 } },
          'b': { type: 'linux-pc', content_control: { x: 1 } },
        },
      });

    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/devices=a;/)).toBeInTheDocument());
    expect(apiMock).toHaveBeenCalledTimes(1);

    // Fire visibilitychange with visibilityState=visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/devices=a,b;/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/FleetProvider.test.jsx`
Expected: the new test FAILS because no visibilitychange handler is wired yet.

- [ ] **Step 3: Add the handler to FleetProvider**

Inside `FleetProvider`, after the existing `useEffect` that subscribes to WS state, add:

```jsx
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/modules/Media/fleet/FleetProvider.test.jsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet/FleetProvider.jsx frontend/src/modules/Media/fleet/FleetProvider.test.jsx
git commit -m "feat(media): refetch device config on visibilitychange:visible"
```

---

## Task 10: Playwright e2e for the fleet surface

**Files:**
- Create: `tests/live/flow/media/media-app-fleet.runtime.test.mjs`

- [ ] **Step 1: Write the test**

```javascript
// tests/live/flow/media/media-app-fleet.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P3 fleet observation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('fleet indicator renders in the dock and opens the fleet view', async ({ page }) => {
    await page.goto('/media');
    await expect(page.getByTestId('fleet-indicator')).toBeVisible({ timeout: 10000 });
    // Label matches "Fleet <online>/<total>"
    await expect(page.getByTestId('fleet-indicator')).toHaveText(/Fleet \d+\/\d+/);

    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });
  });

  test('fleet view shows cards for known playback devices', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 5000 });

    // Known devices from devices.yml with content_control. At least one of
    // these should appear; both are ideal. Either shield-tv (livingroom-tv)
    // or linux-pc (office-tv).
    const anyCard = page.locator('[data-testid^="fleet-card-"]').first();
    await expect(anyCard).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check tests/live/flow/media/media-app-fleet.runtime.test.mjs`
Expected: no output.

- [ ] **Step 3: Run against live dev server**

After merging into main (so Vite picks up the code), run:
```
BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/media/media-app-fleet.runtime.test.mjs --reporter=line --workers=1
```
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/media/media-app-fleet.runtime.test.mjs
git commit -m "test(media): e2e fleet — indicator in dock, cards for content devices"
```

---

## Task 11: Final validation

- [ ] **Step 1: Full Media vitest suite**

Run: `cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx`
Expected: all pass. Target: 140+ tests.

- [ ] **Step 2: Grep for raw console**

Run: `grep -RE "console\.(log|debug|warn|error)" frontend/src/modules/Media/fleet frontend/src/modules/Media/shell/FleetIndicator.jsx frontend/src/modules/Media/shell/FleetView.jsx`
Expected: empty.

- [ ] **Step 3: Playwright all Media e2e**

```
BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/media/ --reporter=line --workers=1
```
Expected: 9 passed (P1: 4 + P2: 3 + P3: 2).

- [ ] **Step 4: Update the design spec open questions**

Edit `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md` §13 — if any P3-resolvable questions exist. None listed explicitly; note remaining P5/P7 items are still open.

- [ ] **Step 5: Final commit if any doc edits**

```bash
git add docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md
git commit -m "docs(media): P3 fleet observation landed; note remaining open questions"
```

---

## Requirements traceability for P3

| Spec requirement | Covered by task |
|---|---|
| C4.1 fleet enumeration from `/device/config` | Task 1 (useDevices) |
| C4.2 live per-device state | Tasks 2, 3, 6 (reducer, provider, FleetView rendering `state`, `currentItem`, `type`, offline indicator) |
| C4.4 stale indicator on WS drop | Task 3 (WS onStatusChange → STALE dispatch) |
| C9.4 WS reconnect + stale on disrupt | Task 3 |
| C9.6 preserve last-known snapshot on offline | Task 2 (`RECEIVED` with `reason: 'offline'` keeps snapshot) |
| N2.1 lightweight fleet view | No per-device history in P3 (C4.3 deferred); flat Map of snapshots only |

---

## Known simplifications / deferrals

- **No `device-ack:<id>` subscription in P3.** Device-ack is consumed by P5's `RemoteSessionAdapter` to resolve `commandId` promises. We don't issue commands in P3 so we don't subscribe. FleetProvider's single `device-state:*` subscription is already future-proofed with a filter function — adding `device-ack:*` later is a ~3-line change.
- **No per-device play history** (C4.3 — spec marks it deferred).
- **No per-device offline-age computation.** Backend synthesizes `reason: 'offline'` per §7.4 when a device goes 15s without heartbeat. Until the backend emits this (or until a device is actually broadcasting state at all), FleetView will simply show "unknown" for devices. That's graceful and matches the contract: the UI reflects whatever the backend relays.
- **No filtering toggle in the UI** for playback-only vs all devices. Hard-coded filter on `content_control` inside `useDevices`. If the user wants to observe cameras/piano later, we relax the filter then.

---

## Self-review notes

- **Spec coverage:** every C4 requirement maps to at least one task. C4.3 is explicitly deferred per spec §3.
- **Types consistency:** `useFleetContext()` returns `{devices, byDevice, loading, error, refresh}` — referenced the same way in Tasks 4, 6. `useDevice(id)` returns `{config, snapshot, reason, lastSeenAt, isStale, offline}` — matches the FleetView's expected entry shape.
- **No placeholders:** every task has complete code + exact commands + expected outputs.
- **No new backend dependencies:** P3 is pure frontend. The `device-state:<id>` broadcast topic is backend infrastructure that already exists (`WebSocketEventBus.mjs` routing + `DeviceLivenessService.mjs` replay). Whether any device currently publishes doesn't block the UI from shipping — empty / "unknown" cards are the graceful default.
- **Future-proofing for P5:** the filter function `msg.topic.startsWith('device-state:')` is easy to swap for `msg.topic.startsWith('device-state:') || msg.topic.startsWith('device-ack:')` when P5 lands. Per-device routing happens in the callback via `msg.deviceId`.
