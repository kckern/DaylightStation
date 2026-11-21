import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDisplayClock } from './useDisplayClock.js';

describe('useDisplayClock', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses while hidden and samples current time on return', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const hook = renderHook(() => useDisplayClock(true, 1_000));
    expect(hook.result.current).toBe(Date.parse('2026-11-20T12:00:00.000Z'));

    act(() => vi.advanceTimersByTime(1_000));
    expect(hook.result.current).toBe(Date.parse('2026-11-20T12:00:01.000Z'));

    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.setSystemTime(new Date('2026-11-20T12:00:10.000Z')));
    act(() => vi.advanceTimersByTime(5_000));
    expect(hook.result.current).toBe(Date.parse('2026-11-20T12:00:01.000Z'));

    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(hook.result.current).toBe(Date.parse('2026-11-20T12:00:15.000Z'));
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
