import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useLongPress from './useLongPress.js';

describe('useLongPress', () => {
  let onLongPress;
  let onTap;

  beforeEach(() => {
    vi.useFakeTimers();
    onLongPress = vi.fn();
    onTap = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (holdMs = 2000) =>
    renderHook(() => useLongPress({ onLongPress, onTap, holdMs }));

  it('fires onLongPress after holding for holdMs, and not onTap', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // Releasing after the long-press fired must not also register a tap.
    act(() => { result.current.handlers.onPointerUp({}); });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('fires onTap (not onLongPress) when released before holdMs', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.handlers.onPointerUp({}); });
    expect(onTap).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels with neither callback when the pointer leaves mid-hold', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.handlers.onPointerLeave({}); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('exposes holding=true only while a press is pending', () => {
    const { result } = setup();
    expect(result.current.holding).toBe(false);
    act(() => { result.current.handlers.onPointerDown({}); });
    expect(result.current.holding).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.holding).toBe(false); // fired → no longer pending
  });

  it('clears holding on pointer cancel', () => {
    const { result } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    act(() => { result.current.handlers.onPointerCancel({}); });
    expect(result.current.holding).toBe(false);
  });

  it('does not fire onLongPress after unmount', () => {
    const { result, unmount } = setup();
    act(() => { result.current.handlers.onPointerDown({}); });
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
