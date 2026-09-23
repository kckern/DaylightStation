// Regression: 2026-09-22 garage fitness session. A `playing` listener was added
// on every element-setup effect run and never removed; since 18d032ae5 it called
// onProgress, so a DEAD onProgress closure (FitnessPlayer's, captured while
// governance was locked) re-paused the video on every play press.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';
import { _setSharedLedgerForTests, createRecoveryLedger } from '../lib/recoveryLedger.js';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({}))
}));

function makeFakeVideo({ currentTime = 100, duration = 1000 } = {}) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    paused: true,
    seeking: false,
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
    fire: (t) => { (listeners[t] || []).forEach(cb => cb({ type: t })); },
    count: (t) => (listeners[t] || []).length
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ video, onProgress, volume = 100 }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    onProgress,
    volume,
    onController: () => {}
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController listener lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const child = { info() {}, warn() {}, error() {}, debug() {}, sampled() {} };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child });
    _setSharedLedgerForTests(createRecoveryLedger({ cooldownMs: 60000 }));
  });

  afterEach(() => {
    _setSharedLedgerForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a constant number of playing/seeked listeners across effect re-runs', () => {
    const video = makeFakeVideo();
    const onProgress = vi.fn();
    const { rerender } = render(<Harness video={video} onProgress={onProgress} volume={100} />);
    const playing = video.count('playing');
    const seeked = video.count('seeked');

    // `volume` is an element-setup effect dependency: each change re-runs it.
    for (let v = 90; v >= 50; v -= 10) {
      rerender(<Harness video={video} onProgress={onProgress} volume={v} />);
    }

    expect(video.count('playing')).toBe(playing);
    expect(video.count('seeked')).toBe(seeked);
  });

  it('never calls a superseded onProgress on play, seeked, or timeupdate', () => {
    const video = makeFakeVideo();
    const stale = vi.fn();
    const live = vi.fn();
    const { rerender } = render(<Harness video={video} onProgress={stale} volume={100} />);
    rerender(<Harness video={video} onProgress={live} volume={90} />);
    stale.mockClear();

    act(() => {
      video.paused = false;
      video.fire('play');
      video.fire('playing');
      video.fire('seeked');
      video._ct = 100.5;
      video.fire('timeupdate');
    });

    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalled();
  });

  it('does not publish progress from the playing event (only seeked/timeupdate do)', () => {
    const video = makeFakeVideo();
    const onProgress = vi.fn();
    render(<Harness video={video} onProgress={onProgress} />);
    onProgress.mockClear();

    act(() => { video.paused = false; video.fire('playing'); });

    expect(onProgress).not.toHaveBeenCalled();
  });
});
