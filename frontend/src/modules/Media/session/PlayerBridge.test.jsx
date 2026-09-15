// frontend/src/modules/Media/session/PlayerBridge.test.jsx
// Guards the PlayerBridge header contract: "The tree shape is identical
// whether hidden or portal-hosted, so navigating to/from Now Playing never
// remounts the Player (audio continues across all views)."
import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { usePlayerHost } from './usePlayerHost.js';
import { createLocalSessionController } from './LocalSessionController.js';
import { applyCommandEnvelope } from '../externalControl/commandHandler.js';

// Count how many times the platform Player is actually mounted. A remount is
// what destroys the media element mid-play() and produces the browser's
// "The play() request was interrupted because the media was removed from the
// document" AbortError.
const mountSpy = vi.fn();
let latestPlayerProps = null;
let mediaElement = null;
let mountedContentId = null;
let mountedMediaGeneration = 0;
let appliedShader = null;
vi.mock('../../Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(props, ref) {
    latestPlayerProps = props;
    React.useImperativeHandle(ref, () => ({
      play: () => mediaElement?.play?.(),
      pause: () => mediaElement?.pause?.(),
      seek: (seconds) => { if (mediaElement) mediaElement.currentTime = seconds; },
      setPlaybackRate: (rate) => { if (mediaElement) mediaElement.playbackRate = rate; },
      setShader: (shader) => { appliedShader = shader; },
      getMediaElement: () => mediaElement,
      getMountedContentId: () => mountedContentId,
      getMountedMediaGeneration: () => mountedMediaGeneration,
    }));
    React.useEffect(() => { mountSpy(); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

// Imported after the mock so PlayerBridge picks up the mocked Player.
const { PlayerBridge } = await import('./PlayerBridge.jsx');

afterEach(() => vi.useRealTimers());

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
    mountedMediaGeneration = 0;
    appliedShader = null;
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
    mountedMediaGeneration = 0;
    appliedShader = null;
  });

  it('holds receiver Add without a Player, then explicit Play loads and mounts exactly once', () => {
    const controller = makeRealController();
    const loadActions = [];
    controller.store.onTransition((_prev, _next, action) => {
      if (action?.type === 'LOAD_ITEM') loadActions.push(action.item.contentId);
    });
    render(<Harness controller={controller} />);

    act(() => {
      expect(applyCommandEnvelope(controller, {
        commandId: 'receiver-add-1',
        command: 'queue',
        params: { op: 'add', contentId: 'plex:held' },
        ts: '2026-09-14T00:00:00.000Z',
      })).toEqual({ ok: true });
    });

    expect(controller.getSnapshot()).toMatchObject({
      state: 'ready', currentItem: null,
      queue: { currentIndex: -1 },
    });
    expect(controller.getSnapshot().queue.items.map((item) => item.contentId)).toEqual(['plex:held']);
    expect(loadActions).toEqual([]);
    expect(latestPlayerProps).toBeNull();
    expect(mountSpy).not.toHaveBeenCalled();

    act(() => {
      expect(applyCommandEnvelope(controller, {
        commandId: 'receiver-play-1',
        command: 'transport',
        params: { action: 'play' },
        ts: '2026-09-14T00:00:01.000Z',
      })).toEqual({ ok: true });
    });

    expect(controller.getSnapshot().currentItem?.contentId).toBe('plex:held');
    expect(controller.getSnapshot().state).toBe('loading');
    expect(loadActions).toEqual(['plex:held']);
    expect(latestPlayerProps.play.contentId).toBe('plex:held');
    expect(mountSpy).toHaveBeenCalledTimes(1);
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

  it('observes the actual Media store generation and ignores pending/retired native nodes', () => {
    vi.useFakeTimers();
    const adoptionSource = createLocalSessionController({
      clientId: 'adoption-source', ownerInstanceId: 'adoption-source-owner',
    });
    adoptionSource.queue.playNow({ contentId: 'plex:a', title: 'A', duration: 180, format: 'video' });
    const controller = makeRealController();
    expect(controller.portability.adopt(adoptionSource.portability.capture().snapshot, { autoplay: false }))
      .toEqual({ ok: true });
    const nodeA = document.createElement('video');
    const nodeB = document.createElement('video');
    for (const [node, time] of [[nodeA, 10], [nodeB, 20]]) {
      Object.defineProperties(node, {
        currentTime: { configurable: true, writable: true, value: time },
        duration: { configurable: true, value: 180 },
        readyState: { configurable: true, value: 3 },
        paused: { configurable: true, value: false },
        seeking: { configurable: true, value: false },
        ended: { configurable: true, value: false },
        error: { configurable: true, value: null },
      });
    }
    mediaElement = nodeA;
    mountedContentId = 'plex:a';
    const view = render(<Harness controller={controller} />);
    const observations = [];
    const unsubscribe = controller.portability.subscribeNative((observation) => observations.push(observation));
    expect(controller.portability.getNativeObservation()).toMatchObject({
      node: nodeA, resolvedContentId: 'plex:a', resolvedGeneration: 0,
      identity: { contentId: 'plex:a', queueItemId: controller.getSnapshot().queue.items[0].queueItemId },
    });
    const stableIdentity = controller.portability.capture().identity;
    const stableNodeGeneration = controller.portability.getNativeObservation().nodeGeneration;
    act(() => {
      controller.onPlayerPositionTick(11, 'plex:a');
      controller.onPlayerObservation('plex:a', { duration: 181 });
      view.getByTestId('toggle').click();
    });
    expect(controller.portability.capture().identity).toEqual(stableIdentity);
    expect(controller.portability.getNativeObservation().nodeGeneration).toBe(stableNodeGeneration);
    expect(mountSpy).toHaveBeenCalledTimes(1);

    const sameContent = controller.portability.capture().snapshot;
    sameContent.position = 40;
    act(() => controller.portability.adopt(sameContent, { autoplay: false }));
    expect(controller.portability.getNativeObservation().identity).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(controller.portability.getNativeObservation().identity).toBeNull();
    mountedMediaGeneration += 1;
    act(() => vi.advanceTimersByTime(200));
    expect(controller.portability.getNativeObservation().identity).toMatchObject({ contentId: 'plex:a' });

    act(() => controller.queue.playNow({ contentId: 'plex:b', title: 'B', duration: 180, format: 'video' }));
    expect(controller.portability.getNativeObservation()).toMatchObject({
      node: nodeA, resolvedContentId: 'plex:a', identity: null,
    });
    expect(controller.portability.capture().snapshot.position).toBe(0);

    mediaElement = nodeB;
    mountedContentId = 'plex:b';
    act(() => vi.advanceTimersByTime(200));
    const resolved = controller.portability.getNativeObservation();
    expect(resolved).toMatchObject({
      node: nodeB, resolvedContentId: 'plex:b', currentTime: 20, duration: 180,
      readyState: 3, paused: false, seeking: false, ended: false,
      playingObserved: false, advancedObserved: false,
      identity: { contentId: 'plex:b', queueItemId: controller.getSnapshot().queue.items[0].queueItemId },
    });
    act(() => nodeB.dispatchEvent(new Event('playing')));
    nodeB.currentTime = 21;
    act(() => nodeB.dispatchEvent(new Event('timeupdate')));
    expect(controller.portability.getNativeObservation()).toMatchObject({
      currentTime: 21, playingObserved: true, advancedObserved: true,
    });

    const count = observations.length;
    act(() => {
      nodeA.dispatchEvent(new Event('playing'));
      nodeA.dispatchEvent(new Event('timeupdate'));
    });
    expect(observations).toHaveLength(count);
    view.unmount();
    act(() => nodeB.dispatchEvent(new Event('pause')));
    expect(observations).toHaveLength(count);
    unsubscribe();
  });

  it('applies adopted playback rate and shader to the stable mounted Media Player', () => {
    const controller = makeRealController();
    controller.queue.playNow({ contentId: 'plex:a', title: 'A', duration: 180, format: 'video' });
    mediaElement = document.createElement('video');
    Object.defineProperties(mediaElement, {
      currentTime: { configurable: true, writable: true, value: 9 },
      playbackRate: { configurable: true, writable: true, value: 1 },
    });
    mountedContentId = 'plex:a';
    const view = render(<Harness controller={controller} />);
    const adopted = controller.portability.capture().snapshot;
    adopted.config = { ...adopted.config, playbackRate: 1.25, shader: 'night' };

    act(() => controller.portability.adopt(adopted, { autoplay: false }));
    expect(mediaElement.playbackRate).toBe(1.25);
    expect(appliedShader).toBe('night');
    expect(mountSpy).toHaveBeenCalledTimes(1);

    act(() => {
      controller.onPlayerObservation('plex:a', { duration: 181 });
      view.getByTestId('toggle').click();
    });
    expect(mediaElement.playbackRate).toBe(1.25);
    expect(appliedShader).toBe('night');
    expect(mountSpy).toHaveBeenCalledTimes(1);
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
