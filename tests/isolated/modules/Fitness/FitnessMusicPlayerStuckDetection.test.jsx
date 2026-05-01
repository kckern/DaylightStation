import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useStuckLoadingDetector } from '@/modules/Fitness/player/panels/useStuckLoadingDetector.js';

describe('useStuckLoadingDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns isStuck=false initially', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: 'pl-1', thresholdMs: 15_000
    }));
    expect(result.current.isStuck).toBe(false);
  });

  it('flips isStuck=true after thresholdMs elapses with no track and a playlist set', () => {
    const { result, rerender } = renderHook(
      ({ hasTrack, playlistId }) => useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs: 15_000 }),
      { initialProps: { hasTrack: false, playlistId: 'pl-1' } }
    );

    expect(result.current.isStuck).toBe(false);

    act(() => { vi.advanceTimersByTime(14_999); });
    expect(result.current.isStuck).toBe(false);

    act(() => { vi.advanceTimersByTime(2); });
    expect(result.current.isStuck).toBe(true);
  });

  it('clears isStuck once a track arrives', () => {
    const { result, rerender } = renderHook(
      ({ hasTrack, playlistId }) => useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs: 15_000 }),
      { initialProps: { hasTrack: false, playlistId: 'pl-1' } }
    );
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);

    rerender({ hasTrack: true, playlistId: 'pl-1' });
    expect(result.current.isStuck).toBe(false);
  });

  it('does NOT flip isStuck when no playlist is selected (player intentionally idle)', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: null, thresholdMs: 15_000
    }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.isStuck).toBe(false);
  });

  it('exposes a retry() function that resets the timer and increments attempt', () => {
    const { result } = renderHook(() => useStuckLoadingDetector({
      hasTrack: false, playlistId: 'pl-1', thresholdMs: 15_000
    }));

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);
    expect(result.current.attempt).toBe(0);

    act(() => { result.current.retry(); });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.attempt).toBe(1);

    // After retry, threshold timer restarts.
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.isStuck).toBe(true);
  });
});
