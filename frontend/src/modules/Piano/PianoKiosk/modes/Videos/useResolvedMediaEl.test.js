// useResolvedMediaEl.test.js
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useResolvedMediaEl from './useResolvedMediaEl.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useResolvedMediaEl', () => {
  it('resolves the element when it appears', () => {
    const fake = {};
    const ref = { current: { getMediaElement: () => fake } };
    const { result } = renderHook(() => useResolvedMediaEl(ref, 8000));
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.el).toBe(fake);
    expect(result.current.timedOut).toBe(false);
  });

  it('reports timedOut when the element never appears', () => {
    const ref = { current: { getMediaElement: () => null } };
    const { result } = renderHook(() => useResolvedMediaEl(ref, 8000));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(result.current.timedOut).toBe(true);
    expect(result.current.el).toBe(null);
  });
});
