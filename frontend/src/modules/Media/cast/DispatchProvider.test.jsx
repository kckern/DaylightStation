import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const DaylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => DaylightAPI(...a) }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {} }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import mediaLog from '../logging/mediaLog.js';
import { DispatchProvider } from './DispatchProvider.jsx';
import { useDispatch } from './useDispatch.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';

const TIMING_WINDOW = 6_000; // > DISPATCH_DEDUPE_WINDOW_MS (5s)

const wrapper = ({ children }) => <DispatchProvider>{children}</DispatchProvider>;

/** A load call that never settles — the state a slow TV wake sits in. */
function pendingLoad() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  DaylightAPI.mockReturnValue(promise);
  return { resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const CAST = { targetIds: ['livingroom-tv'], play: 'plex:665668', mode: 'fork', title: 'Wrestling with Socialism' };

describe('DispatchProvider — duplicate suppression', () => {
  it('fails a direct transfer before dispatch and never stops the local source', async () => {
    const stop = vi.fn();
    const withLocalSource = ({ children }) => (
      <LocalSessionContext.Provider value={{ controller: { transport: { stop } } }}>
        <DispatchProvider>{children}</DispatchProvider>
      </LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useDispatch(), { wrapper: withLocalSource });

    let outcome;
    await act(async () => {
      outcome = await result.current.dispatchToTarget({
        ...CAST, mode: 'transfer', capabilities: { handoffV1: true },
      });
    });

    expect(outcome).toEqual([]);
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  // 2026-08-12: the LG's power step held for 80s. The 5s dedupe window had
  // lapsed, so a second identical cast went to the backend and only the
  // BACKEND deduplicated the third.
  it('suppresses an identical cast while the first is still in flight, however long', () => {
    pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });

    let first;
    act(() => { first = result.current.dispatchToTarget(CAST); });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);

    // Well past the 5s idempotency window — the wake is still running.
    act(() => { vi.advanceTimersByTime(80_000); });

    let second;
    act(() => { second = result.current.dispatchToTarget(CAST); });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(mediaLog.dispatchDeduplicated).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'in-flight' })
    );
  });

  it('a DIFFERENT episode to the same device still goes through — no lockout', () => {
    pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });
    act(() => { result.current.dispatchToTarget(CAST); });
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { result.current.dispatchToTarget({ ...CAST, play: 'plex:665669' }); });
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('once the dispatch settles, a fresh identical cast dispatches again', async () => {
    const { resolve } = pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });
    act(() => { result.current.dispatchToTarget(CAST); });

    await act(async () => { resolve({ ok: true, totalElapsedMs: 69 }); });
    // Past the idempotency window so only the in-flight guard is under test.
    act(() => { vi.advanceTimersByTime(TIMING_WINDOW); });

    act(() => { result.current.dispatchToTarget(CAST); });
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('a failed dispatch does not stay latched as in-flight', async () => {
    const { resolve } = pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });
    act(() => { result.current.dispatchToTarget(CAST); });

    await act(async () => { resolve({ ok: false, error: 'display_off', failedStep: 'verify' }); });
    act(() => { vi.advanceTimersByTime(TIMING_WINDOW); });

    act(() => { result.current.dispatchToTarget(CAST); });
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('RELY.6a retries only the failed multi-target row with its exact content and options', async () => {
    const pending = [];
    DaylightAPI.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { result } = renderHook(() => useDispatch(), { wrapper });
    const attempt = {
      targetIds: ['livingroom-tv', 'office-tv'],
      play: 'plex:665668',
      mode: 'fork',
      shader: 'dark',
      volume: 17,
      shuffle: true,
      title: 'Wrestling with Socialism',
    };

    let dispatchIds;
    await act(async () => { dispatchIds = await result.current.dispatchToTarget(attempt); });
    await act(async () => {
      pending[0]({ ok: false, error: 'display_off', failedStep: 'verify' });
      pending[1]({ ok: true });
      await Promise.resolve();
    });

    DaylightAPI.mockClear();
    pendingLoad();
    let retryIds;
    await act(async () => { retryIds = await result.current.retry(dispatchIds[0]); });

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const retried = new URL(DaylightAPI.mock.calls[0][0], 'http://daylight.test');
    expect(retried.pathname).toBe('/api/v1/device/livingroom-tv/load');
    expect(Object.fromEntries(retried.searchParams)).toEqual(expect.objectContaining({
      play: 'plex:665668',
      shader: 'dark',
      volume: '17',
      shuffle: '1',
    }));
    expect(result.current.dispatches.get(retryIds[0])).toEqual(expect.objectContaining({
      deviceId: 'livingroom-tv',
      contentId: 'plex:665668',
      title: 'Wrestling with Socialism',
      mode: 'fork',
    }));
  });

  it('RELY.6a retains an adopt snapshot exactly for retry', async () => {
    const expectedSnapshot = {
      sessionId: 'session-1',
      state: 'paused',
      currentItem: { contentId: 'plex:42', title: 'Bluey' },
      position: 47,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', volume: 31, shader: null },
      meta: { ownerId: 'phone', updatedAt: '2026-09-14T00:00:00.000Z' },
    };
    const snapshot = structuredClone(expectedSnapshot);
    DaylightAPI.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const { result } = renderHook(() => useDispatch(), { wrapper });

    let dispatchIds;
    await act(async () => {
      dispatchIds = await result.current.dispatchToTarget({
        targetIds: ['livingroom-tv'], snapshot, mode: 'fork', title: 'Bluey',
      });
      await Promise.resolve();
    });

    DaylightAPI.mockClear();
    snapshot.position = 99;
    snapshot.currentItem.title = 'Mutated after dispatch';
    pendingLoad();
    await act(async () => { await result.current.retry(dispatchIds[0]); });
    expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/device/livingroom-tv/load',
      { dispatchId: expect.any(String), snapshot: expectedSnapshot, mode: 'adopt' },
      'POST'
    );
  });

  it('RELY.6a repeated taps do not duplicate an in-flight retry', async () => {
    DaylightAPI.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const { result } = renderHook(() => useDispatch(), { wrapper });

    let dispatchIds;
    await act(async () => {
      dispatchIds = await result.current.dispatchToTarget(CAST);
      await Promise.resolve();
    });

    pendingLoad();
    await act(async () => { await result.current.retry(dispatchIds[0]); });
    await act(async () => { await result.current.retry(dispatchIds[0]); });
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
    expect(mediaLog.dispatchDeduplicated).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'in-flight' })
    );
  });

  it.each([
    {
      difference: 'play versus queue verb',
      first: { play: 'plex:665668' },
      second: { queue: 'plex:665668' },
    },
    {
      difference: 'shader',
      first: { play: 'plex:665668', shader: 'dark' },
      second: { play: 'plex:665668', shader: 'bright' },
    },
    {
      difference: 'volume',
      first: { play: 'plex:665668', volume: 17 },
      second: { play: 'plex:665668', volume: 18 },
    },
    {
      difference: 'shuffle',
      first: { play: 'plex:665668', shuffle: false },
      second: { play: 'plex:665668', shuffle: true },
    },
    {
      difference: 'full adopt snapshot',
      first: {
        snapshot: {
          sessionId: 'session-1', state: 'paused', position: 47,
          currentItem: { contentId: 'plex:665668', title: 'Episode one' },
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', volume: 17, shader: null },
          meta: { ownerId: 'phone', updatedAt: '2026-09-14T00:00:00.000Z' },
        },
      },
      second: {
        snapshot: {
          sessionId: 'session-1', state: 'paused', position: 47,
          currentItem: { contentId: 'plex:665668', title: 'Episode two' },
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', volume: 18, shader: null },
          meta: { ownerId: 'phone', updatedAt: '2026-09-14T00:00:01.000Z' },
        },
      },
    },
  ])('RELY.6a retries distinct rows that differ by $difference while both are in flight', async ({ first, second }) => {
    DaylightAPI.mockResolvedValue({ ok: false, error: 'offline' });
    const { result } = renderHook(() => useDispatch(), { wrapper });
    let firstIds;
    let secondIds;

    await act(async () => {
      firstIds = await result.current.dispatchToTarget({
        targetIds: ['livingroom-tv'], mode: 'fork', ...first,
      });
      await Promise.resolve();
      secondIds = await result.current.dispatchToTarget({
        targetIds: ['livingroom-tv'], mode: 'fork', ...second,
      });
      await Promise.resolve();
    });

    DaylightAPI.mockClear();
    pendingLoad();
    await act(async () => {
      await result.current.retry(firstIds[0]);
      await result.current.retry(secondIds[0]);
    });

    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('still logs the dispatch lifecycle so a failed cast is visible in prod', async () => {
    const { resolve } = pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });
    act(() => { result.current.dispatchToTarget(CAST); });
    expect(mediaLog.dispatchInitiated).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'livingroom-tv', contentId: 'plex:665668' })
    );
    await act(async () => { resolve({ ok: false, error: 'display_off', failedStep: 'verify' }); });
    expect(mediaLog.dispatchFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failedStep: 'verify', error: 'display_off' })
    );
  });
});
