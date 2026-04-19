# Media App Gap-Fills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four surgical gaps in the 2026-04-18 P1–P7 Media App skeleton: C9.3 stall detection, C7.3 position-tolerance observability on Take Over, C9.8 dispatch idempotency, and C10.5 sampled transport logging.

**Architecture:** Each gap is a tightly-scoped change against existing Media module infrastructure — no new modules, no cross-cutting refactor. The P1–P7 skeleton already wires the Player→adapter→log pipeline, FleetProvider, DispatchProvider, PeekProvider, and the `mediaLog` facade; these tasks add the missing trigger logic, one observability event, a dedup cache, and one sampled log entry.

**Out of scope:** `isLive` live-content semantics (needs brainstorming, tracked in a follow-up plan). Hand-Off drift enforcement (needs fleet-state correlation, follow-up). Dispatch-URL/adopt extensibility asymmetry (N5.3, design spike).

**Tech Stack:** React 18, Vitest + @testing-library/react, `mediaLog` facade over `lib/logging/Logger.js`, existing `LocalSessionAdapter` / `HiddenPlayerMount` / `DispatchProvider` / `useTakeOver`.

**Reference documents:**
- Requirements: `docs/reference/media/media-app-requirements.md` (C7.3, C9.3, C9.8, C10.5)
- Audit: `docs/_wip/audits/2026-04-18-media-app-requirement-coverage-audit.md`
- Skeleton spec: `docs/superpowers/specs/2026-04-18-media-app-skeleton-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/modules/Media/logging/mediaLog.js` | Modify | Add `playbackStallAutoAdvanced`, `takeoverDrift`, `dispatchDeduplicated`, `transportCommand` (sampled). |
| `frontend/src/modules/Media/session/LocalSessionAdapter.js` | Modify | Add `onPlayerStalled()` method that advances + logs; instrument `transport.seekAbs`/`seekRel` for sampled logging. |
| `frontend/src/modules/Media/session/LocalSessionAdapter.test.js` | Modify | Cover `onPlayerStalled` and transport-seek logging. |
| `frontend/src/modules/Media/session/HiddenPlayerMount.jsx` | Modify | Track `stalled` onset in the onProgress payload; fire `adapter.onPlayerStalled()` when persistence crosses threshold. |
| `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx` | Modify | Cover stall threshold + recovery. |
| `frontend/src/modules/Media/peek/useTakeOver.js` | Modify | After `receiveClaim`, schedule one-shot position-drift check against snapshot position; log `takeover.drift` if > 2s. |
| `frontend/src/modules/Media/peek/useTakeOver.test.jsx` | Create | Cover drift-logged and no-drift paths. |
| `frontend/src/modules/Media/cast/DispatchProvider.jsx` | Modify | Add a 5s dedup cache keyed by `{sortedTargetIds, play \|\| queue, mode}`; short-circuit + log when hit. |
| `frontend/src/modules/Media/cast/DispatchProvider.test.jsx` | Modify | Cover dedup within-window and fresh-after-window paths. |

---

## Task 1: `mediaLog` — add four new event emitters

**Files:**
- Modify: `frontend/src/modules/Media/logging/mediaLog.js`
- Test: `frontend/src/modules/Media/logging/mediaLog.test.js`

- [ ] **Step 1.1: Write the failing test**

Append to `frontend/src/modules/Media/logging/mediaLog.test.js`:

```javascript
describe('mediaLog — gap-fill events', () => {
  it('exposes playbackStallAutoAdvanced as a warn emitter', () => {
    expect(typeof mediaLog.playbackStallAutoAdvanced).toBe('function');
    mediaLog.playbackStallAutoAdvanced({ sessionId: 's', contentId: 'p:1', stalledMs: 10500 });
    // Smoke: must not throw
  });

  it('exposes takeoverDrift as a warn emitter', () => {
    expect(typeof mediaLog.takeoverDrift).toBe('function');
    mediaLog.takeoverDrift({ deviceId: 'lr', expected: 120, actual: 115.2, driftSeconds: 4.8 });
  });

  it('exposes dispatchDeduplicated as an info emitter', () => {
    expect(typeof mediaLog.dispatchDeduplicated).toBe('function');
    mediaLog.dispatchDeduplicated({ keyHash: 'abc', targetIds: ['lr'], windowMs: 5000 });
  });

  it('exposes transportCommand as a sampled emitter (seek-safe)', () => {
    expect(typeof mediaLog.transportCommand).toBe('function');
    for (let i = 0; i < 200; i += 1) {
      mediaLog.transportCommand({ action: 'seekAbs', value: i, target: 'local' });
    }
    // No throw; sampling handled by Logger.
  });
});
```

- [ ] **Step 1.2: Run test; confirm fail**

```
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Media/logging/mediaLog.test.js
```
Expected: four failures, one per new event (undefined function).

- [ ] **Step 1.3: Add events to `mediaLog.js`**

Replace the trailing block of `frontend/src/modules/Media/logging/mediaLog.js` (the `export const mediaLog = { ... };` object). Add exactly these four lines alongside the existing entries; leave everything else intact:

```javascript
  playbackStallAutoAdvanced: warn('playback.stall-auto-advanced'),
  takeoverDrift:             warn('takeover.drift'),
  dispatchDeduplicated:      info('dispatch.deduplicated'),
  transportCommand:          sampled('transport.command', { maxPerMinute: 60, aggregate: true }),
```

Insertion points:
- `playbackStallAutoAdvanced`: immediately after the existing `playbackStalled` line.
- `takeoverDrift`: immediately after `takeoverFailed`.
- `dispatchDeduplicated`: immediately after `dispatchFailed`.
- `transportCommand`: at the end of the object, before the closing brace.

- [ ] **Step 1.4: Run test; confirm pass**

```
npx vitest run frontend/src/modules/Media/logging/mediaLog.test.js
```
Expected: all passing, including the four new assertions.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/src/modules/Media/logging/mediaLog.js frontend/src/modules/Media/logging/mediaLog.test.js
git commit -m "feat(media): mediaLog gap-fill events for stall, drift, dedup, transport"
```

---

## Task 2: `LocalSessionAdapter.onPlayerStalled()` — auto-advance + log

**Files:**
- Modify: `frontend/src/modules/Media/session/LocalSessionAdapter.js`
- Test: `frontend/src/modules/Media/session/LocalSessionAdapter.test.js`

- [ ] **Step 2.1: Write the failing test**

Append to `frontend/src/modules/Media/session/LocalSessionAdapter.test.js`:

```javascript
import mediaLog from '../logging/mediaLog.js';
vi.mock('../logging/mediaLog.js', () => {
  const fns = [
    'mounted','unmounted','sessionCreated','sessionReset','sessionResumed',
    'sessionStateChange','sessionPersisted','queueMutated','playbackStarted',
    'playbackStalled','playbackStallAutoAdvanced','playbackError','playbackAdvanced',
    'searchIssued','searchResultChunk','searchCompleted','dispatchInitiated',
    'dispatchStep','dispatchSucceeded','dispatchFailed','dispatchDeduplicated',
    'peekEntered','peekExited','peekCommand','peekCommandAck',
    'takeoverInitiated','takeoverSucceeded','takeoverFailed','takeoverDrift',
    'handoffInitiated','handoffSucceeded','handoffFailed',
    'wsConnected','wsDisconnected','wsReconnected','wsStale',
    'externalControlReceived','externalControlRejected','urlCommandProcessed',
    'urlCommandIgnored','transportCommand',
  ];
  const stub = {};
  for (const k of fns) stub[k] = vi.fn();
  return { default: stub, mediaLog: stub };
});

describe('LocalSessionAdapter.onPlayerStalled', () => {
  it('transitions state to stalled, logs, and advances to the next queue item', () => {
    const a = new LocalSessionAdapter(makeDeps());
    // Seed a 2-item queue and currentIndex=0
    a.queue.playNow({ contentId: 'p:1', format: 'video', title: 'A', duration: 60 });
    a.queue.add({ contentId: 'p:2', format: 'video', title: 'B', duration: 60 });
    a._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });

    a.onPlayerStalled({ stalledMs: 10500 });

    expect(mediaLog.playbackStallAutoAdvanced).toHaveBeenCalledTimes(1);
    expect(mediaLog.playbackStallAutoAdvanced.mock.calls[0][0]).toMatchObject({
      stalledMs: 10500,
      contentId: 'p:1',
    });
    // Auto-advance landed on p:2
    expect(a.getSnapshot().currentItem.contentId).toBe('p:2');
  });

  it('is a no-op when no current item exists', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.onPlayerStalled({ stalledMs: 10500 });
    expect(mediaLog.playbackStallAutoAdvanced).not.toHaveBeenCalled();
    expect(a.getSnapshot().state).toBe('idle');
  });
});
```

Note: the `vi.mock` block for `mediaLog` must be placed at module top, not inside the describe. If the file already has a `mediaLog` mock, extend it rather than duplicating. If not, add the mock block just below the existing top-level imports.

- [ ] **Step 2.2: Run test; confirm fail**

```
npx vitest run frontend/src/modules/Media/session/LocalSessionAdapter.test.js
```
Expected: both new tests fail — `onPlayerStalled` is undefined.

- [ ] **Step 2.3: Implement `onPlayerStalled` in `LocalSessionAdapter.js`**

Add two imports at the top (the file currently imports `reduce`, `qOps`, `pickNextQueueItem`, `createIdleSessionSnapshot`):

```javascript
import mediaLog from '../logging/mediaLog.js';
```

Add the method just below the existing `onPlayerError` method (around line 172):

```javascript
  onPlayerStalled({ stalledMs } = {}) {
    const current = this._snapshot.currentItem;
    if (!current) return;
    mediaLog.playbackStallAutoAdvanced({
      sessionId: this._snapshot.sessionId,
      contentId: current.contentId,
      stalledMs: typeof stalledMs === 'number' ? stalledMs : null,
    });
    this._dispatch({ type: 'PLAYER_STATE', playerState: 'stalled' });
    this._advance('stall-auto-advance');
  }
```

Also instrument `transport.seekAbs` and `transport.seekRel` for Task 4. Inside the constructor's `this.transport = { ... }` block, replace the two seek entries with:

```javascript
      seekAbs: (seconds) => {
        mediaLog.transportCommand({ action: 'seekAbs', value: seconds, target: 'local' });
        this._playerCallbacks.onSeekRequest?.(seconds);
        this._dispatch({ type: 'UPDATE_POSITION', position: seconds });
      },
      seekRel: (delta) => {
        mediaLog.transportCommand({ action: 'seekRel', value: delta, target: 'local' });
        const current = this._snapshot.position ?? 0;
        this.transport.seekAbs(Math.max(0, current + delta));
      },
```

(`seekRel` already logs via its call into `seekAbs`; the extra `transportCommand` here records the relative-seek intent — the two events are distinguishable by `action`.)

- [ ] **Step 2.4: Run test; confirm pass**

```
npx vitest run frontend/src/modules/Media/session/LocalSessionAdapter.test.js
```
Expected: all passing.

- [ ] **Step 2.5: Commit**

```bash
git add frontend/src/modules/Media/session/LocalSessionAdapter.js frontend/src/modules/Media/session/LocalSessionAdapter.test.js
git commit -m "feat(media): LocalSessionAdapter.onPlayerStalled + transport command logging"
```

---

## Task 3: `HiddenPlayerMount` — stall-threshold detection

**Files:**
- Modify: `frontend/src/modules/Media/session/HiddenPlayerMount.jsx`
- Test: `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx`

The Player already emits `stalled: boolean` in its `onProgress` payload (`frontend/src/modules/Player/hooks/useCommonMediaController.js:981`). Today HiddenPlayerMount reads `currentTime` and `paused` but ignores `stalled`. Add a one-shot timer that fires `adapter.onPlayerStalled()` when `stalled===true` has persisted for `STALL_THRESHOLD_MS`.

- [ ] **Step 3.1: Write the failing test**

Open `frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx`. Add a new describe block at the bottom of the file:

```javascript
describe('HiddenPlayerMount — stall detection', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls adapter.onPlayerStalled after STALL_THRESHOLD_MS of continuous stalled=true', () => {
    const adapter = makeAdapterMock(); // existing helper in file
    render(<LocalSessionContext.Provider value={{ adapter }}>
      <HiddenPlayerMount />
    </LocalSessionContext.Provider>);

    // Fake Player onProgress firing stalled=true repeatedly
    act(() => {
      capturedOnProgress({ currentTime: 10, paused: false, stalled: true });
    });
    act(() => { vi.advanceTimersByTime(5000); });
    // 5s in, not yet past threshold
    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(5500); }); // total 10.5s
    expect(adapter.onPlayerStalled).toHaveBeenCalledTimes(1);
    expect(adapter.onPlayerStalled.mock.calls[0][0]).toMatchObject({ stalledMs: expect.any(Number) });
  });

  it('clears the pending stall timer when stalled becomes false', () => {
    const adapter = makeAdapterMock();
    render(<LocalSessionContext.Provider value={{ adapter }}>
      <HiddenPlayerMount />
    </LocalSessionContext.Provider>);

    act(() => { capturedOnProgress({ currentTime: 10, paused: false, stalled: true }); });
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { capturedOnProgress({ currentTime: 12, paused: false, stalled: false }); });
    act(() => { vi.advanceTimersByTime(10000); });

    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();
  });
});
```

If the existing file does not export a `capturedOnProgress` helper, add a shared pattern by vi-mocking `Player.jsx`:

```javascript
let capturedOnProgress = null;
vi.mock('../../Player/Player.jsx', () => ({
  __esModule: true,
  default: (props) => {
    capturedOnProgress = props.onProgress;
    return null;
  },
}));
```

And `makeAdapterMock` should be a small factory in the file (inspect the existing test for precedent; copy its shape and add `onPlayerStalled: vi.fn()`).

- [ ] **Step 3.2: Run test; confirm fail**

```
npx vitest run frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx
```
Expected: both new tests fail — `onPlayerStalled` never called because no detection code exists.

- [ ] **Step 3.3: Add stall tracking in `HiddenPlayerMount.jsx`**

Add the constant at the top (alongside `POSITION_PERSIST_INTERVAL_S`):

```javascript
const STALL_THRESHOLD_MS = 10_000; // Spec C9.3: persistent stall = no progress 10s while unpaused
```

Inside the component, add a ref + cleanup effect (just below `const hasStartedRef = useRef(false);`):

```javascript
  const stallTimerRef = useRef(null);
  const stallStartedAtRef = useRef(null);

  useEffect(() => () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);
```

Modify the existing `onProgress` callback. Locate the `const isPaused = ...` line and append, before the `const delta = ...` block:

```javascript
    const isStalled = typeof payload === 'object' && payload !== null
      ? !!payload.stalled : false;
    if (isStalled && !isPaused) {
      if (!stallTimerRef.current) {
        stallStartedAtRef.current = Date.now();
        stallTimerRef.current = setTimeout(() => {
          const stalledMs = Date.now() - (stallStartedAtRef.current ?? Date.now());
          stallTimerRef.current = null;
          stallStartedAtRef.current = null;
          adapter.onPlayerStalled({ stalledMs });
        }, STALL_THRESHOLD_MS);
      }
    } else if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }
```

Also clear the stall timer inside the current-item-change effect (the `useEffect` with `[currentItem?.contentId]`):

```javascript
  useEffect(() => {
    lastPersistedPosition.current = 0;
    hasStartedRef.current = false;
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }
  }, [currentItem?.contentId]);
```

- [ ] **Step 3.4: Run test; confirm pass**

```
npx vitest run frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx
```
Expected: all passing.

- [ ] **Step 3.5: Run the whole Media suite**

```
npx vitest run frontend/src/modules/Media/
```
Expected: all existing tests still green.

- [ ] **Step 3.6: Commit**

```bash
git add frontend/src/modules/Media/session/HiddenPlayerMount.jsx frontend/src/modules/Media/session/HiddenPlayerMount.test.jsx
git commit -m "feat(media): wire stall detection — 10s threshold triggers onPlayerStalled"
```

---

## Task 4: `useTakeOver` — position-drift check

**Files:**
- Modify: `frontend/src/modules/Media/peek/useTakeOver.js`
- Test: `frontend/src/modules/Media/peek/useTakeOver.test.jsx` (the file already exists; audit commit `44a5250b` added tests for the happy path).

After `local.portability.receiveClaim(snapshot)`, schedule a one-shot check at `DRIFT_CHECK_DELAY_MS = 1500`. Read the local snapshot via the same controller; if `|localPosition − expectedPosition| > TOLERANCE_SECONDS`, log `takeover.drift`. `expectedPosition` is `snapshot.position + DRIFT_CHECK_DELAY_MS / 1000` (i.e., where playback should have reached if it resumed instantly).

- [ ] **Step 4.1: Write the failing test**

Append to `frontend/src/modules/Media/peek/useTakeOver.test.jsx`:

```javascript
describe('useTakeOver — position drift observability', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('logs takeover.drift when local position diverges >2s from expected', async () => {
    // Remote snapshot claims position=120. Local will adopt but report 115 at +1.5s.
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: {
      sessionId: 'r1', state: 'paused', currentItem: { contentId: 'p:1', format: 'video' },
      position: 120, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'lr', updatedAt: '' },
    }});
    localCtrl.portability.receiveClaim = vi.fn(() => {
      // Simulate local adapter reporting a mis-set position
      localCtrl.snapshot = { ...localCtrl.snapshot, position: 115 };
    });

    const { result } = renderHook(() => useTakeOver(), { wrapper: Wrapper });
    await act(async () => { await result.current('lr'); });
    act(() => { vi.advanceTimersByTime(1600); });

    expect(mediaLog.takeoverDrift).toHaveBeenCalledTimes(1);
    const [payload] = mediaLog.takeoverDrift.mock.calls[0];
    expect(payload.deviceId).toBe('lr');
    expect(payload.driftSeconds).toBeGreaterThan(2);
  });

  it('does not log drift when within tolerance', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, snapshot: {
      sessionId: 'r1', state: 'paused', currentItem: { contentId: 'p:1', format: 'video' },
      position: 120, queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'lr', updatedAt: '' },
    }});
    localCtrl.portability.receiveClaim = vi.fn(() => {
      localCtrl.snapshot = { ...localCtrl.snapshot, position: 121.2 };
    });

    const { result } = renderHook(() => useTakeOver(), { wrapper: Wrapper });
    await act(async () => { await result.current('lr'); });
    act(() => { vi.advanceTimersByTime(1600); });

    expect(mediaLog.takeoverDrift).not.toHaveBeenCalled();
  });
});
```

If the existing `useTakeOver.test.jsx` does not already expose a `Wrapper` and `localCtrl` shape, mirror the mocking strategy from `DispatchProvider.test.jsx` (`vi.mock('../session/useSessionController.js', ...)`) and add a `snapshot` property to the controller mock so the drift check can read it. Extend the existing mediaLog mock to include `takeoverDrift: vi.fn()`.

- [ ] **Step 4.2: Run test; confirm fail**

```
npx vitest run frontend/src/modules/Media/peek/useTakeOver.test.jsx
```
Expected: first test fails — `takeoverDrift` never called.

- [ ] **Step 4.3: Implement drift check in `useTakeOver.js`**

Replace the entire contents of `frontend/src/modules/Media/peek/useTakeOver.js` with:

```javascript
import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

const DRIFT_CHECK_DELAY_MS = 1500;
const DRIFT_TOLERANCE_SECONDS = 2;

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTakeOver() {
  const local = useSessionController('local');
  return useCallback(async (deviceId) => {
    const commandId = uuid();
    mediaLog.takeoverInitiated({ deviceId, sessionId: null });
    try {
      const res = await DaylightAPI(`api/v1/device/${deviceId}/session/claim`, { commandId }, 'POST');
      if (res?.ok && res.snapshot) {
        const expectedPosition = (res.snapshot.position ?? 0) + DRIFT_CHECK_DELAY_MS / 1000;
        local.portability?.receiveClaim?.(res.snapshot);
        mediaLog.takeoverSucceeded({ deviceId, sessionId: res.snapshot?.sessionId, position: res.snapshot?.position });
        setTimeout(() => {
          const actual = local.snapshot?.position ?? 0;
          const driftSeconds = Math.abs(actual - expectedPosition);
          if (driftSeconds > DRIFT_TOLERANCE_SECONDS) {
            mediaLog.takeoverDrift({
              deviceId,
              expected: expectedPosition,
              actual,
              driftSeconds,
              toleranceSeconds: DRIFT_TOLERANCE_SECONDS,
            });
          }
        }, DRIFT_CHECK_DELAY_MS);
        return { ok: true };
      }
      mediaLog.takeoverFailed({ deviceId, error: res?.error ?? 'unknown' });
      return { ok: false, error: res?.error ?? 'claim-failed' };
    } catch (err) {
      mediaLog.takeoverFailed({ deviceId, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }, [local]);
}

export default useTakeOver;
```

- [ ] **Step 4.4: Run test; confirm pass**

```
npx vitest run frontend/src/modules/Media/peek/useTakeOver.test.jsx
```
Expected: all passing (both new tests + any prior happy-path tests).

- [ ] **Step 4.5: Commit**

```bash
git add frontend/src/modules/Media/peek/useTakeOver.js frontend/src/modules/Media/peek/useTakeOver.test.jsx
git commit -m "feat(media): takeover drift observability — log drift > 2s vs expected"
```

---

## Task 5: `DispatchProvider` — 5s dedup cache

**Files:**
- Modify: `frontend/src/modules/Media/cast/DispatchProvider.jsx`
- Test: `frontend/src/modules/Media/cast/DispatchProvider.test.jsx`

Build a deterministic cache key from `{ [...targetIds].sort().join(','), play ?? queue ?? 'adopt', mode ?? 'transfer' }`. Store `{ ts, dispatchIds }` in a `Map` held by a ref. On `dispatchToTarget`, check the cache — if a matching entry exists and `Date.now() - ts < DEDUP_WINDOW_MS`, log `dispatch.deduplicated` and return the cached dispatch IDs without re-firing. Otherwise proceed as today and store the new entry.

- [ ] **Step 5.1: Write the failing test**

Append to `frontend/src/modules/Media/cast/DispatchProvider.test.jsx`. Use fake timers so the dedup window is controllable:

```javascript
describe('DispatchProvider — idempotency', () => {
  beforeEach(() => { vi.useFakeTimers(); apiMock.mockResolvedValue({ ok: true, totalElapsedMs: 1 }); });
  afterEach(() => { vi.useRealTimers(); });

  it('deduplicates identical dispatches within the 5s window', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    await act(async () => { screen.getByTestId('fire').click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { screen.getByTestId('fire').click(); });
    // Still only one HTTP call
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('re-fires the dispatch after the window elapses', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    await act(async () => { screen.getByTestId('fire').click(); });
    await act(async () => { vi.advanceTimersByTime(6000); });
    await act(async () => { screen.getByTestId('fire').click(); });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5.2: Run test; confirm fail**

```
npx vitest run frontend/src/modules/Media/cast/DispatchProvider.test.jsx
```
Expected: first new test fails (two HTTP calls instead of one).

- [ ] **Step 5.3: Implement dedup in `DispatchProvider.jsx`**

At module top (below the existing `isHomelineMsg` helper), add:

```javascript
const DEDUP_WINDOW_MS = 5000;

function buildDedupKey({ targetIds, play, queue, mode }) {
  const ids = [...targetIds].sort().join(',');
  const content = play ?? queue ?? 'adopt';
  return `${ids}|${content}|${mode ?? 'transfer'}`;
}
```

Inside `DispatchProvider`, just below `const lastAttemptRef = useRef(null);`, add:

```javascript
  const dedupCacheRef = useRef(new Map());
```

Wrap the existing body of `dispatchToTarget` with a dedup check. Modified function:

```javascript
  const dispatchToTarget = useCallback(async ({ targetIds, play, queue, mode, shader, volume, shuffle, snapshot }) => {
    if (!Array.isArray(targetIds) || targetIds.length === 0) return [];

    const key = buildDedupKey({ targetIds, play, queue, mode });
    const cached = dedupCacheRef.current.get(key);
    if (cached && Date.now() - cached.ts < DEDUP_WINDOW_MS) {
      mediaLog.dispatchDeduplicated({
        targetIds,
        mode: mode ?? 'transfer',
        windowMs: DEDUP_WINDOW_MS,
        firstDispatchIds: cached.dispatchIds,
      });
      return cached.dispatchIds;
    }

    const isAdopt = mode === 'adopt';
    const contentId = play ?? queue ?? (isAdopt ? (snapshot?.currentItem?.contentId ?? 'adopt-snapshot') : null);
    const dispatchIds = [];
    lastAttemptRef.current = { targetIds, play, queue, mode, shader, volume, shuffle, snapshot };

    for (const deviceId of targetIds) {
      const dispatchId = uuid();
      dispatchIds.push(dispatchId);
      dispatch({ type: 'INITIATED', dispatchId, deviceId, contentId, mode: mode ?? 'transfer' });
      mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });

      const httpPromise = isAdopt
        ? DaylightAPI(`api/v1/device/${deviceId}/load`, { dispatchId, snapshot, mode: 'adopt' }, 'POST')
        : DaylightAPI(buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle }));
      httpPromise
        .then((res) => {
          if (res?.ok) {
            dispatch({ type: 'SUCCEEDED', dispatchId, totalElapsedMs: res.totalElapsedMs ?? null });
            mediaLog.dispatchSucceeded({ dispatchId, totalElapsedMs: res.totalElapsedMs });
            if (mode === 'transfer') {
              try { controllerRef.current?.transport?.stop?.(); } catch { /* ignore */ }
            }
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

    dedupCacheRef.current.set(key, { ts: Date.now(), dispatchIds });
    return dispatchIds;
  }, []);
```

Leave `retryLast` unchanged — retries bypass dedup by design (user explicitly asked to retry).

- [ ] **Step 5.4: Run test; confirm pass**

```
npx vitest run frontend/src/modules/Media/cast/DispatchProvider.test.jsx
```
Expected: all passing.

- [ ] **Step 5.5: Commit**

```bash
git add frontend/src/modules/Media/cast/DispatchProvider.jsx frontend/src/modules/Media/cast/DispatchProvider.test.jsx
git commit -m "feat(media): DispatchProvider 5s dedup window for identical casts"
```

---

## Task 6: Full-suite regression + summary commit

- [ ] **Step 6.1: Run the whole Media test suite**

```
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Media/
```
Expected: all existing + new tests green.

- [ ] **Step 6.2: Run any e2e tests still in the repo for the Media App**

```
npx playwright test tests/live/flow/ --reporter=line --grep=media
```
Expected: no regressions. If Playwright isn't reachable because the dev server isn't running, start it first:
```
node backend/index.js &
```
and confirm `curl http://localhost:3112/api/v1/device/config` returns JSON before re-running.

- [ ] **Step 6.3: Update the audit with a completion note**

Open `docs/_wip/audits/2026-04-18-media-app-requirement-coverage-audit.md`. Under the "Top gaps" section, annotate the four closed items:

```markdown
1. ~~**C9.3 stall detection is a stub.**~~ **CLOSED** 2026-04-18 — wired in `HiddenPlayerMount` + `LocalSessionAdapter.onPlayerStalled`.
2. ~~**C7.3 position tolerance is un-enforced.**~~ **PARTIALLY CLOSED** 2026-04-18 — Take Over drift is logged (`mediaLog.takeoverDrift`); Hand Off drift awaits fleet-correlation follow-up.
3. **Live content awareness is absent.** Follow-up plan pending brainstorming.
4. ~~**C9.8 dispatch idempotency gap.**~~ **CLOSED** 2026-04-18 — 5s dedup window in `DispatchProvider`.
5. ~~**C10.5 scrub/seek logging missing.**~~ **CLOSED** 2026-04-18 — `mediaLog.transportCommand` sampled 60/min; emitted from local `seekAbs`/`seekRel`.
```

Leave gaps 6, 7, 8 unchanged.

- [ ] **Step 6.4: Commit**

```bash
git add docs/_wip/audits/2026-04-18-media-app-requirement-coverage-audit.md
git commit -m "docs(media): annotate resolved gaps in 2026-04-18 coverage audit"
```

---

## Self-review checklist

- **Spec coverage:** The four in-scope requirements (C7.3 Take Over side, C9.3, C9.8, C10.5) each map to a dedicated task. Out-of-scope items (isLive, Hand Off drift, N5.3 / N1.1 / C4.3) are explicitly listed at the top.
- **Placeholder scan:** No TBDs; every code block shows real code; no "similar to Task N" references; type names (`stallTimerRef`, `stallStartedAtRef`, `dedupCacheRef`, `DRIFT_TOLERANCE_SECONDS`, `DEDUP_WINDOW_MS`, `STALL_THRESHOLD_MS`) are consistent across tasks.
- **Type/signature consistency:** `adapter.onPlayerStalled({ stalledMs })` is introduced in Task 2 and consumed by Task 3 with the same shape. `mediaLog.transportCommand({ action, value, target })` introduced in Task 1 is consumed in Task 2 with that exact shape. `mediaLog.takeoverDrift({ deviceId, expected, actual, driftSeconds, toleranceSeconds })` introduced in Task 1 matches Task 4. `mediaLog.dispatchDeduplicated({ targetIds, mode, windowMs, firstDispatchIds })` introduced in Task 1 matches Task 5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-media-app-gap-fills.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
