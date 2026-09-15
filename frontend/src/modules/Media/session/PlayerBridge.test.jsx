// frontend/src/modules/Media/session/PlayerBridge.test.jsx
// Guards the PlayerBridge header contract: "The tree shape is identical
// whether hidden or portal-hosted, so navigating to/from Now Playing never
// remounts the Player (audio continues across all views)."
import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { usePlayerHost } from './usePlayerHost.js';
import { createLocalSessionController } from './LocalSessionController.js';

// Count how many times the platform Player is actually mounted. A remount is
// what destroys the media element mid-play() and produces the browser's
// "The play() request was interrupted because the media was removed from the
// document" AbortError.
const mountSpy = vi.fn();
let latestPlayerProps = null;
let mediaElement = null;
let mountedContentId = null;
vi.mock('../../Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(props, ref) {
    latestPlayerProps = props;
    React.useImperativeHandle(ref, () => ({
      play: () => mediaElement?.play?.(),
      pause: () => mediaElement?.pause?.(),
      seek: (seconds) => { if (mediaElement) mediaElement.currentTime = seconds; },
      getMediaElement: () => mediaElement,
      getMountedContentId: () => mountedContentId,
    }));
    React.useEffect(() => { mountSpy(); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

// Imported after the mock so PlayerBridge picks up the mocked Player.
const { PlayerBridge } = await import('./PlayerBridge.jsx');

function makeController() {
  const snapshot = {
    currentItem: {
      contentId: 'plex:592837',
      title: 'Faith (Music)',
      format: 'audio',
      duration: 1729,
      thumbnail: null,
    },
    position: 0,
    config: { volume: 100 },
    state: 'loading',
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    setPlayerHandle: () => {},
    onPlayerEnded: () => {},
    onPlayerStateChange: () => {},
    onPlayerStalled: () => {},
    onPlayerPositionTick: () => {},
    onPlayerProgress: () => {},
  };
}

function makeRealController() {
  return createLocalSessionController({
    clientId: 'bridge-client',
    randomUuid: () => 'bridge-session',
    nowFn: () => new Date('2026-09-14T00:00:00.000Z'),
  });
}

// A view that claims the Player host, mirroring NowPlayingView (priority 2).
function HostClaimant() {
  const ref = useRef(null);
  usePlayerHost(ref, 2);
  return <div ref={ref} data-testid="np-host" />;
}

function Harness({ controller }) {
  const [showHost, setShowHost] = useState(false);
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider>
        <button type="button" data-testid="toggle" onClick={() => setShowHost((v) => !v)}>
          toggle
        </button>
        {showHost ? <HostClaimant /> : null}
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

describe('PlayerBridge host transitions', () => {
  beforeEach(() => {
    mountSpy.mockClear();
    latestPlayerProps = null;
    mediaElement = null;
    mountedContentId = null;
  });

  it('does not remount the Player when a view claims the host', () => {
    // Reproduces the 2026-08-16 mobile session: an audio track is dispatched
    // while no view holds a host claim, so the Player mounts into the
    // off-screen park (left:-10000px). A host claim then arrives.
    const { getByTestId } = render(<Harness controller={makeController()} />);
    expect(mountSpy).toHaveBeenCalledTimes(1);

    act(() => { getByTestId('toggle').click(); });

    // Contract: the Player moves into the host without being torn down.
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('does not remount the Player when the host claim is released', () => {
    const { getByTestId } = render(<Harness controller={makeController()} />);
    act(() => { getByTestId('toggle').click(); });
    mountSpy.mockClear();

    act(() => { getByTestId('toggle').click(); });

    expect(mountSpy).toHaveBeenCalledTimes(0);
  });
});

describe('PlayerBridge real Player contract', () => {
  beforeEach(() => {
    mountSpy.mockClear();
    latestPlayerProps = null;
    mediaElement = null;
    mountedContentId = null;
  });

  it('enriches missing duration/format from the real progress payload without replacing Player playback identity', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:665667', title: 'Disclosure Day', duration: null, format: null });
    render(<Harness controller={controller} />);
    const originalPlay = latestPlayerProps.play;

    act(() => latestPlayerProps.onProgress({
      currentTime: 4.25,
      duration: 5400.5,
      paused: false,
      isSeeking: false,
      stalled: false,
      media: {
        contentId: 'plex:665667',
        title: 'Disclosure Day',
        format: 'video',
        mediaType: 'dash_video',
      },
    }));

    expect(controller.getSnapshot().currentItem).toEqual(expect.objectContaining({
      contentId: 'plex:665667', duration: 5400.5, format: 'video', mediaType: 'dash_video',
    }));
    expect(controller.getSnapshot().queue.items[0]).toEqual(expect.objectContaining({
      contentId: 'plex:665667', duration: 5400.5, format: 'video', mediaType: 'dash_video',
    }));
    expect(latestPlayerProps.play).toBe(originalPlay);
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('seeks actual media on every same-content adoption, including an identical repeated offset', () => {
    const controller = makeRealController();
    controller.queue.playNow({
      contentId: 'plex:665667', title: 'Disclosure Day', duration: 5400, format: 'video',
    });
    mediaElement = document.createElement('video');
    Object.defineProperty(mediaElement, 'currentTime', {
      configurable: true, writable: true, value: 42,
    });
    Object.defineProperty(mediaElement, 'paused', {
      configurable: true, value: true,
    });
    mediaElement.play = vi.fn();
    mountedContentId = 'plex:665667';
    render(<Harness controller={controller} />);
    const adopted = {
      ...controller.getSnapshot(),
      position: 87,
      currentItem: { ...controller.getSnapshot().currentItem },
    };

    act(() => controller.lifecycle.adoptSnapshot(adopted, { autoplay: false }));
    expect(mediaElement.currentTime).toBe(87);
    expect(mediaElement.play).not.toHaveBeenCalled();
    expect(mediaElement.paused).toBe(true);

    mediaElement.currentTime = 120;
    act(() => controller.lifecycle.adoptSnapshot(adopted, { autoplay: false }));
    expect(mediaElement.currentTime).toBe(87);
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('seeks actual paused media to zero and resumes it for a same-content LOAD generation', () => {
    const controller = makeRealController();
    const item = {
      contentId: 'plex:665667', title: 'Disclosure Day', duration: 5400, format: 'video',
    };
    controller.queue.playNow(item);
    mediaElement = document.createElement('video');
    Object.defineProperty(mediaElement, 'currentTime', {
      configurable: true, writable: true, value: 42,
    });
    let paused = true;
    Object.defineProperty(mediaElement, 'paused', {
      configurable: true, get: () => paused,
    });
    mediaElement.play = vi.fn(() => {
      paused = false;
      return Promise.resolve();
    });
    mountedContentId = 'plex:665667';
    render(<Harness controller={controller} />);

    act(() => controller.queue.playNow(item));

    expect(mediaElement.currentTime).toBe(0);
    expect(mediaElement.play).toHaveBeenCalledTimes(1);
    expect(mediaElement.paused).toBe(false);
    act(() => mediaElement.dispatchEvent(new Event('playing')));
    expect(controller.getSnapshot().state).toBe('playing');
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('does not seek or play the mounted old media during a cross-content queue load', () => {
    const controller = makeRealController();
    controller.queue.playNow({
      contentId: 'plex:old', title: 'Old', duration: 300, format: 'video',
    });
    mediaElement = document.createElement('video');
    Object.defineProperty(mediaElement, 'currentTime', {
      configurable: true, writable: true, value: 42,
    });
    Object.defineProperty(mediaElement, 'paused', {
      configurable: true, value: true,
    });
    mediaElement.play = vi.fn();
    mountedContentId = 'plex:old';
    render(<Harness controller={controller} />);

    act(() => controller.queue.playNow({
      contentId: 'plex:new', title: 'New', duration: 600, format: 'video',
    }));

    expect(mediaElement.currentTime).toBe(42);
    expect(mediaElement.play).not.toHaveBeenCalled();
    expect(latestPlayerProps.play.contentId).toBe('plex:new');

    // Repeating B while its replacement is still pending must still leave the
    // accessor's actually mounted A alone.
    act(() => controller.queue.playNow({
      contentId: 'plex:new', title: 'New', duration: 600, format: 'video',
    }));
    expect(mediaElement.currentTime).toBe(42);
    expect(mediaElement.play).not.toHaveBeenCalled();

    // Once Player exposes B's native element, an explicit B generation owns
    // that element and must retain the same-content restart behavior.
    const newMediaElement = document.createElement('video');
    Object.defineProperty(newMediaElement, 'currentTime', {
      configurable: true, writable: true, value: 55,
    });
    newMediaElement.play = vi.fn();
    mediaElement = newMediaElement;
    mountedContentId = 'plex:new';
    act(() => controller.queue.playNow({
      contentId: 'plex:new', title: 'New', duration: 600, format: 'video',
    }));
    expect(newMediaElement.currentTime).toBe(0);
    expect(newMediaElement.play).toHaveBeenCalledTimes(1);
  });

  it('rejects callbacks from the previous generation of the same content ID', () => {
    const controller = makeRealController();
    controller.queue.playNow({
      contentId: 'plex:665667', title: 'Disclosure Day', duration: null, format: 'video',
    });
    render(<Harness controller={controller} />);
    const previousProgress = latestPlayerProps.onProgress;
    const adopted = {
      ...controller.getSnapshot(),
      position: 87,
      currentItem: { ...controller.getSnapshot().currentItem },
    };
    act(() => controller.lifecycle.adoptSnapshot(adopted, { autoplay: false }));

    act(() => previousProgress({
      currentTime: 200,
      duration: 999,
      paused: false,
      stalled: false,
      media: { contentId: 'plex:665667', format: 'video' },
    }));

    expect(controller.position.get().seconds).toBe(87);
    expect(controller.getSnapshot().currentItem.duration).toBeNull();
  });

  it('ignores a late progress callback retained by the previous content item', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:old', title: 'Old', duration: null, format: null });
    render(<Harness controller={controller} />);
    const oldProgress = latestPlayerProps.onProgress;

    act(() => controller.queue.playNow({ contentId: 'plex:new', title: 'New', duration: null, format: null }));
    act(() => oldProgress({
      currentTime: 91,
      duration: 999,
      paused: false,
      media: { contentId: 'plex:old', format: 'video' },
    }));

    expect(controller.getSnapshot().currentItem).toEqual(expect.objectContaining({
      contentId: 'plex:new', duration: null, format: null,
    }));
    expect(controller.position.get().seconds).toBe(0);
  });

  it('exposes and observes the Player media accessor used for a DASH shadow-root video', async () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:665667', title: 'Disclosure Day', duration: null, format: null });
    mediaElement = document.createElement('video');
    Object.defineProperties(mediaElement, {
      duration: { configurable: true, value: 5400 },
      currentTime: { configurable: true, writable: true, value: 12 },
      paused: { configurable: true, value: true },
    });
    mountedContentId = 'plex:665667';

    render(<Harness controller={controller} />);
    expect(controller.getMediaElement()).toBe(mediaElement);

    act(() => mediaElement.dispatchEvent(new Event('loadedmetadata')));
    expect(controller.getSnapshot().currentItem.duration).toBe(5400);
    act(() => mediaElement.dispatchEvent(new Event('pause')));
    expect(controller.getSnapshot().state).toBe('paused');

    Object.defineProperty(mediaElement, 'paused', { configurable: true, value: false });
    act(() => mediaElement.dispatchEvent(new Event('playing')));
    expect(controller.getSnapshot().state).toBe('playing');
  });

  it('reconciles an actual paused seek completion without waiting for another progress tick', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:movie-a', duration: 5400, format: 'video' });
    mediaElement = document.createElement('video');
    Object.defineProperties(mediaElement, {
      duration: { configurable: true, value: 5400 },
      currentTime: { configurable: true, writable: true, value: 257 },
      paused: { configurable: true, value: true },
    });
    mountedContentId = 'plex:movie-a';
    render(<Harness controller={controller} />);
    act(() => latestPlayerProps.onProgress({ currentTime: 257, paused: true, isSeeking: false }));

    act(() => controller.transport.seekAbs(342));
    expect(controller.position.get().seconds).toBe(257);

    // Decoder settles slightly before the requested target. Publish the
    // actual native position, never the requested value.
    mediaElement.currentTime = 341.75;
    act(() => mediaElement.dispatchEvent(new Event('seeked')));
    expect(controller.position.get().seconds).toBe(341.75);
    expect(controller.getSnapshot().state).toBe('paused');
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('shows native pending seek position without claiming completion or persisting it', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:movie-a', duration: 5400, format: 'video' });
    mediaElement = document.createElement('video');
    Object.defineProperties(mediaElement, {
      currentTime: { configurable: true, writable: true, value: 257 },
      paused: { configurable: true, value: true },
      seeking: { configurable: true, value: true },
    });
    mountedContentId = 'plex:movie-a';
    render(<Harness controller={controller} />);
    act(() => latestPlayerProps.onProgress({ currentTime: 257, paused: true, isSeeking: false }));

    act(() => controller.transport.seekAbs(342));
    expect(controller.position.get().seconds).toBe(257);
    // The native decoder accepts its own position before it can decode a
    // frame. Display that evidence, not an optimistic requested target.
    mediaElement.currentTime = 341.75;
    act(() => mediaElement.dispatchEvent(new Event('seeking')));
    expect(controller.position.get().seconds).toBe(341.75);
    expect(controller.getSnapshot().position).toBe(257);
    expect(controller.getSnapshot().state).toBe('paused');
  });

  it('rejects seek completion from the previous source while its replacement is pending', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:movie-a', duration: 5400, format: 'video' });
    const oldVideo = document.createElement('video');
    oldVideo.currentTime = 800;
    Object.defineProperty(oldVideo, 'duration', { configurable: true, value: 5400 });
    mediaElement = oldVideo;
    mountedContentId = 'plex:movie-a';
    render(<Harness controller={controller} />);

    act(() => controller.queue.playNow({ contentId: 'plex:movie-b', duration: 3600, format: 'video' }));
    // The new generation's effect can see A until B resolves. Requested
    // content identity alone must not attribute A's seek completion to B.
    act(() => {
      oldVideo.dispatchEvent(new Event('seeking'));
      oldVideo.dispatchEvent(new Event('seeked'));
      oldVideo.dispatchEvent(new Event('durationchange'));
      oldVideo.dispatchEvent(new Event('playing'));
    });
    expect(controller.position.get().seconds).toBe(0);
    expect(controller.getSnapshot().currentItem.duration).toBe(3600);
    expect(controller.getSnapshot().state).toBe('loading');

    // B now owns the accessor, but the native-listener poll has not rebound
    // yet. A late event on A must not read as evidence for B either.
    mediaElement = document.createElement('video');
    mountedContentId = 'plex:movie-b';
    act(() => {
      oldVideo.dispatchEvent(new Event('seeking'));
      oldVideo.dispatchEvent(new Event('seeked'));
      oldVideo.dispatchEvent(new Event('pause'));
    });
    expect(controller.position.get().seconds).toBe(0);
    expect(controller.getSnapshot().state).toBe('loading');
  });

  it('does not claim playing when an unpaused buffering video completes a seek', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:movie-a', duration: 5400, format: 'video' });
    mediaElement = document.createElement('video');
    Object.defineProperties(mediaElement, {
      currentTime: { configurable: true, writable: true, value: 257 },
      paused: { configurable: true, value: false },
    });
    mountedContentId = 'plex:movie-a';
    render(<Harness controller={controller} />);
    act(() => mediaElement.dispatchEvent(new Event('waiting')));
    expect(controller.getSnapshot().state).toBe('buffering');

    mediaElement.currentTime = 341.75;
    act(() => mediaElement.dispatchEvent(new Event('seeked')));
    expect(controller.position.get().seconds).toBe(341.75);
    expect(controller.getSnapshot().state).toBe('buffering');
    act(() => mediaElement.dispatchEvent(new Event('playing')));
    expect(controller.getSnapshot().state).toBe('playing');
  });
});
