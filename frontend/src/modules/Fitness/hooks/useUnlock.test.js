import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the POST mechanism. useUnlock posts via DaylightAPI(path, body).
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn()
}));

// Mock the cue-audio plumbing so the hook's success-chime side effect is observable
// without a real <audio> element.
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  playCueOnce: vi.fn()
}));
vi.mock('@/modules/Fitness/player/hooks/audioCuePlayer.js', () => ({
  primeCueAudio: vi.fn()
}));

import { DaylightAPI } from '@/lib/api.mjs';
import { playCueOnce } from '@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js';
import { primeCueAudio } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';
import { useUnlock } from './useUnlock.js';

describe('useUnlock', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
    playCueOnce.mockClear();
    primeCueAudio.mockClear();
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useUnlock());
    expect(result.current.state).toBe('idle');
    expect(result.current.activeLock).toBe(null);
  });

  it('matched response: scanning -> granted, resolves {matched:true,userId}', async () => {
    DaylightAPI.mockResolvedValue({ matched: true, userId: 'test-user' });

    const { result } = renderHook(() => useUnlock());

    let promise;
    act(() => {
      promise = result.current.requestUnlock('dance-party');
    });
    // Synchronously enters scanning before the network resolves.
    expect(result.current.state).toBe('scanning');
    expect(result.current.activeLock).toBe('dance-party');

    let resolved;
    await act(async () => {
      resolved = await promise;
    });

    expect(resolved).toEqual({ matched: true, userId: 'test-user' });
    expect(result.current.state).toBe('granted');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/unlock', { lock: 'dance-party' });
    // Primes on the (gesture) request and plays the success chime on a match.
    expect(primeCueAudio).toHaveBeenCalled();
    expect(playCueOnce).toHaveBeenCalledWith({ sound: 'apps/fitness/ux/unlock.mp3', volume: 1 });
  });

  it('does NOT play the success chime when the scan is not matched', async () => {
    DaylightAPI.mockResolvedValue({ matched: false, reason: 'timeout' });

    const { result } = renderHook(() => useUnlock());
    await act(async () => {
      await result.current.requestUnlock('dance-party');
    });

    expect(playCueOnce).not.toHaveBeenCalled();
  });

  it('unmatched response: state denied, resolves {matched:false,reason:"timeout"}', async () => {
    DaylightAPI.mockResolvedValue({ matched: false, reason: 'timeout' });

    const { result } = renderHook(() => useUnlock());

    let resolved;
    await act(async () => {
      resolved = await result.current.requestUnlock('dance-party');
    });

    expect(resolved).toEqual({ matched: false, reason: 'timeout' });
    expect(result.current.state).toBe('denied');
  });

  it('network error/throw: state denied, promise resolves (does not reject)', async () => {
    DaylightAPI.mockRejectedValue(new Error('HTTP 503: unlock-service-unavailable'));

    const { result } = renderHook(() => useUnlock());

    let resolved;
    await act(async () => {
      // If requestUnlock rejected, this await would throw and fail the test.
      resolved = await result.current.requestUnlock('dance-party');
    });

    expect(resolved.matched).toBe(false);
    expect(result.current.state).toBe('denied');
  });

  it('reset() returns state to idle', async () => {
    DaylightAPI.mockResolvedValue({ matched: false, reason: 'timeout' });

    const { result } = renderHook(() => useUnlock());

    await act(async () => {
      await result.current.requestUnlock('dance-party');
    });
    expect(result.current.state).toBe('denied');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.activeLock).toBe(null);
  });

  it('ignores overlapping requests while scanning (returns busy without a new POST)', async () => {
    let resolveFirst;
    DaylightAPI.mockImplementation(
      () => new Promise((res) => { resolveFirst = res; })
    );

    const { result } = renderHook(() => useUnlock());

    let firstPromise;
    act(() => {
      firstPromise = result.current.requestUnlock('dance-party');
    });
    expect(result.current.state).toBe('scanning');

    let busyResult;
    await act(async () => {
      busyResult = await result.current.requestUnlock('other-lock');
    });
    expect(busyResult).toEqual({ matched: false, reason: 'busy' });
    // Only the first request hit the network.
    expect(DaylightAPI).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ matched: true, userId: 'test-user' });
      await firstPromise;
    });
    expect(result.current.state).toBe('granted');
  });
});
