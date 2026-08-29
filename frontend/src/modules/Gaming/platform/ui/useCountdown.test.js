import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from './useCountdown.js';

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down while running and fires onExpire once', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useCountdown({ seconds: 2, running: true, onExpire }));
    expect(result.current.remaining).toBe(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.remaining).toBeCloseTo(1, 0);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.remaining).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toBe(0);
  });

  it('does not tick when running=false and resets when seconds changes', () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ seconds, running }) => useCountdown({ seconds, running, onExpire }),
      { initialProps: { seconds: 5, running: false } });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.remaining).toBe(5);
    rerender({ seconds: 10, running: true });
    expect(result.current.remaining).toBe(10);
  });
});
