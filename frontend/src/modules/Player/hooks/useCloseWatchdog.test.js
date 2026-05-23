import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useCloseWatchdog } from './useCloseWatchdog.js';

describe('useCloseWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fire onTimeout if completed() is called before timeout', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useCloseWatchdog({ timeoutMs: 5000, onTimeout }));
    act(() => { result.current.requested({ sessionId: 'fs_x' }); });
    act(() => { vi.advanceTimersByTime(4999); });
    act(() => { result.current.completed({ sessionId: 'fs_x' }); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('fires onTimeout when timeoutMs elapses without completed()', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useCloseWatchdog({ timeoutMs: 5000, onTimeout }));
    act(() => { result.current.requested({ sessionId: 'fs_x' }); });
    act(() => { vi.advanceTimersByTime(5001); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fs_x' }));
  });

  it('clears any in-flight timer when requested() is called again', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useCloseWatchdog({ timeoutMs: 5000, onTimeout }));
    act(() => { result.current.requested({ sessionId: 'fs_x' }); });
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { result.current.requested({ sessionId: 'fs_y' }); });
    act(() => { vi.advanceTimersByTime(3000); });
    // Total elapsed since fs_y is 3000ms — should NOT have fired yet
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fs_y' }));
  });

  it('cleans up timer on unmount', () => {
    const onTimeout = vi.fn();
    const { result, unmount } = renderHook(() => useCloseWatchdog({ timeoutMs: 5000, onTimeout }));
    act(() => { result.current.requested({ sessionId: 'fs_x' }); });
    unmount();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('completed() is a no-op when no request is in flight', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useCloseWatchdog({ timeoutMs: 5000, onTimeout }));
    // No requested() call
    act(() => { result.current.completed({ sessionId: 'fs_x' }); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
