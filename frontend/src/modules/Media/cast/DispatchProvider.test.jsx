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
import { DispatchProvider, useDispatch } from './DispatchProvider.jsx';

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

const CAST = { targetIds: ['livingroom-tv'], play: 'plex:665668', mode: 'transfer', title: 'Wrestling with Socialism' };

describe('DispatchProvider — duplicate suppression', () => {
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

  it('an explicit Retry bypasses the in-flight guard', () => {
    pendingLoad();
    const { result } = renderHook(() => useDispatch(), { wrapper });
    act(() => { result.current.dispatchToTarget(CAST); });
    act(() => { result.current.retryLast(); });
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
