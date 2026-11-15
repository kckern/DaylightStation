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
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
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
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

describe('usePlaybackHealth', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('retains HLS decoded-frame progression as diagnostics', () => {
    let total = 10;
    const el = makeFakeEl({ getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: 2 }) });
    const { result } = renderHook(() => usePlaybackHealth({ seconds: 0, getMediaEl: () => el, waitKey: 'hls', mediaType: 'hls_video' }));
    expect(result.current.frameInfo).toMatchObject({ supported: true, total: 10, dropped: 2 });
    act(() => { total = 25; vi.advanceTimersByTime(500); });
    expect(result.current.frameInfo).toMatchObject({ advancing: true, total: 25 });
  });

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
    // Task 4.3: the raw key, greppable back to the item, AND the hash under a
    // separate name so this line still joins to the hash-only lines written
    // before 2026-08-16. `waitKey` was the hash here; a hashed line could not be
    // mapped back to anything, and the `:N` nonce ordinal was destroyed on entry.
    expect(generations()[0].data.waitKey).toBe('k1');
    expect(generations()[0].data.waitKeyHash).toBe(getLogWaitKey('k1'));
    expect(generations()[0].data.waitKeyHash).not.toBe(generations()[0].data.waitKey);
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

describe('usePlaybackHealth — recovery evidence', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const buffered = (ranges) => ({ length: ranges.length, start: (i) => ranges[i][0], end: (i) => ranges[i][1] });
  const frameElement = () => {
    let nextId = 0;
    const pending = new Map();
    const el = makeFakeEl({
      currentTime: 4, playbackRate: 2, buffered: buffered([[0, 10]]),
      requestVideoFrameCallback: (callback) => { pending.set(++nextId, callback); return nextId; },
      cancelVideoFrameCallback: (id) => pending.delete(id)
    });
    return { el, pending, submit: (presentedFrames) => {
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback(performance.now(), { presentedFrames, mediaTime: el.currentTime });
    } };
  };

  it('reports a gap as zero runway and adjusts contiguous runway for playback rate', () => {
    const el = makeFakeEl({ currentTime: 15, playbackRate: 1, buffered: buffered([[0, 10], [20, 30]]) });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'gap', mediaType: 'video' }));
    expect(result.current.bufferRunwayMs).toBe(0);
    expect(result.current.recoveryHealth.contiguousRunwayMs).toBe(0);
    act(() => { el.currentTime = 4; el.playbackRate = 2; vi.advanceTimersByTime(500); });
    expect(result.current.bufferRunwayMs).toBe(3000);
    expect(result.current.recoveryHealth.contiguousRunwayMs).toBe(3000);
  });

  it('keeps decoded-frame diagnostics separate from unavailable presentation evidence', () => {
    let total = 10;
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1, getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: total - 10 }) });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'decoded', mediaType: 'video' }));
    act(() => { total = 20; el.currentTime = 4.5; vi.advanceTimersByTime(500); });
    expect(result.current.frameInfo).toMatchObject({ total: 20, dropped: 10 });
    expect(result.current.recoveryHealth).toMatchObject({ clockAdvancing: true, presentationAdvancing: null, droppedFrameRatio: 1 });
    expect(result.current.isFrameAdvancing).toBeNull();
  });

  it('retains unknown dropped-frame evidence when a browser exposes only decoded frames', () => {
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1, webkitDecodedFrameCount: 10 });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'vendor', mediaType: 'video' }));
    act(() => { el.webkitDecodedFrameCount = 20; vi.advanceTimersByTime(500); });
    expect(result.current.frameInfo.dropped).toBeNull();
    expect(result.current.recoveryHealth.droppedFrameRatio).toBeNull();
  });

  it('preserves an unreadable native buffer as unknown', () => {
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1, buffered: { length: 1, start: () => { throw new Error('detached'); } } });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'unknown-buffer', mediaType: 'video' }));
    expect(result.current.recoveryHealth).toMatchObject({ contiguousRunwayMs: null, fresh: true });
    expect(result.current.bufferRunwayMs).toBeNull();
  });

  it('preserves an unavailable playback rate as unknown', () => {
    const el = makeFakeEl({ currentTime: 4, buffered: buffered([[0, 10]]) });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'unknown-rate', mediaType: 'video' }));
    expect(result.current.recoveryHealth).toMatchObject({ playbackRate: null, contiguousRunwayMs: null, fresh: false });
    expect(result.current.bufferRunwayMs).toBeNull();
  });

  it('uses clock progress for audio without inventing video presentation evidence', () => {
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1, buffered: buffered([[0, 10]]) });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'audio', mediaType: 'audio' }));
    act(() => { el.currentTime = 4.5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth).toMatchObject({ fresh: true, clockAdvancing: true, presentationAdvancing: null, contiguousRunwayMs: 5500 });
    expect(result.current.frameInfo.supported).toBe(false);
  });

  it('tracks submitted frames, cancels the old callback and ignores stale element callbacks', () => {
    const first = frameElement();
    const second = frameElement();
    const holder = { current: first.el };
    const { result, unmount } = renderHook(() => usePlaybackHealth({ getMediaEl: () => holder.current, waitKey: 'frames', mediaType: 'hls_video' }));
    act(() => { first.submit(10); vi.advanceTimersByTime(500); });
    act(() => { first.submit(20); first.el.currentTime = 4.5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth.presentationAdvancing).toBe(true);
    expect(result.current.lastProgressSource).toBe('frame');
    expect(result.current.lastProgressSeconds).toBe(4.5);
    const lateCallback = first.pending.values().next().value;
    act(() => { holder.current = second.el; vi.advanceTimersByTime(400); });
    expect(first.pending.size).toBe(0);
    expect(result.current.recoveryHealth.presentationAdvancing).toBeNull();
    act(() => { lateCallback(performance.now(), { presentedFrames: 999 }); vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth.presentationAdvancing).toBe(false);
    expect(first.pending.size).toBe(0);
    unmount();
    expect(second.pending.size).toBe(0);
  });

  it('marks hidden sampling and visibility return unknown until a fresh visible interval', () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1 });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'visible', mediaType: 'video' }));
    act(() => { el.currentTime = 4.5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth.clockAdvancing).toBe(true);
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); el.currentTime = 5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth).toMatchObject({ visible: false, fresh: false, clockAdvancing: null });
    expect(result.current.isAdvancing).toBe(false);
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.recoveryHealth).toMatchObject({ fresh: false, clockAdvancing: null });
    act(() => { el.currentTime = 5.5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth).toMatchObject({ fresh: true, clockAdvancing: true });
  });

  it('does not classify a long event-loop suspension as progress or a video freeze', () => {
    let monotonicMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicMs);
    const el = makeFakeEl({ currentTime: 4, playbackRate: 1 });
    const { result } = renderHook(() => usePlaybackHealth({ getMediaEl: () => el, waitKey: 'gap', mediaType: 'video' }));
    act(() => { monotonicMs = 5000; el.currentTime = 9; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth).toMatchObject({ fresh: false, clockAdvancing: null, presentationAdvancing: null });
    expect(result.current.isAdvancing).toBe(false);
    act(() => { monotonicMs = 5500; el.currentTime = 9.5; vi.advanceTimersByTime(500); });
    expect(result.current.recoveryHealth).toMatchObject({ fresh: true, clockAdvancing: true });
  });
});
