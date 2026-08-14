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
  // Real <video>/<audio> elements return a promise from play() that can reject
  // (autoplay policy, interrupted-by-pause, element torn down mid-call). Reject here too
  // so tests exercise the hook's rejection guard rather than masking it with `undefined`.
  play() { this.playCalls += 1; return Promise.reject(new Error('play() interrupted')); },
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

  it('does not release the loop on its own boundary seek', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    // The hook's own re-seek (reaching win.end) must not clear loopRef/loop - only an
    // explicit releaseLoop() call (or a genuine escape past win.start) does that.
    expect(result.current.loop).not.toBeNull();
  });

  it('returns a stable object identity across re-renders when loop state is unchanged', () => {
    const el = makeEl(0);
    const onSeek = vi.fn();
    const { result, rerender } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    const first = result.current;
    rerender();
    // A caller (FitnessPlayer's handleUserSeek) depends on this object's identity in
    // its own useCallback deps - a fresh literal every render would cascade into every
    // downstream memoized seek handler re-creating on every render.
    expect(result.current).toBe(first);
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

  it('seeks back to start and resumes playback when a forward loop hits "ended", without an unhandled rejection', async () => {
    const el = makeEl(1100);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    // Forward loop clamped at duration: [1100, 1110].
    act(() => { result.current.armLoop('forward', 30, 1100, 1110); });
    act(() => { el.fire('ended'); });

    expect(onSeek).toHaveBeenCalledWith(1100);
    expect(el.playCalls).toBe(1);

    // el.play() (see makeEl above) returns a REJECTED promise here. Let it settle: if the
    // hook's play()?.catch?.(() => {}) guard were missing or dropped, this would surface
    // as an unhandled promise rejection and fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  // A loop belongs to ONE item. Advancing the queue swaps `currentItem` but keeps this
  // hook instance (and `loopRef`) alive, so a surviving window would drag the NEXT
  // episode back into the PREVIOUS one's range - and the next item may be an ordinary
  // workout with no loop control on screen to release it with.
  describe('release on item change', () => {
    it('releases the armed loop when the played item changes', () => {
      const el = makeEl(0);
      const onSeek = vi.fn();
      const { result, rerender } = renderHook(
        ({ itemKey }) => useLoopWindow({ getMediaElement: () => el, onSeek, itemKey }),
        { initialProps: { itemKey: 'plex:696067' } }
      );

      act(() => { result.current.armLoop('forward', 10, 100, 1000); });
      expect(result.current.loop).not.toBeNull();

      // Next item in the queue.
      rerender({ itemKey: 'plex:696068' });
      expect(result.current.loop).toBeNull();

      // And the released window must not still be able to drag the new item back. A
      // non-zero resume position inside the old window is the realistic case.
      onSeek.mockClear();
      el.currentTime = 111;
      act(() => { el.fireTimeUpdate(); });
      expect(onSeek).not.toHaveBeenCalled();
    });

    it('does NOT release on an unrelated re-render with the same item', () => {
      const el = makeEl(0);
      const { result, rerender } = renderHook(
        ({ itemKey }) => useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn(), itemKey }),
        { initialProps: { itemKey: 'plex:696067' } }
      );

      act(() => { result.current.armLoop('forward', 10, 100, 1000); });
      rerender({ itemKey: 'plex:696067' });
      rerender({ itemKey: 'plex:696067' });
      expect(result.current.loop).not.toBeNull();
    });

    it('does not release a loop armed on the FIRST item at mount time', () => {
      const el = makeEl(0);
      const { result } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn(), itemKey: 'plex:696067' }));
      act(() => { result.current.armLoop('forward', 10, 100, 1000); });
      expect(result.current.loop).not.toBeNull();
    });
  });

  // Arming is a "run this now" gesture: the window is chosen while paused, so without
  // this the loop would sit armed and idle until a separate play tap.
  describe('arming starts playback', () => {
    it('calls onPlay when a loop is armed', () => {
      const el = makeEl(0);
      const onPlay = vi.fn();
      const { result } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn(), onPlay }));

      act(() => { result.current.armLoop('back', 10, 100, 1000); });
      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(result.current.loop).not.toBeNull();
    });

    it('does NOT start playback when the window is degenerate and nothing got armed', () => {
      const el = makeEl(0);
      const onPlay = vi.fn();
      const { result } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn(), onPlay }));

      // position 0 with a backward window -> computeLoopWindow returns null.
      act(() => { result.current.armLoop('back', 10, 0, 1000); });
      expect(result.current.loop).toBeNull();
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('tolerates an onPlay that returns undefined, and one whose promise rejects', async () => {
      const el = makeEl(0);
      // usePlayerController's `play` returns undefined; a raw media element's play()
      // returns a promise that can reject. Neither may throw or surface unhandled.
      const { result: r1 } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn(), onPlay: () => undefined }));
      act(() => { r1.current.armLoop('back', 10, 100, 1000); });
      expect(r1.current.loop).not.toBeNull();

      const { result: r2 } = renderHook(() => useLoopWindow({
        getMediaElement: () => el,
        onSeek: vi.fn(),
        onPlay: () => Promise.reject(new Error('play() interrupted'))
      }));
      act(() => { r2.current.armLoop('back', 10, 100, 1000); });
      expect(r2.current.loop).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('arms fine with no onPlay supplied at all', () => {
      const el = makeEl(0);
      const { result } = renderHook(() =>
        useLoopWindow({ getMediaElement: () => el, onSeek: vi.fn() }));
      act(() => { result.current.armLoop('back', 10, 100, 1000); });
      expect(result.current.loop).not.toBeNull();
    });
  });
});
