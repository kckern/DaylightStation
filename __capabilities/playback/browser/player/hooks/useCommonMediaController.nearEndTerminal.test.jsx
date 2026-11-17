/**
 * A track that plays to its natural end must finish, wherever the stall check
 * happens to land.
 *
 * The soft stall check exempts the last half second of a track from stall
 * recovery. It used to do that by setting `hasEnded`, the same flag
 * `finishTerminal` reads to refuse a second terminal. A check that ran inside
 * that half second therefore claimed the end before the element reached it,
 * and the real `ended` event was refused: no `playback.ended`, no `onEnd`, no
 * queue advance. On 2026-11-17 a read-along on the living-room TV parked at
 * 244.6s of 245.1s that way and the story was never credited.
 *
 * Renderers without a terminal gate (AudioPlayer) are the exposed ones; with a
 * gate the near-end branch is skipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../../../frontend/src/lib/logging/Logger.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({})),
}));

// Mirrors the constants in useCommonMediaController.js.
const SOFT_STALL_MS = 1200;
const STALL_CHECK_INTERVAL_MS = Math.min(500, SOFT_STALL_MS / 3);

/** No shadowRoot, so the hook treats the container itself as the media element. */
function makeFakeAudio({ currentTime, duration }) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    tagName: 'AUDIO',
    paused: false,
    seeking: false,
    ended: false,
    readyState: 4,
    networkState: 1,
    shadowRoot: null,
    buffered: { length: 1, start: () => 0, end: () => duration },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter((f) => f !== cb); },
    fire: (t) => { (listeners[t] || []).forEach((cb) => cb({ type: t })); },
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ audio, onEnd }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:674723', title: 'Story' },
    isAudio: true,
    onEnd,
  });
  useEffect(() => { api.containerRef.current = audio; }, [api, audio]);
  return null;
}

describe('useCommonMediaController: natural end after a near-end stall check', () => {
  // One array for the whole file: the controller caches its child logger at
  // module level, so a per-test array would stop receiving after the first test.
  const events = [];

  beforeEach(() => {
    vi.useFakeTimers();
    events.length = 0;
    const child = {
      info: (e, d) => events.push([e, d]),
      warn: (e, d) => events.push([e, d]),
      error: (e, d) => events.push([e, d]),
      debug: () => {},
      sampled: () => {},
    };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('still ends the track when the stall check ran inside the last half second', () => {
    const onEnd = vi.fn();
    const audio = makeFakeAudio({ currentTime: 240, duration: 245.109841 });
    render(<Harness audio={audio} onEnd={onEnd} />);

    // Playing normally; `playing` arms the soft stall check.
    act(() => { audio.fire('durationchange'); audio.fire('playing'); audio.fire('timeupdate'); });

    // The check fires with the playhead 0.47s from the end, still playing.
    audio.currentTime = 244.637355;
    act(() => { vi.advanceTimersByTime(STALL_CHECK_INTERVAL_MS + 50); });
    expect(events.map(([e]) => e)).toContain('playback.at-duration-stuck');

    // The element then reaches the end and says so.
    audio.currentTime = 245.109841;
    audio.ended = true;
    audio.paused = true;
    act(() => { audio.fire('ended'); });

    expect(events.map(([e]) => e)).toContain('playback.ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends the track once when `ended` fires twice', () => {
    const onEnd = vi.fn();
    const audio = makeFakeAudio({ currentTime: 240, duration: 245.109841 });
    render(<Harness audio={audio} onEnd={onEnd} />);
    act(() => { audio.fire('durationchange'); audio.fire('playing'); audio.fire('timeupdate'); });

    audio.currentTime = 245.109841;
    audio.ended = true;
    act(() => { audio.fire('ended'); audio.fire('ended'); });

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
