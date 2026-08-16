import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Logging is a side-effect we don't care about here — keep the suite quiet.
vi.mock('../lib/playbackLogger.js', () => ({
  playbackLog: vi.fn(),
  default: vi.fn()
}));

// …except the element-generation event, which IS the subject of one describe
// block below. Capture every sampled emit so a test can read it back.
const sampledCalls = [];
vi.mock('../../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    sampled: (event, data, opts) => { sampledCalls.push({ event, data, opts }); },
    child: function () { return this; }
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

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

// 2026-08-16: ~300 <video> elements were created in four minutes and the
// frontend log named three of them. The count had to be recovered from Plex's
// server log. This poll is the only place in the codebase that sees the swap,
// so it is the cheapest possible instrument for that failure.
describe('usePlaybackHealth — media element generation logging', () => {
  beforeEach(() => {
    sampledCalls.length = 0;
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => vi.useRealTimers());

  const generations = () => sampledCalls.filter((c) => c.event === 'media-element.generation');

  it('emits one rate-limited event per element swap, naming the element', () => {
    const el1 = makeFakeEl({ currentTime: 5, tagName: 'DASH-VIDEO' });
    const el2 = makeFakeEl({ currentTime: 5, tagName: 'VIDEO' });
    const holder = { current: el1 };

    renderHook(() =>
      usePlaybackHealth({
        seconds: 5,
        getMediaEl: () => holder.current,
        waitKey: 'k1',
        mediaKey: 'plex:694719',
        mediaType: 'video'
      })
    );

    // First attach is generation 1 — an element appearing where there was none
    // is an element generation, and during the storm it was the repeated one.
    expect(generations()).toHaveLength(1);
    expect(generations()[0].data).toMatchObject({
      generation: 1,
      mediaKey: 'plex:694719',
      elTag: 'dash-video',
      msSincePreviousSwap: null
    });
    expect(generations()[0].data.waitKey).toBeTruthy();
    expect(typeof generations()[0].data.instanceId).toBe('string');
    // A storm must not drown its own aggregate count.
    expect(generations()[0].opts).toMatchObject({ maxPerMinute: 30, aggregate: true });

    act(() => { vi.advanceTimersByTime(1200); holder.current = el2; vi.advanceTimersByTime(400); });

    expect(generations()).toHaveLength(2);
    expect(generations()[1].data).toMatchObject({
      generation: 2,
      elTag: 'video',
      msSincePreviousSwap: 1600
    });
  });

  it('says nothing while the element is unchanged', () => {
    const el = makeFakeEl({ currentTime: 5, tagName: 'VIDEO' });
    renderHook(() =>
      usePlaybackHealth({ seconds: 5, getMediaEl: () => el, waitKey: 'k1', mediaType: 'video' })
    );
    expect(generations()).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(4000); });
    expect(generations()).toHaveLength(1);
  });

  it('does not count a new waitKey over the same element as a new element', () => {
    const el = makeFakeEl({ currentTime: 5, tagName: 'VIDEO' });
    const { rerender } = renderHook(
      ({ waitKey }) => usePlaybackHealth({ seconds: 5, getMediaEl: () => el, waitKey, mediaType: 'video' }),
      { initialProps: { waitKey: 'k1' } }
    );
    expect(generations()).toHaveLength(1);

    // The watcher effect re-runs on waitKey and clears its attach ref; the
    // ledger must not read that as the element being replaced, or the very
    // count this event exists to measure would be inflated by media changes.
    act(() => { rerender({ waitKey: 'k2' }); vi.advanceTimersByTime(400); });
    expect(generations()).toHaveLength(1);
  });

  it('records whether the element came from a shadow root or was the container itself', () => {
    const shadowHost = { host: {} };
    const el = makeFakeEl({ currentTime: 5, tagName: 'VIDEO' });
    el.getRootNode = () => shadowHost;

    renderHook(() =>
      usePlaybackHealth({ seconds: 5, getMediaEl: () => el, waitKey: 'k1', mediaType: 'video' })
    );
    expect(generations()[0].data.elSource).toBe('shadow');

    sampledCalls.length = 0;
    const plain = makeFakeEl({ currentTime: 5, tagName: 'VIDEO' });
    renderHook(() =>
      usePlaybackHealth({ seconds: 5, getMediaEl: () => plain, waitKey: 'k2', mediaType: 'video' })
    );
    expect(generations()[0].data.elSource).toBe('container');
  });
});
