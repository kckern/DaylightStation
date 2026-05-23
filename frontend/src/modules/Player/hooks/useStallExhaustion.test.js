import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStallExhaustion } from './useStallExhaustion.js';

describe('useStallExhaustion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns exhausted=false on mount with no stall', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: false, thresholdMs: 15000 }));
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
  });

  it('flips exhausted=true after thresholdMs of continuous stall', () => {
    const { result } = renderHook(
      ({ stalled }) => useStallExhaustion({ stalled, thresholdMs: 15000 }),
      { initialProps: { stalled: true } }
    );
    expect(result.current.exhausted).toBe(false);
    act(() => { vi.advanceTimersByTime(14999); });
    expect(result.current.exhausted).toBe(false);
    act(() => { vi.advanceTimersByTime(2); });
    expect(result.current.exhausted).toBe(true);
  });

  it('resets when stall ends', () => {
    const { result, rerender } = renderHook(
      ({ stalled }) => useStallExhaustion({ stalled, thresholdMs: 15000 }),
      { initialProps: { stalled: true } }
    );
    act(() => { vi.advanceTimersByTime(15001); });
    expect(result.current.exhausted).toBe(true);
    rerender({ stalled: false });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
  });

  it('dismiss() clears exhausted without ending stall', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: true, thresholdMs: 5000 }));
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.exhausted).toBe(true);
    act(() => { result.current.dismiss(); });
    expect(result.current.exhausted).toBe(false);
  });
});
