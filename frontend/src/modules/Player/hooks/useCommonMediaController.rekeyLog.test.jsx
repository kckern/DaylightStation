/**
 * Which recovery re-keyed the media element — Task 4.10.
 *
 * VideoPlayer already reports that an element was replaced and names `elementKey`
 * as the input that moved. What it cannot say is which of this hook's paths moved
 * it, and there are two: a soft re-init after a stall, and a media change resetting
 * the generation counter. Both used to be recorded by `console.log` calls behind
 * `const DEBUG_MEDIA = false`, so neither reached production, and downstream the
 * two were the same event.
 *
 * `reason` is the field these tests exist for. During the 2026-08-16 storm this
 * path ran faster than any per-line record could hold, so the aggregated count
 * per reason is what a diagnosis would actually be read from.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({}))
}));

// Mirrors the constants in useCommonMediaController.js.
const SOFT_STALL_MS = 1200;
const HARD_STALL_MS = 8000;
const STALL_CHECK_INTERVAL_MS = Math.min(500, SOFT_STALL_MS / 3);
const SESSION_KEY = 'session:rekey';

/** No shadowRoot, so the hook treats the container itself as the media element. */
function makeFakeVideo({ currentTime = 100, duration = 1000, destroy } = {}) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    paused: false,
    ended: false,
    readyState: 4,
    networkState: 2,
    shadowRoot: null,
    buffered: { length: 1, start: () => 0, end: () => duration },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter(f => f !== cb); },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }),
    fire: (t) => { (listeners[t] || []).forEach(cb => cb({ type: t })); }
  };
  if (destroy) el.destroy = destroy;
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

/**
 * One capture, shared by every test in the file.
 *
 * The hook's `mcLog()` memoises its child logger in module scope on first use,
 * so the first spy installed wins for the lifetime of the module and a
 * per-describe stub would be silently bypassed. The stub therefore stays one
 * object and writes through to whatever arrays `captured` currently holds.
 */
const captured = { sampled: [], warns: [] };

const loggerStub = {
  info: () => {},
  error: () => {},
  debug: () => {},
  warn: (event, data) => captured.warns.push([event, data]),
  sampled: (event, data, options) => captured.sampled.push({ event, data, options })
};

const installLogger = () => {
  captured.sampled = [];
  captured.warns = [];
  vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...loggerStub, child: () => loggerStub });
};

function Harness({ ctrlRef, video, assetId }) {
  const api = useCommonMediaController({
    meta: { assetId, title: 'T' },
    isVideo: true,
    recoverySessionKey: SESSION_KEY,
    onController: (c) => { ctrlRef.current = c; }
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController — element re-key reporting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installLogger();
    _setSharedLedgerForTests(createRecoveryLedger({ cooldownMs: 60000 }));
  });

  afterEach(() => {
    _setSharedLedgerForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const rekeys = () => captured.sampled.filter((s) => s.event === 'playback.element-rekey-requested');

  /** Arms stall detection, then freezes the playhead past the soft threshold. */
  function renderStalled({ assetId = 'plex:1', video } = {}) {
    const ctrlRef = { current: null };
    const el = video || makeFakeVideo();
    const view = render(<Harness ctrlRef={ctrlRef} video={el} assetId={assetId} />);
    act(() => { el._ct = 100.5; el.fire('timeupdate'); el.fire('playing'); });
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
    return { ctrlRef, video: el, view };
  }

  /** Loses the duration, which escalates the stall to a soft re-init. */
  function escalateToSoftReinit(video) {
    act(() => { video.duration = NaN; });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
  }

  it('says nothing on the first media: a mount is not a re-key', () => {
    render(<Harness ctrlRef={{ current: null }} video={makeFakeVideo()} assetId="plex:1" />);
    expect(rekeys()).toHaveLength(0);
  });

  it('names the soft re-init that replaced the element', () => {
    const { video } = renderStalled();
    escalateToSoftReinit(video);

    expect(rekeys()).toHaveLength(1);
    expect(rekeys()[0].data).toMatchObject({
      reason: 'soft-reinit',
      mediaKey: 'plex:1',
      from: 0,
      to: 1
    });
  });

  it('carries what the re-init was trying to do and whether teardown worked', () => {
    const { video } = renderStalled();
    escalateToSoftReinit(video);

    const data = rekeys()[0].data;
    expect(data.targetTime).toEqual(expect.any(Number));
    expect(data.seekBackSeconds).toEqual(expect.any(Number));
    // No destroy method on the fake element, so nothing was torn down. A
    // re-key without a teardown is how two dash.js players end up live at once.
    expect(data.hostDestroyed).toBe(false);
    expect(data.mediaDestroyed).toBe(false);
  });

  it('reports a teardown that did happen', () => {
    const video = makeFakeVideo({ destroy: vi.fn() });
    renderStalled({ video });
    escalateToSoftReinit(video);

    expect(rekeys()[0].data.hostDestroyed).toBe(true);
  });

  it('names the media change when a new item resets a bumped counter', () => {
    const video = makeFakeVideo();
    const { view } = renderStalled({ video });
    escalateToSoftReinit(video);
    expect(rekeys()).toHaveLength(1);

    act(() => {
      view.rerender(<Harness ctrlRef={{ current: null }} video={video} assetId="plex:2" />);
    });

    expect(rekeys()).toHaveLength(2);
    expect(rekeys()[1].data).toMatchObject({
      reason: 'media-changed',
      mediaKey: 'plex:2',
      from: 1,
      to: 0
    });
  });

  it('stays quiet when a media change resets a counter that is already zero', () => {
    const video = makeFakeVideo();
    const view = render(<Harness ctrlRef={{ current: null }} video={video} assetId="plex:1" />);

    act(() => {
      view.rerender(<Harness ctrlRef={{ current: null }} video={video} assetId="plex:2" />);
    });

    // Nothing was given up, so there is nothing to report. An event that fires
    // when no element changed is the defect this sweep removes, not one to add.
    expect(rekeys()).toHaveLength(0);
  });

  it('is rate limited, because this is the path that stormed', () => {
    const { video } = renderStalled();
    escalateToSoftReinit(video);
    expect(rekeys()[0].options).toMatchObject({ maxPerMinute: 30, aggregate: true });
  });

  it('carries the mount identity, so a re-key ties to its recovery budget', () => {
    const { video } = renderStalled();
    escalateToSoftReinit(video);
    expect(rekeys()[0].data.mountId).toMatch(/^controller-mount-\d+$/);
  });
});

describe('useCommonMediaController — a failed teardown reaches production', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    installLogger();
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _setSharedLedgerForTests(createRecoveryLedger({ cooldownMs: 60000 }));
  });

  afterEach(() => {
    _setSharedLedgerForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports a destroy that threw through the logger, not the console', () => {
    const video = makeFakeVideo({
      destroy: vi.fn(() => { throw new Error('player already gone'); })
    });
    const ctrlRef = { current: null };
    render(<Harness ctrlRef={ctrlRef} video={video} assetId="plex:1" />);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
    act(() => { video.duration = NaN; });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });

    const failures = captured.warns.filter(([e]) => e === 'playback.soft-reinit-destroy-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toMatchObject({
      mediaKey: 'plex:1',
      method: 'destroy',
      error: 'player already gone'
    });
    // The project rule: nothing in frontend/src reports through the console,
    // where no transport can carry it off the device.
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
