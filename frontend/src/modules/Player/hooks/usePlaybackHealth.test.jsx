import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Logging is a side-effect we don't care about here — keep the suite quiet.
vi.mock('../lib/playbackLogger.js', () => ({
  playbackLog: vi.fn(),
  default: vi.fn()
}));

import { usePlaybackHealth } from './usePlaybackHealth.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

describe('usePlaybackHealth', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('re-attaches listeners to a swapped-in element so a stuck "waiting" can clear', () => {
    const el1 = makeFakeEl({ currentTime: 5 });
    const el2 = makeFakeEl({ currentTime: 5 });
    const holder = { current: el1 };
    const getMediaEl = () => holder.current;

    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 5, getMediaEl, waitKey: 'k1', mediaType: 'video' })
    );

    // A waiting event with no matching playing leaves us buffering.
    act(() => { el1._fire('waiting'); });
    expect(result.current.isWaiting).toBe(true);

    // softReinit swaps the <video>: the live element identity changes. The
    // watcher poll must detect it and re-bind the listener effect to el2.
    act(() => { holder.current = el2; vi.advanceTimersByTime(400); });

    // The OLD element's playing event must NOT clear state (it's gone)...
    act(() => { el1._fire('playing'); });
    expect(result.current.isWaiting).toBe(true);

    // ...but the NEW element's playing event must, proving we re-attached.
    act(() => { el2._fire('playing'); });
    expect(result.current.isWaiting).toBe(false);
  });

  it('reports isAdvancing while the clock moves, even with a lingering waiting flag', () => {
    const el = makeFakeEl({ currentTime: 10, paused: false });
    const getMediaEl = () => el;

    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 10, getMediaEl, waitKey: 'k1', mediaType: 'video' })
    );

    // Stuck buffering flag.
    act(() => { el._fire('waiting'); });
    expect(result.current.isWaiting).toBe(true);
    expect(result.current.isAdvancing).toBe(false);

    // currentTime climbs between poll samples → advancement is detected live,
    // independent of the (silent) media events. The consumer uses this to
    // suppress the stale spinner.
    act(() => { el.currentTime = 10.5; vi.advanceTimersByTime(400); });
    expect(result.current.isAdvancing).toBe(true);
    expect(result.current.isWaiting).toBe(true); // raw flag still set; guard lives downstream

    // Clock freezes → advancement falls back to false (real stall surfaces).
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.isAdvancing).toBe(false);
  });

  it('does not report advancement while paused', () => {
    const el = makeFakeEl({ currentTime: 20, paused: true });
    const getMediaEl = () => el;

    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 20, getMediaEl, waitKey: 'k1', mediaType: 'video' })
    );

    act(() => { el.currentTime = 20.5; vi.advanceTimersByTime(400); });
    expect(result.current.isAdvancing).toBe(false);
  });
});
