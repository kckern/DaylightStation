import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTemporaryIndicator } from './useTemporaryIndicator.js';

describe('useTemporaryIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps feedback visible for a full interval after the latest action', () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useTemporaryIndicator(100));
    act(() => hook.result.current[1]());
    expect(hook.result.current[0]).toBe(true);

    act(() => vi.advanceTimersByTime(75));
    act(() => hook.result.current[1]());
    act(() => vi.advanceTimersByTime(25));
    expect(hook.result.current[0]).toBe(true);

    act(() => vi.advanceTimersByTime(75));
    expect(hook.result.current[0]).toBe(false);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
