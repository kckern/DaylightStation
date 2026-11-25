import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  curtainReady, useChangeCurtain, CURTAIN_MIN_MS, CURTAIN_MAX_MS, CURTAIN_CLOSE_MS,
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

describe('useChangeCurtain: the advance gate (nothing changes before the curtain is shut)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const root = { current: { querySelectorAll: () => [] } };
  const base = { enabled: true, clip: CLIP, playing: true, seeking: false, position: 150, rootRef: root };

  it('closes first and lets the queue move only once the panels have met', () => {
    vi.useFakeTimers();
    const gateRef = { current: null };
    const { result } = renderHook((p) => useChangeCurtain(p), { initialProps: { ...base, contentId: 'plex:1@100', gateRef } });
    const go = vi.fn();
    act(() => { gateRef.current(go); });
    expect(result.current).toBe('closed');
    expect(go).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(CURTAIN_CLOSE_MS - 10); });
    expect(go).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20); });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('stays shut over the OLD clip, ready or not, until the new item arrives', () => {
    vi.useFakeTimers();
    const gateRef = { current: null };
    const { result, rerender } = renderHook((p) => useChangeCurtain(p), { initialProps: { ...base, contentId: 'plex:1@100', gateRef } });
    act(() => { gateRef.current(() => {}); });
    act(() => { vi.advanceTimersByTime(CURTAIN_MIN_MS + 1000); });
    expect(result.current).toBe('closed');
    rerender({ ...base, contentId: 'plex:2@300', gateRef, position: 301 });
    act(() => { vi.advanceTimersByTime(CURTAIN_MIN_MS + 200); });
    expect(result.current).toBe('open');
  });

  it('passes straight through when the item is not a clip', () => {
    const gateRef = { current: null };
    const { result } = renderHook((p) => useChangeCurtain(p), { initialProps: { ...base, clip: null, contentId: 'plex:9', gateRef } });
    const go = vi.fn();
    act(() => { gateRef.current(go); });
    expect(go).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('open');
  });
});
