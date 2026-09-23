import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useItemStall } from './useItemStall.js';

describe('useItemStall', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires at 45s and again at 120s with no activity', () => {
    const onStall = vi.fn();
    renderHook(() => useItemStall('item-1', onStall));

    vi.advanceTimersByTime(44_999);
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith(45_000);

    vi.advanceTimersByTime(75_000); // 45s + 75s = 120s
    expect(onStall).toHaveBeenCalledTimes(2);
    expect(onStall).toHaveBeenNthCalledWith(2, 120_000);
  });

  it('a keydown before 45s resets the timer — no stall at the original schedule', () => {
    const onStall = vi.fn();
    renderHook(() => useItemStall('item-1', onStall));

    vi.advanceTimersByTime(30_000);
    fireEvent.keyDown(window, { key: 'a' });
    vi.advanceTimersByTime(30_000); // 60s since mount, but only 30s since the keydown
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15_000); // 45s since the keydown
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall).toHaveBeenCalledWith(45_000);
  });

  it('a pointerdown resets the timer too', () => {
    const onStall = vi.fn();
    renderHook(() => useItemStall('item-1', onStall));

    vi.advanceTimersByTime(40_000);
    fireEvent.pointerDown(window);
    vi.advanceTimersByTime(40_000);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('changing itemId clears and re-arms both timers for the new item', () => {
    const onStall = vi.fn();
    const { rerender } = renderHook(({ id }) => useItemStall(id, onStall), { initialProps: { id: 'item-1' } });

    vi.advanceTimersByTime(40_000);
    rerender({ id: 'item-2' });
    vi.advanceTimersByTime(40_000); // 80s since first mount, but only 40s since item-2 arrived
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000); // 45s since item-2
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('unmounting clears the timers — no call after the component is gone', () => {
    const onStall = vi.fn();
    const { unmount } = renderHook(() => useItemStall('item-1', onStall));
    unmount();
    vi.advanceTimersByTime(200_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});
