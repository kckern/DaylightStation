import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLoopWindow, { computeLoopWindow } from './useLoopWindow.js';

vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

describe('computeLoopWindow', () => {
  it('loops backward, ending at the pause point', () => {
    expect(computeLoopWindow('back', 10, 252, 1110)).toEqual({ start: 242, end: 252 });
  });

  it('loops forward, starting at the pause point', () => {
    expect(computeLoopWindow('forward', 30, 252, 1110)).toEqual({ start: 252, end: 282 });
  });

  it('clamps the backward start at 0', () => {
    expect(computeLoopWindow('back', 30, 10, 1110)).toEqual({ start: 0, end: 10 });
  });

  it('clamps the forward end at duration', () => {
    expect(computeLoopWindow('forward', 30, 1100, 1110)).toEqual({ start: 1100, end: 1110 });
  });

  it('returns null for a degenerate window', () => {
    expect(computeLoopWindow('back', 10, 0, 1110)).toBeNull();
    expect(computeLoopWindow('forward', 10, 1110, 1110)).toBeNull();
  });

  it('returns null for a nonsense duration', () => {
    expect(computeLoopWindow('back', 10, 252, null)).toBeNull();
  });
});

const makeEl = (t = 0) => ({
  currentTime: t,
  paused: false,
  playCalls: 0,
  _handlers: {},
  addEventListener(ev, fn) { this._handlers[ev] = fn; },
  removeEventListener(ev) { delete this._handlers[ev]; },
  fire(ev) { this._handlers[ev]?.(); },
  fireTimeUpdate() { this.fire('timeupdate'); },
  play() { this.playCalls += 1; },
});

describe('useLoopWindow', () => {
  it('seeks back to start when playback passes the loop end', () => {
    const el = makeEl(0);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it('marks its own boundary seek so the loop does not self-release', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(result.current.isBoundarySeek()).toBe(true);
    expect(result.current.loop).not.toBeNull();
  });

  it('releaseLoop clears the window', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));
    act(() => { result.current.armLoop('back', 10, 100, 1000); });
    expect(result.current.loop).not.toBeNull();
    act(() => { result.current.releaseLoop(); });
    expect(result.current.loop).toBeNull();
  });

  it('releases (without seeking) when the user scrubs before the window, instead of hijacking the escape', () => {
    const el = makeEl(0);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    // Backward loop [242, 252], armed at the pause point 252.
    act(() => { result.current.armLoop('back', 10, 252, 1110); });

    // Move into the window first so the just-armed latch doesn't swallow this tick.
    el.currentTime = 245;
    act(() => { el.fireTimeUpdate(); });
    expect(onSeek).not.toHaveBeenCalled();
    expect(result.current.loop).not.toBeNull();

    // Deliberate scrub well before win.start(242) minus tolerance.
    el.currentTime = 230;
    act(() => { el.fireTimeUpdate(); });

    expect(onSeek).not.toHaveBeenCalled();
    expect(result.current.loop).toBeNull();
    expect(result.current.isBoundarySeek()).toBe(false);
  });

  it('does not immediately re-seek a freshly-armed backward loop before playback advances', () => {
    const el = makeEl(252);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    // Backward loop [242, 252], armed exactly at win.end - currentTime hasn't moved yet.
    act(() => { result.current.armLoop('back', 10, 252, 1110); });
    act(() => { el.fireTimeUpdate(); });

    expect(onSeek).not.toHaveBeenCalled();
    expect(result.current.loop).not.toBeNull();

    // Once playback genuinely advances, the boundary check is live again.
    el.currentTime = 253;
    act(() => { el.fireTimeUpdate(); });
    expect(onSeek).toHaveBeenCalledWith(242);
  });

  it('seeks back to start and resumes playback when a forward loop hits "ended"', () => {
    const el = makeEl(1100);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    // Forward loop clamped at duration: [1100, 1110].
    act(() => { result.current.armLoop('forward', 30, 1100, 1110); });
    act(() => { el.fire('ended'); });

    expect(onSeek).toHaveBeenCalledWith(1100);
    expect(el.playCalls).toBe(1);
    expect(result.current.isBoundarySeek()).toBe(true);
  });

  it('re-binds the timeupdate listener when the media element is replaced', () => {
    vi.useFakeTimers();
    try {
      const el1 = makeEl(0);
      const el2 = makeEl(0);
      let current = el1;
      const onSeek = vi.fn();
      const { result } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => current, onSeek }));

      act(() => { result.current.armLoop('forward', 10, 100, 1000); });

      // Simulate a resilience remount swapping the element, then let the poll catch up.
      current = el2;
      act(() => { vi.advanceTimersByTime(600); });

      // The new element now drives the loop.
      el2.currentTime = 111;
      act(() => { el2.fireTimeUpdate(); });
      expect(onSeek).toHaveBeenCalledWith(100);

      // The old element's listener was removed - it must not still be able to trigger seeks.
      onSeek.mockClear();
      el1.currentTime = 999;
      act(() => { el1.fireTimeUpdate(); });
      expect(onSeek).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
