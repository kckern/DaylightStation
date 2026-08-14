import { useCallback, useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLoopWindow from './useLoopWindow.js';

vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

const makeEl = (t = 0) => ({
  currentTime: t,
  paused: false,
  _handlers: {},
  addEventListener(ev, fn) { this._handlers[ev] = fn; },
  removeEventListener(ev) { delete this._handlers[ev]; },
  fire(ev) { this._handlers[ev]?.(); },
  fireTimeUpdate() { this.fire('timeupdate'); },
  play() { return Promise.resolve(); },
});

/**
 * Reproduces FitnessPlayer.jsx's real wiring: a real `useLoopWindow`, a `handleSeek`
 * that stands in for the player's seek (assigns `currentTime` on the tracked element,
 * same as the real hook's `seekTo`), and a `handleUserSeek` wrapper built exactly the
 * way FitnessPlayer.jsx builds it — unconditional `releaseLoop()` before `handleSeek`.
 * The loop's own boundary re-seek goes through `handleSeek` directly (passed as
 * `onSeek`), bypassing `handleUserSeek` entirely, matching the production wiring.
 */
function useWiringHarness(el) {
  const handleSeek = useCallback((seconds) => {
    el.currentTime = seconds;
  }, [el]);

  const loopGetMediaElement = useCallback(() => el, [el]);
  const loopApi = useLoopWindow({ getMediaElement: loopGetMediaElement, onSeek: handleSeek });

  const handleUserSeek = useCallback((seconds) => {
    loopApi.releaseLoop();
    handleSeek(seconds);
  }, [loopApi, handleSeek]);

  return { loopApi, handleSeek, handleUserSeek };
}

describe('useLoopWindow + handleUserSeek wiring (FitnessPlayer.jsx contract)', () => {
  it('a genuine user seek releases the loop even after it has repeated more than once', () => {
    const el = makeEl(100);
    const { result } = renderHook(() => useWiringHarness(el));

    // Arm a forward loop [100, 110] at the pause point.
    act(() => { result.current.loopApi.armLoop('forward', 10, 100, 1000); });
    expect(result.current.loopApi.loop).not.toBeNull();

    // First repetition: playback reaches win.end, the loop's own boundary seek fires
    // (via `handleSeek` directly, NOT `handleUserSeek`) and jumps back to win.start.
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });
    expect(el.currentTime).toBe(100);
    expect(result.current.loopApi.loop).not.toBeNull();

    // Second repetition: same thing again. This is the reproduction step for the
    // regression — with the old sticky `isBoundarySeekRef` flag, the flag was left
    // `true` after this second boundary seek with nothing left to consume it.
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });
    expect(el.currentTime).toBe(100);
    expect(result.current.loopApi.loop).not.toBeNull();

    // Now the viewer taps a jog button / scrubs the footer — a genuine user seek,
    // routed through `handleUserSeek`. It must release the loop unconditionally: with
    // the old stale-flag bug, this call would have observed a leftover `true` and
    // skipped `releaseLoop()`, leaving the loop armed to snap the user right back on
    // the next `timeupdate`.
    act(() => { result.current.handleUserSeek(500); });

    expect(result.current.loopApi.loop).toBeNull();
    expect(el.currentTime).toBe(500);

    // And the released loop must actually stay released: a `timeupdate` well past the
    // old window must not re-seek the user back to win.start.
    el.currentTime = 501;
    act(() => { el.fireTimeUpdate(); });
    expect(el.currentTime).toBe(501);
  });

  it('the loop still repeats normally — its own boundary seek is not treated as a release', () => {
    const el = makeEl(100);
    const { result } = renderHook(() => useWiringHarness(el));

    act(() => { result.current.loopApi.armLoop('forward', 10, 100, 1000); });

    // Cycle twice via the loop's own boundary re-seek (bypasses handleUserSeek).
    for (let i = 0; i < 2; i += 1) {
      el.currentTime = 111;
      act(() => { el.fireTimeUpdate(); });
      expect(el.currentTime).toBe(100);
    }

    // Still armed — the loop's own re-seeks never call handleUserSeek/releaseLoop.
    expect(result.current.loopApi.loop).not.toBeNull();
  });
});
