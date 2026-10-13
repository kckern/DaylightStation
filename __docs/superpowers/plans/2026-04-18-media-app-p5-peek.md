# Media App P5 (Peek / Remote Control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable remote-session control — `useSessionController({ deviceId })` returns a real controller backed by REST + WebSocket ack lifecycle, so any UI built on the target-agnostic controller surface (transport bar, queue panel, volume/shader) instantly works for remote sessions without re-authoring.

**Architecture:** A `RemoteSessionAdapter` class mirrors `LocalSessionAdapter`'s controller shape but reads snapshots from `FleetProvider.byDevice` (already subscribed in P3) and writes via `POST /api/v1/device/:id/session/*` endpoints, waiting for matching `commandId` on `device-ack:<id>`. A `PeekProvider` manages a `Map<deviceId, RemoteSessionAdapter>` of active peeks and is the new entry point for `useSessionController({deviceId})`. Fleet cards gain a "Peek" button; canvas registry gains a `peek` view keyed by deviceId.

**Tech Stack:** React 18 · Vite · Vitest + happy-dom · Playwright · `wsService`, `DaylightAPI` · shared contracts.

---

## Pre-flight

- **Parent state:** main at HEAD (post-P4). 188 unit + ~11 Playwright tests passing.
- **Work isolation:** create worktree `feature/media-app-p5`. Install deps. Baseline ~188 vitest tests.
- **APIs (verified):**
  - `POST /api/v1/device/:id/session/transport` — body `{action, value?, commandId}`. Currently returns `{ok:false, error:"Session control not configured"}` when session control isn't wired. Client handles gracefully.
  - `POST /api/v1/device/:id/session/queue/:op` — same behavior.
  - `PUT /api/v1/device/:id/session/{shuffle,repeat,shader,volume}` — body `{value|level|mode|enabled, commandId}`.
  - `POST /api/v1/device/:id/session/claim` — P6 (Hand Off / Take Over) concern.
- **WS topic `device-ack:<deviceId>`** — payload `{topic, deviceId, commandId, ok, error?, code?, appliedAt}`. Used to correlate request → ack → promise resolution.
- **`DaylightAPI(path, data, method)`:** pass `data` object + `'POST'`/`'PUT'` for non-GET. E.g. `DaylightAPI('api/v1/device/lr/session/transport', {action: 'pause', commandId: 'c1'}, 'POST')`.
- **Existing infra to reuse:**
  - `FleetProvider.byDevice` — already provides live snapshots keyed by deviceId (P3)
  - `useSessionController` (P1) — currently throws for remote targets; this plan removes the throw and routes through `PeekProvider`
  - `dispatchUrl`-style URL helpers not reused — session endpoints are direct POSTs/PUTs

---

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/modules/Media/peek/RemoteSessionAdapter.js` | Class with same controller surface as LocalSessionAdapter; reads from FleetProvider; writes via REST+ack |
| `frontend/src/modules/Media/peek/PeekProvider.jsx` | Holds `Map<deviceId, RemoteSessionAdapter>` + `useSessionController({deviceId})` routing |
| `frontend/src/modules/Media/peek/usePeek.js` | Hook: `{enterPeek(deviceId), exitPeek(deviceId), activePeeks}` |
| `frontend/src/modules/Media/peek/ackSubscriptions.js` | Internal — subscribes to `device-ack:*`, resolves pending command promises |
| `frontend/src/modules/Media/shell/PeekPanel.jsx` | Canvas view: transport+queue+config UI bound to a deviceId's remote controller |
| `frontend/src/modules/Media/session/useSessionController.js` | **modify** — route `{deviceId}` target to remote adapter via PeekProvider |
| `frontend/src/modules/Media/shell/Canvas.jsx` | **modify** — add `peek` case keyed by `params.deviceId` |
| `frontend/src/modules/Media/shell/FleetView.jsx` | **modify** — add "Peek" button per device card → `useNav().push('peek', {deviceId})` |
| `frontend/src/Apps/MediaApp.jsx` | **modify** — insert `<PeekProvider>` inside `<FleetProvider>` (above CastTargetProvider) |
| `tests/live/flow/media/media-app-peek.runtime.test.mjs` | Playwright: Fleet card → Peek button → PeekPanel shows |

---

## Task 1: `RemoteSessionAdapter` core

**Files:**
- Create: `frontend/src/modules/Media/peek/RemoteSessionAdapter.js`
- Test: `frontend/src/modules/Media/peek/RemoteSessionAdapter.test.js`

- [ ] **Step 1: Failing test**

```js
// frontend/src/modules/Media/peek/RemoteSessionAdapter.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteSessionAdapter } from './RemoteSessionAdapter.js';

function makeDeps() {
  const http = vi.fn(async () => ({ ok: true }));
  let snapshot = {
    sessionId: 'remote-s1',
    state: 'playing',
    currentItem: { contentId: 'plex:5', format: 'video' },
    position: 42,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 60, playbackRate: 1 },
    meta: { ownerId: 'lr', updatedAt: 't' },
  };
  return {
    deviceId: 'lr',
    httpClient: http,
    getSnapshot: () => snapshot,
    setSnapshot: (s) => { snapshot = s; },
  };
}

describe('RemoteSessionAdapter — snapshot + surface', () => {
  it('getSnapshot delegates to the provided getSnapshot fn', () => {
    const deps = makeDeps();
    const a = new RemoteSessionAdapter(deps);
    expect(a.getSnapshot().sessionId).toBe('remote-s1');
  });

  it('exposes controller surface: transport, queue, config, lifecycle, portability', () => {
    const a = new RemoteSessionAdapter(makeDeps());
    expect(typeof a.transport.play).toBe('function');
    expect(typeof a.transport.pause).toBe('function');
    expect(typeof a.transport.stop).toBe('function');
    expect(typeof a.transport.seekAbs).toBe('function');
    expect(typeof a.transport.seekRel).toBe('function');
    expect(typeof a.transport.skipNext).toBe('function');
    expect(typeof a.transport.skipPrev).toBe('function');
    expect(typeof a.queue.playNow).toBe('function');
    expect(typeof a.queue.add).toBe('function');
    expect(typeof a.queue.clear).toBe('function');
    expect(typeof a.config.setShuffle).toBe('function');
    expect(typeof a.config.setVolume).toBe('function');
  });
});

describe('RemoteSessionAdapter — transport methods POST with commandId', () => {
  let deps;
  beforeEach(() => { deps = makeDeps(); });

  it('pause POSTs to /session/transport with action=pause', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.transport.pause();
    // Let microtask flush
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/transport',
      expect.objectContaining({ action: 'pause', commandId: expect.any(String) }),
      'POST'
    );
  });

  it('seekAbs POSTs action=seekAbs with value=<seconds>', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.transport.seekAbs(12.5);
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/transport',
      expect.objectContaining({ action: 'seekAbs', value: 12.5, commandId: expect.any(String) }),
      'POST'
    );
  });

  it('config.setVolume PUTs to /session/volume with level', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.config.setVolume(75);
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/volume',
      expect.objectContaining({ level: 75, commandId: expect.any(String) }),
      'PUT'
    );
  });

  it('queue.playNow POSTs to /session/queue/play-now with contentId', async () => {
    const a = new RemoteSessionAdapter(deps);
    a.queue.playNow({ contentId: 'plex:99' }, { clearRest: true });
    await Promise.resolve();
    expect(deps.httpClient).toHaveBeenCalledWith(
      'api/v1/device/lr/session/queue/play-now',
      expect.objectContaining({ contentId: 'plex:99', clearRest: true, commandId: expect.any(String) }),
      'POST'
    );
  });
});
```

- [ ] **Step 2: Run → fail**

`cd frontend && npx vitest run src/modules/Media/peek/RemoteSessionAdapter.test.js`

- [ ] **Step 3: Impl**

```js
// frontend/src/modules/Media/peek/RemoteSessionAdapter.js
function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class RemoteSessionAdapter {
  constructor({ deviceId, httpClient, getSnapshot, subscribeAck }) {
    this._deviceId = deviceId;
    this._http = httpClient;
    this._getSnapshot = getSnapshot;
    this._subscribeAck = subscribeAck ?? null;
    this._pendingAcks = new Map(); // commandId → {resolve, reject, timeout}
  }

  getSnapshot() { return this._getSnapshot(); }

  _commandId() { return uuid(); }

  async _post(path, body) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId);
    const httpPromise = this._http(path, payload, 'POST');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  async _put(path, body) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId);
    const httpPromise = this._http(path, payload, 'PUT');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  _registerAck(commandId) {
    if (!this._subscribeAck) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingAcks.delete(commandId);
        reject(new Error(`ack-timeout:${commandId}`));
      }, 5000);
      this._pendingAcks.set(commandId, { resolve, reject, timeout });
    });
  }

  // Internal — called by PeekProvider when a device-ack message matches this adapter.
  _resolveAck({ commandId, ok, error }) {
    const pending = this._pendingAcks.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this._pendingAcks.delete(commandId);
    if (ok) pending.resolve({ ok });
    else pending.reject(new Error(error ?? 'ack-error'));
  }

  transport = {
    play: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'play' }),
    pause: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'pause' }),
    stop: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'stop' }),
    seekAbs: (seconds) => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekAbs', value: seconds }),
    seekRel: (delta) => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekRel', value: delta }),
    skipNext: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipNext' }),
    skipPrev: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipPrev' }),
  };

  queue = {
    playNow: (input, opts = {}) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-now`,
      { contentId: input.contentId, clearRest: !!opts.clearRest }
    ),
    playNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-next`,
      { contentId: input.contentId }
    ),
    addUpNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add-up-next`,
      { contentId: input.contentId }
    ),
    add: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add`,
      { contentId: input.contentId }
    ),
    reorder: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/reorder`,
      input
    ),
    remove: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/remove`,
      { queueItemId }
    ),
    jump: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/jump`,
      { queueItemId }
    ),
    clear: () => this._post(`api/v1/device/${this._deviceId}/session/queue/clear`, {}),
  };

  config = {
    setShuffle: (enabled) => this._put(`api/v1/device/${this._deviceId}/session/shuffle`, { enabled: !!enabled }),
    setRepeat: (mode) => this._put(`api/v1/device/${this._deviceId}/session/repeat`, { mode }),
    setShader: (shader) => this._put(`api/v1/device/${this._deviceId}/session/shader`, { shader: shader ?? null }),
    setVolume: (level) => this._put(`api/v1/device/${this._deviceId}/session/volume`, { level: Math.max(0, Math.min(100, Math.round(Number(level) || 0))) }),
  };

  lifecycle = {
    reset: () => { /* no-op for remote — spec doesn't define remote reset */ },
    adoptSnapshot: () => { /* no-op for remote — adoption is a Hand Off (P6) concern */ },
  };

  portability = {
    snapshotForHandoff: () => null,
    receiveClaim: () => { /* no-op */ },
  };
}

export default RemoteSessionAdapter;
```

- [ ] **Step 4: Run → all pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/peek/RemoteSessionAdapter.js frontend/src/modules/Media/peek/RemoteSessionAdapter.test.js
git commit -m "feat(media): RemoteSessionAdapter with transport+queue+config over REST+ack"
```

---

## Task 2: `PeekProvider` + `usePeek`

**Files:**
- Create: `frontend/src/modules/Media/peek/PeekProvider.jsx`
- Create: `frontend/src/modules/Media/peek/usePeek.js`
- Test: `frontend/src/modules/Media/peek/PeekProvider.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/peek/PeekProvider.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

const apiMock = vi.fn(async () => ({ ok: true }));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => apiMock(...a),
}));

let fleetCtx = {
  devices: [{ id: 'lr', name: 'Living Room' }],
  byDevice: new Map([['lr', { snapshot: { state: 'playing', sessionId: 'remote' }, isStale: false, offline: false }]]),
  loading: false, error: null, refresh: vi.fn(),
};
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

import { PeekProvider } from './PeekProvider.jsx';
import { usePeek } from './usePeek.js';

function Probe() {
  const { activePeeks, enterPeek, exitPeek } = usePeek();
  const ids = [...activePeeks.keys()].join(',');
  return (
    <div>
      <span data-testid="peeks">{ids}</span>
      <button data-testid="enter" onClick={() => enterPeek('lr')}>enter</button>
      <button data-testid="exit" onClick={() => exitPeek('lr')}>exit</button>
    </div>
  );
}

let capturedFilter = null;
beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ ok: true });
  subscribeFn.mockReset().mockImplementation((filter) => { capturedFilter = filter; return () => {}; });
});

describe('PeekProvider', () => {
  it('subscribes to device-ack:* on mount', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'device-ack:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(false);
  });

  it('enterPeek adds a controller to activePeeks', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    act(() => { screen.getByTestId('enter').click(); });
    expect(screen.getByTestId('peeks')).toHaveTextContent('lr');
  });

  it('exitPeek removes the controller', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    act(() => { screen.getByTestId('enter').click(); });
    act(() => { screen.getByTestId('exit').click(); });
    expect(screen.getByTestId('peeks')).toHaveTextContent('');
  });

  it('entering an unknown device does nothing', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    // There is no "ghost" device button in the probe; just verify activePeeks stays empty
    expect(screen.getByTestId('peeks')).toHaveTextContent('');
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl (two files)**

```jsx
// frontend/src/modules/Media/peek/PeekProvider.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { RemoteSessionAdapter } from './RemoteSessionAdapter.js';
import mediaLog from '../logging/mediaLog.js';

export const PeekContext = createContext(null);

function isAckMsg(msg) {
  return !!msg && typeof msg.topic === 'string' && msg.topic.startsWith('device-ack:');
}

export function PeekProvider({ children }) {
  const { devices, byDevice } = useFleetContext();
  const [activePeeks, setActivePeeks] = useState(new Map());
  const adaptersRef = useRef(new Map()); // deviceId → adapter

  useEffect(() => {
    const unsub = wsService.subscribe(isAckMsg, (msg) => {
      const { deviceId, commandId, ok, error } = msg;
      if (!deviceId || !commandId) return;
      const adapter = adaptersRef.current.get(deviceId);
      if (adapter) adapter._resolveAck({ commandId, ok, error });
    });
    return unsub;
  }, []);

  const enterPeek = useCallback((deviceId) => {
    const cfg = devices.find((d) => d.id === deviceId);
    if (!cfg) return null;
    let adapter = adaptersRef.current.get(deviceId);
    if (!adapter) {
      adapter = new RemoteSessionAdapter({
        deviceId,
        httpClient: DaylightAPI,
        getSnapshot: () => byDevice.get(deviceId)?.snapshot ?? null,
      });
      adaptersRef.current.set(deviceId, adapter);
    }
    setActivePeeks((prev) => {
      const next = new Map(prev);
      next.set(deviceId, { controller: adapter, enteredAt: new Date().toISOString() });
      return next;
    });
    mediaLog.peekEntered({ deviceId });
    return adapter;
  }, [devices, byDevice]);

  const exitPeek = useCallback((deviceId) => {
    setActivePeeks((prev) => {
      if (!prev.has(deviceId)) return prev;
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });
    mediaLog.peekExited({ deviceId });
  }, []);

  const getAdapter = useCallback((deviceId) => {
    return adaptersRef.current.get(deviceId) ?? null;
  }, []);

  const value = useMemo(
    () => ({ activePeeks, enterPeek, exitPeek, getAdapter }),
    [activePeeks, enterPeek, exitPeek, getAdapter]
  );

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

export function usePeekContext() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeekContext must be used inside PeekProvider');
  return ctx;
}

export default PeekProvider;
```

```js
// frontend/src/modules/Media/peek/usePeek.js
export { usePeekContext as usePeek } from './PeekProvider.jsx';
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/peek/PeekProvider.jsx frontend/src/modules/Media/peek/usePeek.js frontend/src/modules/Media/peek/PeekProvider.test.jsx
git commit -m "feat(media): PeekProvider manages active remote controllers + ack routing"
```

---

## Task 3: Extend `useSessionController` to route remote targets

**Files:**
- Modify: `frontend/src/modules/Media/session/useSessionController.js`
- Modify: `frontend/src/modules/Media/session/useSessionController.test.jsx`

- [ ] **Step 1: Update the test**

Read the current `useSessionController.test.jsx`. The "throws for unsupported target in P1" test needs to become "routes remote target to PeekProvider".

Replace the failing test (the one that asserts throws) with:

```jsx
  it('routes {deviceId} targets through PeekProvider getAdapter', () => {
    const fakeAdapter = {
      getSnapshot: () => ({ state: 'playing', config: { volume: 60 } }),
      transport: { play: vi.fn() },
      queue: {}, config: {}, lifecycle: {}, portability: {},
    };
    const wrapper = ({ children }) => (
      <PeekContext.Provider value={{ getAdapter: () => fakeAdapter, activePeeks: new Map(), enterPeek: vi.fn(), exitPeek: vi.fn() }}>
        {children}
      </PeekContext.Provider>
    );
    const { result } = renderHook(() => useSessionController({ deviceId: 'lr' }), { wrapper });
    expect(result.current.snapshot.state).toBe('playing');
    expect(typeof result.current.transport.play).toBe('function');
  });
```

Add the import at the top of the test file:

```jsx
import { PeekContext } from '../peek/PeekProvider.jsx';
```

- [ ] **Step 2: Update useSessionController.js**

Replace with:

```js
// frontend/src/modules/Media/session/useSessionController.js
import { useContext, useEffect, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PeekContext } from '../peek/PeekProvider.jsx';

function useLocalController() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('useSessionController(local) must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [snapshot, setSnapshot] = useState(adapter.getSnapshot());
  useEffect(() => {
    setSnapshot(adapter.getSnapshot());
    return adapter.subscribe(setSnapshot);
  }, [adapter]);
  return {
    snapshot,
    transport: adapter.transport,
    queue: adapter.queue,
    config: adapter.config,
    lifecycle: adapter.lifecycle,
    portability: adapter.portability,
  };
}

function useRemoteController(deviceId) {
  const peekCtx = useContext(PeekContext);
  if (!peekCtx) throw new Error('useSessionController({deviceId}) requires PeekProvider');
  const adapter = peekCtx.getAdapter(deviceId);
  if (!adapter) {
    // No adapter yet — return a read-only stub backed by no snapshot.
    return {
      snapshot: null,
      transport: {}, queue: {}, config: {}, lifecycle: {}, portability: {},
    };
  }
  return {
    snapshot: adapter.getSnapshot(),
    transport: adapter.transport,
    queue: adapter.queue,
    config: adapter.config,
    lifecycle: adapter.lifecycle,
    portability: adapter.portability,
  };
}

export function useSessionController(target) {
  if (target === 'local') return useLocalController();
  if (target && typeof target === 'object' && typeof target.deviceId === 'string') {
    return useRemoteController(target.deviceId);
  }
  throw new Error('useSessionController: target must be "local" or {deviceId}');
}

export default useSessionController;
```

- [ ] **Step 3: Run**

Run: `cd frontend && npx vitest run src/modules/Media/session/useSessionController.test.jsx`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Media/session/useSessionController.js frontend/src/modules/Media/session/useSessionController.test.jsx
git commit -m "feat(media): useSessionController routes remote targets through PeekProvider"
```

---

## Task 4: `PeekPanel` canvas view

**Files:**
- Create: `frontend/src/modules/Media/shell/PeekPanel.jsx`
- Test: `frontend/src/modules/Media/shell/PeekPanel.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// frontend/src/modules/Media/shell/PeekPanel.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const pauseFn = vi.fn();
const playFn = vi.fn();
const volumeFn = vi.fn();
let ctl = {
  snapshot: {
    state: 'playing',
    currentItem: { contentId: 'plex:1', title: 'Remote Song' },
    position: 0,
    config: { volume: 50 },
  },
  transport: { play: playFn, pause: pauseFn, stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
  config: { setVolume: volumeFn, setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn() },
  queue: {}, lifecycle: {}, portability: {},
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => ctl),
}));

const enterPeek = vi.fn();
const exitPeek = vi.fn();
vi.mock('../peek/usePeek.js', () => ({
  usePeek: vi.fn(() => ({ activePeeks: new Map([['lr', { controller: ctl }]]), enterPeek, exitPeek, getAdapter: vi.fn() })),
}));

import { PeekPanel } from './PeekPanel.jsx';

beforeEach(() => {
  pauseFn.mockClear();
  playFn.mockClear();
  volumeFn.mockClear();
  enterPeek.mockClear();
  exitPeek.mockClear();
});

describe('PeekPanel', () => {
  it('renders current item title and state', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('Remote Song');
    expect(screen.getByTestId('peek-panel')).toHaveTextContent('playing');
  });

  it('calls enterPeek on mount', () => {
    render(<PeekPanel deviceId="lr" />);
    expect(enterPeek).toHaveBeenCalledWith('lr');
  });

  it('Pause button calls controller.transport.pause', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-pause'));
    expect(pauseFn).toHaveBeenCalled();
  });

  it('Play button calls controller.transport.play', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.click(screen.getByTestId('peek-play'));
    expect(playFn).toHaveBeenCalled();
  });

  it('Volume input calls config.setVolume with a number', () => {
    render(<PeekPanel deviceId="lr" />);
    fireEvent.change(screen.getByTestId('peek-volume'), { target: { value: '80' } });
    expect(volumeFn).toHaveBeenCalledWith(80);
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Impl**

```jsx
// frontend/src/modules/Media/shell/PeekPanel.jsx
import React, { useEffect } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePeek } from '../peek/usePeek.js';

export function PeekPanel({ deviceId }) {
  const { enterPeek, exitPeek } = usePeek();
  useEffect(() => {
    enterPeek(deviceId);
    return () => exitPeek(deviceId);
  }, [deviceId, enterPeek, exitPeek]);

  const ctl = useSessionController({ deviceId });
  const snap = ctl.snapshot;

  if (!snap) return <div data-testid="peek-panel">Peek: no state for {deviceId}</div>;

  return (
    <div data-testid="peek-panel" className="peek-panel">
      <h2>Peek: {deviceId}</h2>
      <div>state: {snap.state}</div>
      <div>item: {snap.currentItem?.title ?? snap.currentItem?.contentId ?? 'nothing'}</div>
      <div className="peek-transport">
        <button data-testid="peek-play" onClick={ctl.transport.play}>Play</button>
        <button data-testid="peek-pause" onClick={ctl.transport.pause}>Pause</button>
        <button data-testid="peek-stop" onClick={ctl.transport.stop}>Stop</button>
        <button data-testid="peek-next" onClick={ctl.transport.skipNext}>Next</button>
        <button data-testid="peek-prev" onClick={ctl.transport.skipPrev}>Prev</button>
      </div>
      <div className="peek-config">
        <label>
          Volume: {snap.config?.volume ?? 50}
          <input
            type="range"
            min="0"
            max="100"
            value={snap.config?.volume ?? 50}
            onChange={(e) => ctl.config.setVolume(Number(e.target.value))}
            data-testid="peek-volume"
          />
        </label>
      </div>
    </div>
  );
}

export default PeekPanel;
```

- [ ] **Step 4: Run → 5/5 pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/shell/PeekPanel.jsx frontend/src/modules/Media/shell/PeekPanel.test.jsx
git commit -m "feat(media): PeekPanel canvas view with transport + volume controls"
```

---

## Task 5: Canvas + FleetView + MediaApp wiring

**Files:**
- Modify: `frontend/src/modules/Media/shell/Canvas.jsx`
- Modify: `frontend/src/modules/Media/shell/FleetView.jsx`
- Modify: `frontend/src/modules/Media/shell/FleetView.test.jsx`
- Modify: `frontend/src/Apps/MediaApp.jsx`
- Modify: `frontend/src/modules/Media/shell/MediaAppShell.test.jsx`

- [ ] **Step 1: Add `peek` case to Canvas**

Replace `renderView` switch in `frontend/src/modules/Media/shell/Canvas.jsx`:

```jsx
import { PeekPanel } from './PeekPanel.jsx';
// ...

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} modifiers={params.modifiers} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    case 'fleet': return <FleetView />;
    case 'peek': return <PeekPanel deviceId={params.deviceId} />;
    default: return <HomeView />;
  }
}
```

- [ ] **Step 2: Add Peek button to FleetView device cards**

Read `FleetView.jsx`. Inside each `<li data-testid={`fleet-card-${d.id}`}>` block, add a peek button at the end:

```jsx
              <button
                data-testid={`fleet-peek-${d.id}`}
                onClick={() => push('peek', { deviceId: d.id })}
              >
                Peek
              </button>
```

Add import at top of `FleetView.jsx`:

```jsx
import { useNav } from './NavProvider.jsx';
```

Inside `FleetView`, add:

```jsx
  const { push } = useNav();
```

Test update — `FleetView.test.jsx` doesn't currently mock `useNav`. Add a mock at the top:

```jsx
vi.mock('./NavProvider.jsx', () => ({
  useNav: vi.fn(() => ({ push: vi.fn(), pop: vi.fn(), replace: vi.fn(), view: 'fleet', params: {}, depth: 1 })),
}));
```

- [ ] **Step 3: Wire `<PeekProvider>` into `MediaApp.jsx`**

Replace:

```jsx
// frontend/src/Apps/MediaApp.jsx
import React from 'react';
import { ClientIdentityProvider } from '../modules/Media/session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../modules/Media/session/LocalSessionProvider.jsx';
import { FleetProvider } from '../modules/Media/fleet/FleetProvider.jsx';
import { PeekProvider } from '../modules/Media/peek/PeekProvider.jsx';
import { CastTargetProvider } from '../modules/Media/cast/CastTargetProvider.jsx';
import { DispatchProvider } from '../modules/Media/cast/DispatchProvider.jsx';
import { SearchProvider } from '../modules/Media/search/SearchProvider.jsx';
import { MediaAppShell } from '../modules/Media/shell/MediaAppShell.jsx';

export default function MediaApp() {
  return (
    <ClientIdentityProvider>
      <LocalSessionProvider>
        <FleetProvider>
          <PeekProvider>
            <CastTargetProvider>
              <DispatchProvider>
                <SearchProvider>
                  <MediaAppShell />
                </SearchProvider>
              </DispatchProvider>
            </CastTargetProvider>
          </PeekProvider>
        </FleetProvider>
      </LocalSessionProvider>
    </ClientIdentityProvider>
  );
}
```

- [ ] **Step 4: Update `MediaAppShell.test.jsx` to wrap in PeekProvider**

Add import at top:

```jsx
import { PeekProvider } from '../peek/PeekProvider.jsx';
```

In both `render(...)` blocks, wrap with `<PeekProvider>` just inside `<FleetProvider>`:

```jsx
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <FleetProvider>
            <PeekProvider>
              <CastTargetProvider>
                <DispatchProvider>
                  <SearchProvider>
                    <MediaAppShell />
                  </SearchProvider>
                </DispatchProvider>
              </CastTargetProvider>
            </PeekProvider>
          </FleetProvider>
        </LocalSessionProvider>
      </ClientIdentityProvider>
```

- [ ] **Step 5: Run**

`cd frontend && npx vitest run src/modules/Media src/Apps/MediaApp.test.jsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/shell/Canvas.jsx \
         frontend/src/modules/Media/shell/FleetView.jsx \
         frontend/src/modules/Media/shell/FleetView.test.jsx \
         frontend/src/Apps/MediaApp.jsx \
         frontend/src/modules/Media/shell/MediaAppShell.test.jsx
git commit -m "feat(media): Canvas peek view + FleetView Peek button + PeekProvider in MediaApp"
```

---

## Task 6: Playwright e2e — Peek

**Files:**
- Create: `tests/live/flow/media/media-app-peek.runtime.test.mjs`

- [ ] **Step 1: Write**

```javascript
// tests/live/flow/media/media-app-peek.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('MediaApp — P5 peek', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('FleetView has a Peek button per device that opens PeekPanel', async ({ page }) => {
    await page.goto('/media');
    await page.getByTestId('fleet-indicator').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });

    const peekBtn = page.locator('[data-testid^="fleet-peek-"]').first();
    await expect(peekBtn).toBeVisible({ timeout: 5000 });
    await peekBtn.click();

    await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 5000 });
    // Transport controls present
    await expect(page.getByTestId('peek-play')).toBeVisible();
    await expect(page.getByTestId('peek-pause')).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/live/flow/media/media-app-peek.runtime.test.mjs
git commit -m "test(media): e2e peek — Fleet card Peek button opens PeekPanel"
```

---

## Requirements traceability for P5

| Spec requirement | Task |
|---|---|
| C5.1 peek without disturbing local | Task 4 (PeekPanel enters/exits via usePeek) |
| C5.2 full transport in peek | Task 4 (play/pause/stop/seek/skip buttons) |
| C5.3 full queue ops in peek | Task 1 (queue methods on adapter — UI wiring beyond P5 scope) |
| C5.4 remote volume/shader | Task 1, 4 (setVolume, setShader) |
| C5.5 multiple peeks concurrent | Task 2 (activePeeks Map supports N) |
| N4.1 concurrent peek + local + dispatch | Task 2, 3 (separate adapter per deviceId; unchanged local) |
| N4.2 last-writer-wins at device | Task 1 (no client-side locking; REST is fire-and-forget + ack) |

---

## Known simplifications

- **No queue-op UI in PeekPanel v1.** Adapter exposes the surface; UI surfaces only transport + volume for P5. A full queue editor is a follow-up.
- **No shader dropdown in PeekPanel v1.** `config.setShader` exists on the adapter but no UI yet.
- **Ack timeout is a hard 5s.** On timeout the promise rejects but the UI state (snapshot) is unchanged — the device-state feed is authoritative. Acceptable for observation use cases.
- **Reset / Adopt on remote** — no-ops (those are P6 Session Portability concerns).
