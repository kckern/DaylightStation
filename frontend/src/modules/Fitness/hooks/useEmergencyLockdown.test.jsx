import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the HTTP mechanism.
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => p
}));

// Mock the websocket singleton. subscribe() returns an unsub fn and records the
// callback so tests can push synthetic broadcasts.
const wsCallbacks = [];
vi.mock('@/services/WebSocketService.js', () => ({
  wsService: {
    subscribe: vi.fn((topics, cb) => {
      wsCallbacks.push(cb);
      return () => {
        const i = wsCallbacks.indexOf(cb);
        if (i >= 0) wsCallbacks.splice(i, 1);
      };
    })
  }
}));

import { DaylightAPI } from '@/lib/api.mjs';
import { wsService } from '@/services/WebSocketService.js';
import { useEmergencyLockdown } from './useEmergencyLockdown.js';

// Push a synthetic ws message to all live subscribers.
function emit(msg) {
  wsCallbacks.forEach((cb) => cb(msg));
}

const ORIGINAL_SEARCH = window.location.search;
function setSearch(search) {
  window.history.replaceState({}, '', `${window.location.pathname}${search}`);
}

describe('useEmergencyLockdown', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
    wsService.subscribe.mockClear();
    wsCallbacks.length = 0;
    setSearch('');
  });

  afterEach(() => {
    setSearch(ORIGINAL_SEARCH);
  });

  it('mounts normal when server reports not locked', async () => {
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    expect(result.current.phase).toBe('normal');
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/emergency'));
    expect(result.current.phase).toBe('normal');
  });

  it('mount GET → locked sets phase locked with fields', async () => {
    DaylightAPI.mockResolvedValue({ locked: true, lockedUntil: 9999999999, lockedBy: 'test-user' });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(result.current.phase).toBe('locked'));
    expect(result.current.lockedUntil).toBe(9999999999);
    expect(result.current.lockedBy).toBe('test-user');
  });

  it('triggerCeremony() moves normal → triggering and is idempotent', () => {
    const { result } = renderHook(() => useEmergencyLockdown());
    expect(result.current.phase).toBe('normal');
    act(() => result.current.triggerCeremony());
    expect(result.current.phase).toBe('triggering');
    act(() => result.current.triggerCeremony());
    expect(result.current.phase).toBe('triggering');
  });

  it('a fitness.emergency.ceremony broadcast starts the ceremony (normal → triggering)', async () => {
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(result.current.phase).toBe('normal'));
    act(() => { emit({ topic: 'fitness.emergency.ceremony', reason: 'abuse', count: 3, windowSec: 30 }); });
    expect(result.current.phase).toBe('triggering');
  });

  it('released ws → normal', async () => {
    DaylightAPI.mockResolvedValue({ locked: true, lockedUntil: 9999999999, lockedBy: 'test-user' });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(result.current.phase).toBe('locked'));

    act(() => {
      emit({ topic: 'fitness.emergency.released', by: 'test-user', at: 789 });
    });
    expect(result.current.phase).toBe('normal');
    expect(result.current.lockedUntil).toBe(null);
  });

  it('locked ws → locked with fields (cross-device echo)', async () => {
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(wsService.subscribe).toHaveBeenCalled());

    act(() => {
      emit({ topic: 'fitness.emergency.locked', lockedUntil: 8888888888, lockedBy: 'test-user' });
    });
    expect(result.current.phase).toBe('locked');
    expect(result.current.lockedUntil).toBe(8888888888);
  });

  it('commit() POST → locked', async () => {
    // mount GET (normal), then commit POST (locked)
    DaylightAPI.mockResolvedValueOnce({ locked: false })
      .mockResolvedValueOnce({ locked: true, lockedUntil: 7777777777, lockedBy: 'test-user' });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));

    let res;
    await act(async () => {
      res = await result.current.commit();
    });
    expect(res).toEqual({ locked: true });
    expect(result.current.phase).toBe('locked');
    expect(result.current.lockedUntil).toBe(7777777777);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/emergency/commit', {}, 'POST');
  });

  it('commit() 409 → returns to normal', async () => {
    DaylightAPI.mockResolvedValueOnce({ locked: false })
      .mockRejectedValueOnce(new Error('HTTP 409: no-pending-detection'));
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));

    act(() => { result.current.triggerCeremony(); });
    expect(result.current.phase).toBe('triggering');

    let res;
    await act(async () => { res = await result.current.commit(); });
    expect(res).toEqual({ locked: false });
    expect(result.current.phase).toBe('normal');
  });

  it('abort() confirmed → normal', async () => {
    DaylightAPI.mockResolvedValueOnce({ locked: false })
      .mockResolvedValueOnce({ confirmed: true });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(1));

    act(() => { result.current.triggerCeremony(); });
    expect(result.current.phase).toBe('triggering');

    let res;
    await act(async () => { res = await result.current.abort(); });
    expect(res).toEqual({ confirmed: true });
    expect(result.current.phase).toBe('normal');
  });

  it('release() released → normal', async () => {
    // lockedUntil ~30min out keeps the expiry timer's delay within setTimeout's
    // 32-bit range (a far-future epoch like 9999999999 overflows and fires
    // immediately, stealing the next mocked response).
    const future = Math.floor(Date.now() / 1000) + 1800;
    DaylightAPI.mockResolvedValueOnce({ locked: true, lockedUntil: future, lockedBy: 'test-user' })
      .mockResolvedValueOnce({ released: true });
    const { result } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(result.current.phase).toBe('locked'));

    let res;
    await act(async () => { res = await result.current.release(); });
    expect(res).toEqual({ released: true });
    expect(result.current.phase).toBe('normal');
  });

  it('dev URL seam: ?emergency=triggering forces triggering without a GET stomp', async () => {
    setSearch('?emergency=triggering');
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    expect(result.current.phase).toBe('triggering');
    // GET is skipped under the seam, so it must not flip us back to normal.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.phase).toBe('triggering');
  });

  it('dev URL seam: ?emergency=locked forces locked with synthetic window', () => {
    setSearch('?emergency=locked');
    DaylightAPI.mockResolvedValue({ locked: false });
    const { result } = renderHook(() => useEmergencyLockdown());
    expect(result.current.phase).toBe('locked');
    expect(result.current.lockedUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('unsubscribes from ws on unmount', async () => {
    DaylightAPI.mockResolvedValue({ locked: false });
    const { unmount } = renderHook(() => useEmergencyLockdown());
    await waitFor(() => expect(wsCallbacks.length).toBe(1));
    unmount();
    expect(wsCallbacks.length).toBe(0);
  });
});
