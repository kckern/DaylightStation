import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer.jsx';

beforeEach(() => {
  vi.useFakeTimers();
  // The DASH network/decoder is external to this timer contract. Keep the
  // actual custom element and its native-event forwarding in the test.
  vi.spyOn(customElements.get('dash-video').prototype, 'load').mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountVideo({ ownerOperation = false } = {}) {
  const result = render(<VideoPlayer media={{
    contentId: 'plex:movie-a', assetId: 'movie-a', mediaType: 'dash_video',
    title: 'Movie A', mediaUrl: '/movie-a.mpd',
  }} advance={() => {}} clear={() => {}} resilienceBridge={ownerOperation ? {
    remountDiagnostics: {
      remountClass: 'owner-operation',
      rendererOperation: { operationId: 'probe-held', targetSeconds: 0, autoplay: true },
    },
  } : undefined} />);
  const dash = result.container.querySelector('dash-video');
  const video = dash.shadowRoot.querySelector('video');
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = vi.spyOn(video, 'play').mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  return {
    ...result, video, play,
    start: (event = 'playing') => {
      paused = false;
      video.dispatchEvent(new Event(event));
    },
    pause: () => { paused = true; video.dispatchEvent(new Event('pause')); },
  };
}

describe('DASH startup autoplay probe', () => {
  it('cannot resume a movie paused after startup succeeded before the probe deadline', () => {
    const movie = mountVideo();
    act(() => {
      vi.advanceTimersByTime(1000);
      movie.start();
      movie.pause();
      vi.advanceTimersByTime(2500);
    });
    expect(movie.video.paused).toBe(true);
    expect(movie.play).not.toHaveBeenCalled();
  });

  it('still probes autoplay when playback has never started', () => {
    const movie = mountVideo();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(movie.play).toHaveBeenCalledTimes(1);
    expect(movie.video.paused).toBe(false);
  });

  it('respects pause after play is accepted but before the first playing event', () => {
    const movie = mountVideo();
    act(() => {
      vi.advanceTimersByTime(1000);
      movie.start('play');
      movie.pause();
      vi.advanceTimersByTime(2500);
    });
    expect(movie.video.paused).toBe(true);
    expect(movie.play).not.toHaveBeenCalled();
  });

  it('does not bypass the owner observer barrier with the three-second autoplay probe', () => {
    const movie = mountVideo({ ownerOperation: true });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(movie.play).not.toHaveBeenCalled();
    expect(movie.video.paused).toBe(true);
  });
});
