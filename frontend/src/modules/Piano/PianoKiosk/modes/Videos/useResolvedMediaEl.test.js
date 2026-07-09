// useResolvedMediaEl.test.js
import { renderHook, act, waitFor } from '@testing-library/react';
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

  it('re-resolves when the element identity changes (engine swap)', () => {
    const a = { id: 'A' };
    const b = { id: 'B' };
    let el = a;
    const ref = { current: { getMediaElement: () => el } };
    const { result } = renderHook(() => useResolvedMediaEl(ref, 8000));
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.el).toBe(a);
    el = b;
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.el).toBe(b);
  });

  it('reports timedOut when the element never appears', () => {
    const ref = { current: { getMediaElement: () => null } };
    const { result } = renderHook(() => useResolvedMediaEl(ref, 8000));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(result.current.timedOut).toBe(true);
    expect(result.current.el).toBe(null);
  });

  it('recovers when the element briefly goes null then a new one appears (swap gap)', () => {
    const a = { id: 'A' }; const b = { id: 'B' };
    let el = a;
    const playerRef = { current: { getMediaElement: () => el } };
    const { result } = renderHook(() => useResolvedMediaEl(playerRef, 300));
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.el).toBe(a);           // initial element resolved
    el = null;                                   // transient gap during swap
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.el).toBe(null);        // gap detected
    el = b;                                      // replacement mounts
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.el).toBe(b);           // replacement resolved
    expect(result.current.timedOut).toBe(false); // must NOT have latched timedOut
  });
});
