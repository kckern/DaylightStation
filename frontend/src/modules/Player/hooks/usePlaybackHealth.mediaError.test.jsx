import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({
  playbackLog: vi.fn(),
  default: vi.fn()
}));

vi.mock('../../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: function () { return this; }
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import { playbackLog } from '../lib/playbackLogger.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

/**
 * The 2026-09-03 incident shape: 284.92s were still buffered ahead of the
 * playhead when the proxied body died. A healthy buffer is the defining feature
 * of this failure — it is why no `waiting`/`stalled` ever fired — so the fixture
 * has to model one, not the starved default.
 */
const makeHealthyPlayingEl = (overrides = {}) => makeFakeEl({
  currentTime: 1037.93,
  duration: 1399.11,
  paused: false,
  readyState: 4,
  networkState: 2,
  buffered: { length: 1, start: () => 0, end: () => 1322.85 },
  ...overrides
});

/** The last `playback-health` payload logged under the given event name. */
const findHealthLog = (event) => playbackLog.mock.calls
  .filter((call) => call[0] === 'playback-health' && call[1]?.event === event)
  .pop();

describe('usePlaybackHealth — media errors', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    playbackLog.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('surfaces the error code when the element hard-errors mid-playback', () => {
    const el = makeHealthyPlayingEl();
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    expect(result.current.elementSignals.errorCode).toBe(null);

    // Chromium sets el.error, then fires 'error'. It does NOT fire waiting/stalled.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });

    expect(result.current.elementSignals.errorCode).toBe(2);
  });

  it('reads paused from the element rather than waiting for a pause event', () => {
    // The spec does not require a `pause` alongside `error`, and the garage
    // kiosk is Firefox — so the element, not a sibling event, is the authority.
    const el = makeHealthyPlayingEl();
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    expect(result.current.elementSignals.paused).toBe(false);

    act(() => {
      el.error = { code: 2, message: 'PIPELINE_ERROR_READ' };
      el.paused = true;
      el._fire('error'); // and NO 'pause' event
    });

    expect(result.current.elementSignals.paused).toBe(true);
    expect(result.current.elementSignals.playing).toBe(false);
  });

  it('logs the error as warn-level telemetry, with the states that classify it', () => {
    // logHealthEvent is the ONLY telemetry for this incident class — there is
    // deliberately no onError callback — so the payload has to carry enough to
    // tell a transient network death from NETWORK_NO_SOURCE.
    const el = makeHealthyPlayingEl();
    renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    act(() => {
      el.error = { code: 2, message: 'PIPELINE_ERROR_READ' };
      el.networkState = 3; // NETWORK_NO_SOURCE
      el._fire('error');
    });

    const call = findHealthLog('media-error');
    expect(call).toBeDefined();
    expect(call[1]).toMatchObject({
      event: 'media-error',
      errorCode: 2,
      errorMessage: 'PIPELINE_ERROR_READ',
      currentTime: 1037.93,
      readyState: 4,
      networkState: 3
    });
    expect(call[2].level).toBe('warn');
  });

  it('adopts a swapped-in element\'s error state instead of inheriting the dead one\'s', () => {
    // Once this feeds isStuck, the ladder's remount rung swaps the element. A
    // latched code surviving that swap would re-fire isStuck against a healthy
    // element, burn the next rung, and park the player in `exhausted`.
    const el1 = makeHealthyPlayingEl();
    const el2 = makeHealthyPlayingEl();
    const holder = { current: el1 };
    const getMediaEl = () => holder.current;

    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl, waitKey: 'k1', mediaType: 'audio' })
    );

    act(() => { el1.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el1._fire('error'); });
    expect(result.current.elementSignals.errorCode).toBe(2);

    // The swap watcher polls every 400ms and bumps elementGeneration.
    act(() => { holder.current = el2; vi.advanceTimersByTime(400); });

    expect(result.current.elementSignals.errorCode).toBe(null);
    expect(el2._count('error')).toBe(1);
  });

  // Only SOME MediaError codes are worth a recovery attempt; the ladder must not
  // burn a rung on an error we caused (1) or one no retry can fix (4).
  it.each([
    [2, true,  'MEDIA_ERR_NETWORK — the proxy died, re-minting can fix it'],
    [3, true,  'MEDIA_ERR_DECODE — a corrupt read, a fresh stream can fix it'],
    [1, false, 'MEDIA_ERR_ABORTED — WE aborted it (hardReset calls load())'],
    [4, false, 'MEDIA_ERR_SRC_NOT_SUPPORTED — unplayable, retrying is pointless'],
  ])('code %i -> hasMediaError %s (%s)', (code, expected) => {
    const el = makeHealthyPlayingEl();
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    expect(result.current.hasMediaError).toBe(false);

    act(() => { el.error = { code }; el._fire('error'); });

    expect(result.current.hasMediaError).toBe(expected);
  });

  it('clears the error when the same element resumes playing (the in-place rung-0 recovery)', () => {
    const el = makeHealthyPlayingEl();
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    act(() => { el.error = { code: 2 }; el._fire('error'); });
    expect(result.current.hasMediaError).toBe(true);

    // stall-jolt-refresh-url hard-resets the SAME element in place: no remount,
    // no waitKey change, so nothing re-seeds. Only 'playing' can clear this.
    act(() => { el.error = null; el._fire('playing'); });

    expect(result.current.hasMediaError).toBe(false);
    expect(result.current.elementSignals.errorCode).toBe(null);
  });

  it('clears the error when a remount swaps in a fresh element', () => {
    const el1 = makeHealthyPlayingEl();
    const el2 = makeHealthyPlayingEl();
    const holder = { current: el1 };
    const { result } = renderHook(() =>
      usePlaybackHealth({
        seconds: 1037.93, getMediaEl: () => holder.current, waitKey: 'k1', mediaType: 'audio'
      })
    );

    act(() => { el1.error = { code: 2 }; el1._fire('error'); });
    expect(result.current.hasMediaError).toBe(true);

    // The element-generation watcher re-binds to the new element.
    act(() => { holder.current = el2; vi.advanceTimersByTime(400); });

    expect(result.current.hasMediaError).toBe(false);
  });

  it('adopts a pre-existing error as dead, but never as "it stopped playback"', () => {
    // The seed's asymmetry, which until now was held only by a comment — and a
    // comment is no defence against a later "make both fields consistent" edit.
    //
    // Binding to an element that ALREADY carries `el.error` tells us the
    // pipeline is dead (so `hasMediaError` must be true — the ladder should
    // still get its chance). It does NOT tell us this error interrupted
    // anything: we never observed this element playing, so `errorWhilePlaying`
    // is seeded false and `mediaErrorStoppedPlayback` stays false. That field is
    // what overrides a reported pause in useMediaResilience, and claiming it on
    // hearsay would let a parked element be un-paused by the recovery ladder.
    //
    // The element is deliberately `paused: false`: reusing handleError's own
    // rule here (`mediaEl.paused !== true`) — the obvious way to "unify" the two
    // sites — would flip errorWhilePlaying true and fail this test.
    const el = makeHealthyPlayingEl({ error: { code: 2, message: 'PIPELINE_ERROR_READ' } });
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    expect(result.current.elementSignals.errorCode).toBe(2);
    expect(result.current.elementSignals.errorWhilePlaying).toBe(false);
    expect(result.current.hasMediaError).toBe(true);
    expect(result.current.mediaErrorStoppedPlayback).toBe(false);
  });

  it('removes the error listener on cleanup', () => {
    const el = makeFakeEl();
    const { unmount } = renderHook(() =>
      usePlaybackHealth({ seconds: 0, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );
    expect(el._count('error')).toBe(1);
    unmount();
    expect(el._count('error')).toBe(0);
  });
});
