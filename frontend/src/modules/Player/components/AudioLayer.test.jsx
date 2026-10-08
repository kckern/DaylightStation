import React, { useEffect, useRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioLayer } from './AudioLayer.jsx';

vi.mock('../../../lib/volume/ScreenVolumeContext.js', () => ({
  useScreenVolume: () => ({ effectiveMaster: 1 }),
}));

function AudioPlayerStub({ volume }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.volume = volume;
  }, [volume]);
  return <audio ref={ref} data-player-volume={volume} />;
}

function installAnimationFrameClock() {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => callbacks.delete(id)));

  return {
    advance(ms) {
      now += ms;
      const pending = [...callbacks.values()];
      callbacks.clear();
      act(() => pending.forEach(callback => callback(now)));
    },
  };
}

describe('AudioLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ramps music down and back up over 300ms when a video starts and ends', async () => {
    const clock = installAnimationFrameClock();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'song-1', format: 'audio' }] }),
    }));
    const { container, rerender } = render(
      <AudioLayer
        contentId="plex:music"
        behavior="duck"
        duckLevel={0.25}
        currentItemMediaType="video"
        Player={AudioPlayerStub}
      />
    );

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    expect(container.querySelector('audio').volume).toBeCloseTo(1);

    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.625);

    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.25);
    expect(container.querySelector('audio').volume).toBeGreaterThan(0);

    rerender(
      <AudioLayer
        contentId="plex:music"
        behavior="duck"
        duckLevel={0.25}
        currentItemMediaType="image"
        Player={AudioPlayerStub}
      />
    );

    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.625);

    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(1);
  });

  it('reverses an in-flight restore without compounding the duck', async () => {
    const clock = installAnimationFrameClock();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'song-1', format: 'audio' }] }),
    }));
    const props = {
      contentId: 'plex:music', behavior: 'duck', duckLevel: 0.15, Player: AudioPlayerStub,
    };
    const { container, rerender } = render(
      <AudioLayer {...props} currentItemMediaType="video" />
    );
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    clock.advance(300);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.15);

    rerender(<AudioLayer {...props} currentItemMediaType="image" />);
    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.575);

    // Another video begins halfway through the restore. The new ramp starts
    // from the audible level, not from 1 or an already-ducked multiplier.
    rerender(<AudioLayer {...props} currentItemMediaType="video" />);
    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.3625);
    clock.advance(150);
    expect(container.querySelector('audio').volume).toBeCloseTo(0.15);
  });
});
