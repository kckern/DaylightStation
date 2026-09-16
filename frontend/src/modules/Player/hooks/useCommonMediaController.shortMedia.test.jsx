/**
 * The shared Player's unmount progress-save must handle media shorter than 10s.
 *
 * Navigating away from an item saves its final position so it can be resumed,
 * but bailed out below ten seconds to avoid recording a scrub-through. For an
 * item whose whole duration is under ten seconds that floor is unreachable, so
 * nothing was ever saved — the same absolute-floor bug as the piano watch-log
 * and the `/play/log` route (see play.shortMedia.test.mjs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({})),
}));

/** No shadowRoot, so the hook treats the container itself as the media element. */
function makeFakeVideo({ currentTime, duration }) {
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
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter((f) => f !== cb); },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }),
    fire: (t) => { (listeners[t] || []).forEach((cb) => cb({ type: t })); },
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ video, assetId }) {
  const api = useCommonMediaController({
    meta: { assetId, title: 'Coming Soon!' },
    isVideo: true,
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

const logCalls = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log');

beforeEach(() => { DaylightAPI.mockClear(); });

describe('useCommonMediaController — unmount save for short media', () => {
  it('saves progress for a 9.45s item navigated away from at the end', () => {
    const el = makeFakeVideo({ currentTime: 9.45, duration: 9.451 });
    const view = render(<Harness video={el} assetId="plex:694748" />);

    act(() => { el.fire('durationchange'); el.fire('timeupdate'); });
    view.unmount();

    expect(logCalls()).toHaveLength(1);
    expect(logCalls()[0][1]).toMatchObject({ assetId: 'plex:694748' });
  });

  it('does not save a scrub a few seconds into a long item', () => {
    const el = makeFakeVideo({ currentTime: 3, duration: 523 });
    const view = render(<Harness video={el} assetId="plex:694742" />);

    act(() => { el.fire('durationchange'); el.fire('timeupdate'); });
    view.unmount();

    expect(logCalls()).toHaveLength(0);
  });
});
