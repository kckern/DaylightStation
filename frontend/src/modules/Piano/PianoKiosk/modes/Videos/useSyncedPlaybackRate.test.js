// useSyncedPlaybackRate.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSyncedPlaybackRate from './useSyncedPlaybackRate.js';

// A real EventTarget-backed stand-in for the resolved <video>/<audio> element —
// genuinely dispatches/subscribes to `ratechange`, rather than a spy object
// that just records calls. `setPlaybackRate` on the fake playerRef mirrors
// what the real Player does: mutate the element's playbackRate and let it
// report the change via a real `ratechange` event.
class FakeMediaEl extends EventTarget {
  constructor(rate = 1) {
    super();
    this.playbackRate = rate;
  }
  setRate(next) {
    this.playbackRate = next;
    this.dispatchEvent(new Event('ratechange'));
  }
}

function makePlayerRef(mediaEl) {
  return { current: { setPlaybackRate: vi.fn((r) => mediaEl.setRate(r)) } };
}

describe('useSyncedPlaybackRate', () => {
  let mediaEl;
  let playerRef;

  beforeEach(() => {
    mediaEl = new FakeMediaEl(1);
    playerRef = makePlayerRef(mediaEl);
  });

  it('(a) follows the element\'s ratechange — display mirrors the actual element', () => {
    const { result, rerender } = renderHook(
      ({ el }) => useSyncedPlaybackRate(el, playerRef),
      { initialProps: { el: mediaEl } }
    );
    expect(result.current.rate).toBe(1);

    // Something OTHER than our own cycleRate changes the element's rate
    // (e.g. the shared Player applying a queued rate). Display must follow.
    act(() => { mediaEl.setRate(1.75); });
    rerender({ el: mediaEl });
    expect(result.current.rate).toBe(1.75);
  });

  it('(b) re-applies the user\'s chosen rate to a freshly swapped-in element reset to 1x', () => {
    const { result, rerender } = renderHook(
      ({ el, pRef }) => useSyncedPlaybackRate(el, pRef),
      { initialProps: { el: mediaEl, pRef: playerRef } }
    );

    // User chooses 1.5x on the first element.
    act(() => { result.current.cycleRate(); }); // 1 -> 1.25
    act(() => { result.current.cycleRate(); }); // 1.25 -> 1.5
    expect(result.current.rate).toBe(1.5);

    // Source swap: a brand-new element appears, freshly reset to 1x (new
    // object identity — a real DASH/Plex source swap or remount). The SAME
    // hook instance now tracks it, mirroring how PianoVideoPlayer re-renders
    // with a new `mediaEl` from useResolvedMediaEl.
    const swappedEl = new FakeMediaEl(1);
    const swappedPlayerRef = { current: { setPlaybackRate: vi.fn((r) => swappedEl.setRate(r)) } };
    rerender({ el: swappedEl, pRef: swappedPlayerRef });

    // The hook must proactively re-apply the user's last-chosen 1.5x to the
    // new element — not leave it drifted at 1x — and do so exactly once
    // (no setState-then-setRate feedback loop re-firing the reapply).
    expect(swappedPlayerRef.current.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(swappedPlayerRef.current.setPlaybackRate).toHaveBeenCalledTimes(1);
    expect(result.current.rate).toBe(1.5);
  });

  it('(c) cycling advances from the current ACTUAL rate, not stale internal state', () => {
    const { result, rerender } = renderHook(
      ({ el }) => useSyncedPlaybackRate(el, playerRef),
      { initialProps: { el: mediaEl } }
    );

    // The element drifts to 2x from outside (not via cycleRate).
    act(() => { mediaEl.setRate(2); });
    rerender({ el: mediaEl });
    expect(result.current.rate).toBe(2);

    // Cycling from 2x should land on the NEXT ladder slot after 2x, which
    // wraps to 0.5x — not the slot after some stale pre-drift value.
    act(() => { result.current.cycleRate(); });
    expect(result.current.rate).toBe(0.5);
  });
});
