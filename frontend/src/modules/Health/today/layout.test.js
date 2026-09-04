import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsWideViewport, ASIDE_MIN_WIDTH_PX, ASIDE_MEDIA_QUERY } from './layout.js';

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

function fakeMatchMedia(initial) {
  const listeners = new Set();
  const mql = {
    matches: initial,
    media: ASIDE_MEDIA_QUERY,
    addEventListener: (_e, fn) => listeners.add(fn),
    removeEventListener: (_e, fn) => listeners.delete(fn),
  };
  const queries = [];
  window.matchMedia = vi.fn((q) => { queries.push(q); return mql; });
  return { mql, queries, fire: (matches) => { mql.matches = matches; listeners.forEach((fn) => fn({ matches })); } };
}

describe('useIsWideViewport', () => {
  beforeEach(() => { window.matchMedia = original; });

  it('asks for the breakpoint the stylesheet uses', () => {
    const { queries } = fakeMatchMedia(false);
    renderHook(() => useIsWideViewport());
    expect(queries[0]).toBe(`(min-width: ${ASIDE_MIN_WIDTH_PX}px)`);
  });

  it('reports the current match and follows changes', () => {
    const h = fakeMatchMedia(false);
    const { result } = renderHook(() => useIsWideViewport());
    expect(result.current).toBe(false);
    act(() => h.fire(true));
    expect(result.current).toBe(true);
    act(() => h.fire(false));
    expect(result.current).toBe(false);
  });

  // The safe answer is "narrow": false means "do not mount the sidebar's
  // 30-day widgets", i.e. do not fetch for a column nobody is looking at.
  it('is false where matchMedia does not exist, not a crash', () => {
    window.matchMedia = undefined;
    const { result } = renderHook(() => useIsWideViewport());
    expect(result.current).toBe(false);
  });

  it('falls back to addListener on browsers without addEventListener', () => {
    const listeners = new Set();
    const mql = {
      matches: false,
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    };
    window.matchMedia = () => mql;
    const { result, unmount } = renderHook(() => useIsWideViewport());
    expect(listeners.size).toBe(1);
    act(() => { mql.matches = true; listeners.forEach((fn) => fn({ matches: true })); });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
