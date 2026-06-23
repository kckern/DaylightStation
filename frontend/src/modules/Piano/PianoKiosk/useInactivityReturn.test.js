import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInactivityReturn } from './useInactivityReturn.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useInactivityReturn', () => {
  it('does NOT fire onIdle while keepAlive is true', () => {
    const onIdle = vi.fn();
    renderHook(() => useInactivityReturn(new Map(), 0, 1, onIdle, true)); // 1 min threshold, keepAlive on
    vi.advanceTimersByTime(5 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onIdle after the threshold when keepAlive is false', () => {
    const onIdle = vi.fn();
    renderHook(() => useInactivityReturn(new Map(), 0, 1, onIdle, false));
    vi.advanceTimersByTime(70_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
