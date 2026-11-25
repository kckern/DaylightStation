import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  curtainReady, useChangeCurtain, CURTAIN_MIN_MS, CURTAIN_MAX_MS,
} from './curtain.js';

const CLIP = { segment: { start: 100, end: 300 } };

describe('curtainReady', () => {
  it('waits for a playing picture inside the clip window, and every image', () => {
    const base = { playing: true, seeking: false, position: 101, clip: CLIP, imagesLoaded: true };
    expect(curtainReady(base)).toBe(true);
    expect(curtainReady({ ...base, playing: false })).toBe(false);
    expect(curtainReady({ ...base, seeking: true })).toBe(false);
    expect(curtainReady({ ...base, imagesLoaded: false })).toBe(false);
    // Still at the concert's opening: the seek into the window has not landed.
    expect(curtainReady({ ...base, position: 2 })).toBe(false);
    expect(curtainReady({ ...base, clip: null, position: 2 })).toBe(true);
  });
});

describe('useChangeCurtain', () => {
  afterEach(() => { vi.useRealTimers(); });

  const root = { current: { querySelectorAll: () => [] } };
  const props = (over = {}) => ({
    enabled: true, contentId: 'plex:1#1', clip: CLIP, playing: true, seeking: false, position: 150, rootRef: root, ...over,
  });

  it('stays open on the first item, closes on a clip change, and parts once ready', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((p) => useChangeCurtain(p), { initialProps: props() });
    expect(result.current).toBe('open');

    rerender(props({ contentId: 'plex:2#4', playing: false, position: 0 }));
    expect(result.current).toBe('closed');
    act(() => { vi.advanceTimersByTime(CURTAIN_MIN_MS + 500); });
    expect(result.current).toBe('closed');

    rerender(props({ contentId: 'plex:2#4', playing: true, position: 150 }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('open');
  });

  it('never covers the screen past its safety rail', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((p) => useChangeCurtain(p), { initialProps: props() });
    rerender(props({ contentId: 'plex:2#4', playing: false }));
    expect(result.current).toBe('closed');
    act(() => { vi.advanceTimersByTime(CURTAIN_MAX_MS + 200); });
    expect(result.current).toBe('open');
  });

  it('does not close between two whole works', () => {
    const { result, rerender } = renderHook((p) => useChangeCurtain(p), { initialProps: props({ clip: null }) });
    rerender(props({ contentId: 'plex:9', clip: null }));
    expect(result.current).toBe('open');
  });
});

describe('useChangeCurtain: identity', () => {
  it('closes between two clips of the same concert (the frame keys it by window)', () => {
    const root = { current: { querySelectorAll: () => [] } };
    const base = { enabled: true, clip: CLIP, playing: true, seeking: false, position: 150, rootRef: root };
    const { result, rerender } = renderHook((p) => useChangeCurtain(p), { initialProps: { ...base, contentId: 'plex:1@100' } });
    rerender({ ...base, contentId: 'plex:1@400' });
    expect(result.current).toBe('closed');
  });
});
