import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInactivityReturn } from './useInactivityReturn.js';
import { activitySignal } from './activitySignal.js';

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

  it('bumps the shared activitySignal on pointerdown, and still fires onIdle at the minutes threshold', () => {
    const onIdle = vi.fn();
    vi.setSystemTime(1_000_000);
    renderHook(() => useInactivityReturn(new Map(), 0, 1, onIdle, false)); // 1 min threshold

    // A pointerdown mid-flight bumps the shared, seconds-granularity signal —
    // the onIdle contract's own minutes-granularity behaviour is untouched.
    vi.setSystemTime(1_030_000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(activitySignal.lastActivityAt()).toBe(1_030_000);

    // The pointerdown also reset the hook's own idle clock. Advancing 70s
    // from there clears the 60s (1 min) threshold, so the pre-existing
    // onIdle contract still fires exactly as before this change.
    vi.advanceTimersByTime(70_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
