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

  it('after dismiss(), exhausted stays false even if stall continues for additional thresholdMs', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: true, thresholdMs: 5000 }));
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.exhausted).toBe(true);
    act(() => { result.current.dismiss(); });
    expect(result.current.exhausted).toBe(false);
    // Stall continues for another 10s — dismiss should be sticky.
    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.exhausted).toBe(false);
  });

  it('dismiss() freezes secondsStalled at the dismissed value (does not keep counting)', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: true, thresholdMs: 5000 }));
    act(() => { vi.advanceTimersByTime(6000); });
    const frozen = result.current.secondsStalled;
    expect(frozen).toBeGreaterThanOrEqual(5);
    act(() => { result.current.dismiss(); });
    act(() => { vi.advanceTimersByTime(10000); });
    // After dismiss, the counter is intentionally frozen — UI shouldn't be
    // displaying it post-dismiss anyway.
    expect(result.current.secondsStalled).toBe(frozen);
  });

  it('reset() restarts a fresh exhaustion window mid-stall so exhausted can flip true again', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: true, thresholdMs: 5000 }));
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.exhausted).toBe(true);
    // Retry path: reset (NOT dismiss) — window restarts even though still stalled.
    act(() => { result.current.reset(); });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
    // Stall persists; the next tick re-arms the window (~1s), then after another
    // full threshold the banner can return.
    act(() => { vi.advanceTimersByTime(7000); });
    expect(result.current.exhausted).toBe(true);
  });

  it('after stall ends and starts again, dismiss state is cleared (counter and exhausted reset)', () => {
    const { result, rerender } = renderHook(
      ({ stalled }) => useStallExhaustion({ stalled, thresholdMs: 5000 }),
      { initialProps: { stalled: true } }
    );
    act(() => { vi.advanceTimersByTime(6000); });
    act(() => { result.current.dismiss(); });
    rerender({ stalled: false });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
    rerender({ stalled: true });
    // Fresh start — dismiss should NOT persist across stall episodes.
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.exhausted).toBe(true);
  });
});
