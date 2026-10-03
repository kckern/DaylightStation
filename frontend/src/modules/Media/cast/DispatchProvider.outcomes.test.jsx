// RELY.1a/2a/3a/6a — DispatchProvider is the single outcome system for /media.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const DaylightAPI = vi.fn();
let homelineCallback = null;
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => DaylightAPI(...a) }));
vi.mock('../net/ws.js', () => ({
  subscribeTopicKind: (_kind, callback) => { homelineCallback = callback; return () => {}; },
  parseDeviceTopic: (topic) => {
    if (typeof topic !== 'string') return null;
    const separator = topic.indexOf(':');
    return separator < 0 ? null : { kind: topic.slice(0, separator), deviceId: topic.slice(separator + 1) };
  },
}));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import mediaLog from '../logging/mediaLog.js';
import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { createFleetStore } from '../fleet/fleetStore.js';
import { PeekContext } from '../peek/PeekContext.js';

const arrival = { contentId: 'plex:55854', title: 'Arrival' };
const disclosure = { contentId: 'plex:697368', title: 'Disclosure Day' };

const controllers = new Map();
const peekValue = { getController: (id) => {
  if (!controllers.has(id)) controllers.set(id, { transport: { stop: vi.fn(() => Promise.resolve({ ok: true })) }, undo: vi.fn() });
  return controllers.get(id);
} };
function harness() {
  const store = createFleetStore();
  const wrapper = ({ children }) => (
    <FleetContext.Provider value={{ store, devices: [] }}>
      <PeekContext.Provider value={peekValue}>
        <DispatchProvider>{children}</DispatchProvider>
      </PeekContext.Provider>
    </FleetContext.Provider>
  );
  return { store, ...renderHook(() => useDispatch(), { wrapper }) };
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  homelineCallback = null;
});
afterEach(() => vi.useRealTimers());

describe('DispatchProvider outcomes', () => {
  it('retries the selected failed attempt, not the latest attempt', async () => {
    DaylightAPI.mockResolvedValue({ ok: false, error: 'receiver rejected', failedStep: 'load' });
    const { result } = harness();
    let first; let second;
    await act(async () => {
      [first] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork', title: arrival.title });
      [second] = await result.current.dispatchToTarget({ targetIds: ['browser-screen'], play: disclosure.contentId, mode: 'fork', title: disclosure.title });
    });
    await settle();
    expect(result.current.outcomes.get(first)).toEqual(expect.objectContaining({ attemptId: first, targetId: 'office', phase: 'failed' }));
    expect(result.current.outcomes.get(second)).toEqual(expect.objectContaining({ attemptId: second, targetId: 'browser-screen' }));

    DaylightAPI.mockClear();
    DaylightAPI.mockReturnValue(new Promise(() => {}));
    await act(async () => { await result.current.retry(first); });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const url = new URL(DaylightAPI.mock.calls[0][0], 'http://daylight.test');
    expect(url.pathname).toBe('/api/v1/device/office/load');
    expect(url.searchParams.get('play')).toBe(arrival.contentId);
    expect(mediaLog.outcomeRetried).toHaveBeenCalledWith(expect.objectContaining({ attemptId: first, targetId: 'office' }));
  });

  it('sends a failed attempt to another chosen screen with the same item, and only there', async () => {
    DaylightAPI.mockResolvedValue({ ok: false, error: 'receiver rejected', failedStep: 'load' });
    const { result } = harness();
    let failed;
    await act(async () => {
      [failed] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork', title: arrival.title });
    });
    await settle();
    DaylightAPI.mockClear();
    DaylightAPI.mockReturnValue(new Promise(() => {}));
    await act(async () => { await result.current.sendElsewhere(failed, 'den-tv'); });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const url = new URL(DaylightAPI.mock.calls[0][0], 'http://daylight.test');
    expect(url.pathname).toBe('/api/v1/device/den-tv/load');
    expect(url.searchParams.get('play')).toBe(arrival.contentId);
  });

  it('asks the backend never to retry a failed dispatch on its own', async () => {
    DaylightAPI.mockReturnValue(new Promise(() => {}));
    const { result } = harness();
    await act(async () => { await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork' }); });
    const url = new URL(DaylightAPI.mock.calls[0][0], 'http://daylight.test');
    expect(url.searchParams.get('deferredRetry')).toBe('0');
  });

  it('an undeliverable attempt reads Not sent and is never replayed later', async () => {
    DaylightAPI.mockResolvedValue({ ok: false, error: 'Device offline', failedStep: 'prepare' });
    const { result } = harness();
    let id;
    await act(async () => { [id] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork' }); });
    await settle();
    expect(result.current.outcomes.get(id).phase).toBe('not-sent');
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    await settle();
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });

  it('clears an unconfirmed start when that screen reports the item playing', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const { result, store } = harness();
    let id;
    await act(async () => { [id] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork', title: arrival.title }); });
    await settle();
    act(() => homelineCallback({ dispatchId: id, topic: 'homeline:office', step: 'playback', status: 'timeout' }));
    expect(result.current.outcomes.get(id).phase).toBe('unconfirmed');
    act(() => store.receive({ deviceId: 'office', snapshot: { state: 'playing', currentItem: { contentId: arrival.contentId } } }));
    expect(result.current.outcomes.get(id).phase).toBe('confirmed');
    expect(mediaLog.outcomeCleared).toHaveBeenCalledWith(expect.objectContaining({ attemptId: id, targetId: 'office' }));
  });

  it('a homeline step for another screen never updates this attempt', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const { result } = harness();
    let id;
    await act(async () => { [id] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork' }); });
    await settle();
    act(() => homelineCallback({ dispatchId: id, topic: 'homeline:den-tv', step: 'playback', status: 'confirmed' }));
    expect(result.current.outcomes.get(id).phase).toBe('sent');
  });

  it('records a quiet local outcome through the same system', () => {
    const { result } = harness();
    let attemptId;
    act(() => { attemptId = result.current.recordLocal({ kind: 'play', phase: 'confirmed', item: arrival, command: { kind: 'playNow', item: arrival } }); });
    expect(result.current.outcomes.get(attemptId)).toEqual(expect.objectContaining({ targetId: 'local', distance: 'here', phase: 'confirmed' }));
    expect(mediaLog.outcomeRecorded).toHaveBeenCalledWith(expect.objectContaining({ attemptId, targetId: 'local', phase: 'confirmed' }));
  });

  it('O1: Stop on an in-flight far start stops that screen only (queue kept), and is logged', async () => {
    controllers.clear();
    DaylightAPI.mockReturnValue(new Promise(() => {}));
    const { result } = harness();
    let id;
    await act(async () => { [id] = await result.current.dispatchToTarget({ targetIds: ['office-tv', 'den-tv'], play: arrival.contentId, mode: 'fork' }); });
    await act(async () => { await result.current.stopAttempt(id); });
    expect(controllers.get('office-tv').transport.stop).toHaveBeenCalledTimes(1);
    expect(controllers.get('den-tv')?.transport.stop.mock.calls.length ?? 0).toBe(0);
    expect(mediaLog.outcomeStopped).toHaveBeenCalledWith(expect.objectContaining({ attemptId: id, targetId: 'office-tv' }));
  });

  it('review (c): Retry retires the failed record it replays', async () => {
    DaylightAPI.mockResolvedValue({ ok: false, error: 'receiver rejected', failedStep: 'load' });
    const { result } = harness();
    let failed;
    await act(async () => { [failed] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork' }); });
    await settle();
    DaylightAPI.mockReturnValue(new Promise(() => {}));
    let retried;
    await act(async () => { [retried] = await result.current.retry(failed); });
    expect(result.current.outcomes.has(failed)).toBe(false);
    expect(result.current.outcomes.get(retried)).toEqual(expect.objectContaining({ targetId: 'office', phase: 'running' }));
    // A second Retry on the retired id does nothing.
    DaylightAPI.mockClear();
    await act(async () => { await result.current.retry(failed); });
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('review (d): a superseded attempt cannot be replayed afterwards', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const { result } = harness();
    let first;
    await act(async () => { [first] = await result.current.dispatchToTarget({ targetIds: ['office'], play: arrival.contentId, mode: 'fork' }); });
    await settle();
    act(() => homelineCallback({ dispatchId: first, topic: 'homeline:office', step: 'playback', status: 'confirmed' }));
    await act(async () => { await result.current.dispatchToTarget({ targetIds: ['office'], play: disclosure.contentId, mode: 'fork' }); });
    await settle();
    expect(result.current.outcomes.has(first)).toBe(false);
    DaylightAPI.mockClear();
    await act(async () => { await result.current.retry(first); });
    expect(DaylightAPI).not.toHaveBeenCalled();
  });
});
