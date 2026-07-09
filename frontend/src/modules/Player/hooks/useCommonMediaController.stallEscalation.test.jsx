import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';

// The controller logs playback progress to the backend; stub the API client so
// timeupdate-driven logProgress calls can't hit the network (the old version of
// this file leaked one as an unhandled rejection).
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({}))
}));

// Stall-detection timing (mirrors the constants in useCommonMediaController.js).
const SOFT_STALL_MS = 1200;
const HARD_STALL_MS = 8000;

// A stubbed media element getMediaEl() will accept: no shadowRoot, so the hook
// treats the container itself as the media element.
function makeFakeVideo({ currentTime = 100, duration = 1000 } = {}) {
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
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ ctrlRef, apiRef, video }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    onController: (c) => { ctrlRef.current = c; }
  });
  apiRef.current = api;
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController stall detection and auto recovery', () => {
  let events;
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    const child = {
      info: (e, d) => events.push([e, d]),
      warn: (e, d) => events.push([e, d]),
      error: (e, d) => events.push([e, d]),
      debug: () => {},
      sampled: () => {}
    };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child, sampled: () => {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Arms detection with a progress baseline, then freezes the playhead past softMs.
  function renderStalled() {
    const ctrlRef = { current: null };
    const apiRef = { current: null };
    const video = makeFakeVideo({ currentTime: 100 });
    render(<Harness ctrlRef={ctrlRef} apiRef={apiRef} video={video} />);
    expect(ctrlRef.current.getMediaEl()).toBe(video);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + 300); });
    return { ctrlRef, apiRef, video };
  }

  const strategiesFired = () =>
    events.filter(([e]) => e === 'playback.recovery-strategy').map(([, d]) => d.strategy);

  it('flags a soft stall after softMs without playhead progress', () => {
    const { ctrlRef, apiRef } = renderStalled();

    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    expect(apiRef.current.isStalled).toBe(true);
    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(1);
    // Soft threshold alone must not trigger any recovery strategy yet.
    expect(strategiesFired()).toEqual([]);
  });

  it('auto-fires exactly one nudge at the hard threshold; a continuous stall never auto-reloads', () => {
    const { video } = renderStalled();

    // Cross the hard threshold: the ladder's first rung (nudge) fires.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);
    // The nudge rewound the playhead by 1ms and tried to resume playback.
    expect(video._ct).toBeCloseTo(100.499, 3);
    expect(video.pause).toHaveBeenCalled();
    expect(video.play).toHaveBeenCalled();

    // Stall persists: detection early-returns while isStalled, so the hard
    // timer never re-arms — no reload, no terminal, one nudge per episode.
    act(() => { vi.advanceTimersByTime(60000); });
    expect(strategiesFired()).toEqual(['nudge']);
    expect(events.filter(([e]) => e === 'playback.recovery-terminal').length).toBe(0);
  });

  it('escalates directly to softReinit when duration is lost during a stall', () => {
    const { video } = renderStalled();

    act(() => { video.duration = NaN; });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });

    expect(events.filter(([e]) => e === 'playback.duration-lost').length).toBe(1);
    expect(strategiesFired()).toEqual(['softReinit']);
  });

  it('resolves only on genuine forward advance, never on a frozen timeupdate', () => {
    const { ctrlRef, apiRef, video } = renderStalled();

    // Non-advancing timeupdate (nudge / buffer poke) must NOT resolve.
    act(() => { video._ct = 100.5; video.fire('timeupdate'); });
    expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(0);
    expect(ctrlRef.current.readStallState().status).toBe('stalled');

    // Escalate past the hard threshold so recovery state is genuinely
    // non-default before the resume: one nudge fires and the counters advance.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);
    const mid = ctrlRef.current.readStallState();
    expect(mid.attemptIndex).toBe(1);
    expect(mid.strategy).toBe('nudge');

    // Genuine forward advance resolves exactly once and resets escalation
    // state back to defaults. (The nudge's pause() left the fake paused and
    // its play() mock never flips it back, so mark the element playing again
    // — real resumed playback is not paused.)
    act(() => { video.paused = false; video._ct = 102.0; video.fire('timeupdate'); });
    expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(1);
    const snap = ctrlRef.current.readStallState();
    expect(snap.status).toBe('monitoring');
    expect(snap.attemptIndex).toBe(0);
    expect(snap.strategy).toBe(null);
    expect(snap.terminal).toBe(false);
    expect(apiRef.current.isStalled).toBe(false);

    // markProgress re-armed detection: a second stall episode after the
    // resume is detected fresh and fires a second nudge, proving the
    // escalation ladder restarts from rung one.
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + 300); });
    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge', 'nudge']);
  });
});
