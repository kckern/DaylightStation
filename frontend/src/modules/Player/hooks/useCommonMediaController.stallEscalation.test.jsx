import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';

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

function Harness({ ctrlRef, video, stallConfig }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    stallConfig,
    onController: (c) => { ctrlRef.current = c; }
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController stall escalation', () => {
  let events;
  beforeEach(() => {
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
  afterEach(() => vi.restoreAllMocks());

  it('escalates nudge -> reload -> terminal (no infinite nudge loop)', () => {
    const ctrlRef = { current: null };
    const video = makeFakeVideo();
    render(<Harness ctrlRef={ctrlRef} video={video} stallConfig={{ recoveryStrategies: ['nudge', 'reload'] }} />);
    expect(ctrlRef.current).toBeTruthy();
    expect(ctrlRef.current.getMediaEl()).toBe(video);

    act(() => { ctrlRef.current.recovery.attemptNext(); });
    act(() => { ctrlRef.current.recovery.attemptNext(); });

    const strategies = events.filter(([e]) => e === 'playback.recovery-strategy').map(([, d]) => d.strategy);
    const terminal = events.filter(([e]) => e === 'playback.recovery-terminal');
    expect(strategies).toEqual(['nudge', 'reload']);
    expect(terminal.length).toBe(1);
  });

  it('resolves only on genuine forward advance, never on a frozen timeupdate', () => {
    vi.useFakeTimers();
    try {
      const ctrlRef = { current: null };
      const video = makeFakeVideo({ currentTime: 100 });
      render(<Harness ctrlRef={ctrlRef} video={video} stallConfig={{ softMs: 1200, hardMs: 8000, mode: 'manual' }} />);

      // Arm detection + establish a progress baseline, then freeze and elapse softMs.
      act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(ctrlRef.current.readStallState().status).toBe('stalled');

      // Non-advancing timeupdate (nudge / buffer poke) must NOT resolve.
      events.length = 0;
      act(() => { video._ct = 100.5; video.fire('timeupdate'); });
      expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(0);

      // Genuine forward advance must resolve exactly once.
      act(() => { video._ct = 102.0; video.fire('timeupdate'); });
      expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
