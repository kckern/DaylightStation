import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useDayOfWeek, { msUntilNextMidnight } from './useDayOfWeek.js';

describe('msUntilNextMidnight', () => {
  it('computes time remaining until the next local midnight', () => {
    // Sat Jun 6 2026, 23:30 local → 30 minutes to midnight.
    expect(msUntilNextMidnight(new Date(2026, 5, 6, 23, 30, 0))).toBe(30 * 60 * 1000);
  });

  it('returns a full day when called exactly at midnight', () => {
    expect(msUntilNextMidnight(new Date(2026, 5, 6, 0, 0, 0))).toBe(24 * 60 * 60 * 1000);
  });
});

describe('useDayOfWeek', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the current local day of week', () => {
    vi.setSystemTime(new Date(2026, 5, 6, 10, 0, 0)); // Saturday
    const { result } = renderHook(() => useDayOfWeek());
    expect(result.current).toBe(6);
  });

  it('rolls over at midnight without a refresh', () => {
    vi.setSystemTime(new Date(2026, 5, 6, 23, 30, 0)); // Saturday 23:30
    const { result } = renderHook(() => useDayOfWeek());
    expect(result.current).toBe(6);

    act(() => vi.advanceTimersByTime(31 * 60 * 1000)); // → Sunday 00:01
    expect(result.current).toBe(0);
  });

  it('reschedules across consecutive midnights', () => {
    vi.setSystemTime(new Date(2026, 5, 6, 23, 59, 0)); // Saturday
    const { result } = renderHook(() => useDayOfWeek());

    act(() => vi.advanceTimersByTime(2 * 60 * 1000)); // → Sunday 00:01
    expect(result.current).toBe(0);

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000)); // → Monday
    expect(result.current).toBe(1);
  });

  it('clears its timer on unmount', () => {
    vi.setSystemTime(new Date(2026, 5, 6, 23, 30, 0));
    const { result, unmount } = renderHook(() => useDayOfWeek());
    unmount();
    act(() => vi.advanceTimersByTime(48 * 60 * 60 * 1000)); // no throw / no stale update
    expect(result.current).toBe(6);
  });
});
