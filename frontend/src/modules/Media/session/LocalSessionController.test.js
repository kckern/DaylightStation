// Behavioral parity suite for the local controller — assertions carried over
// from the previous generation's LocalSessionAdapter tests, adapted to the
// store/controller decomposition.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeController(overrides = {}) {
  return createLocalSessionController({
    clientId: 'c1',
    randomUuid: () => 's-test-1',
    nowFn: () => new Date('2026-06-10T00:00:00Z'),
    ...overrides,
  });
}

describe('LocalSessionController — bootstrap', () => {
  it('starts with an idle snapshot when no persisted state exists', () => {
    const c = makeController();
    expect(c.getSnapshot().state).toBe('idle');
    expect(c.getSnapshot().sessionId).toBe('s-test-1');
    expect(c.getSnapshot().meta.ownerId).toBe('c1');
  });

  it('hydrates from a persisted snapshot', () => {
    const persistedSnapshot = {
      sessionId: 'old', state: 'paused', currentItem: null, position: 42,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-09-14T00:00:00.000Z' },
    };
    const c = makeController({ persistedSnapshot });
    expect(c.getSnapshot().sessionId).toBe('old');
    expect(c.getSnapshot().position).toBe(42);
    expect(c.position.get().seconds).toBe(42); // hot tier seeded from durable
  });

  it('notifies subscribers on change; unsubscribe works', () => {
    const c = makeController();
    const sub = vi.fn();
    const unsub = c.subscribe(sub);
    c.config.setVolume(77);
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0][0].config.volume).toBe(77);
    unsub();
    c.config.setVolume(44);
    expect(sub).toHaveBeenCalledTimes(1);
  });
});

describe('LocalSessionController — transport', () => {
  it('play/pause/seek issue commands without claiming an unobserved state or position', () => {
    const c = makeController();
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    c.setPlayerHandle(handle);
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    c.transport.pause();
    expect(c.getSnapshot().state).toBe('playing');
    expect(handle.pause).toHaveBeenCalled();
    c.transport.play();
    expect(handle.play).toHaveBeenCalled();
    c.transport.seekAbs(30);
    expect(handle.seek).toHaveBeenCalledWith(30);
    expect(c.position.get().seconds).toBe(0);
  });

  // 2026-08-12: play() claimed 'playing' the instant it was called, so the app
  // reported playback (and emitted playback.started) 51s before a frame
  // rendered while the server sat on a transcode decision.
  it('a cold start reports loading, not playing, until the player really starts', () => {
    const c = makeController();
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    c.setPlayerHandle(handle);
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.transport.play();
    expect(handle.play).toHaveBeenCalled();
    expect(c.getSnapshot().state).toBe('loading');

    // PlayerBridge promotes on the first real progress tick.
    c.onPlayerStateChange('playing');
    expect(c.getSnapshot().state).toBe('playing');
  });

  it('does not treat an unpaused observation without native playing evidence as confirmed playback', () => {
    const c = createLocalSessionController({ clientId: 'state-client' });
    c.queue.add({ contentId: 'plex:movie', format: 'video' });
    c.transport.play();

    c.onPlayerObservation('plex:movie', { paused: false });

    expect(c.getSnapshot().state).toBe('loading');
    c.onPlayerStateChange('playing', 'plex:movie');
    expect(c.getSnapshot().state).toBe('playing');
  });

  it('repeated Play while already playing does not re-enter loading or arm startup recovery', () => {
    const c = makeController();
    c.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    c.transport.play();
    expect(c.getSnapshot().state).toBe('playing');
  });

  it('resume stays paused until the Player reports actual playback', () => {
    const c = makeController();
    c.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.onPlayerStateChange('paused', 'p:1');
    c.transport.play();
    expect(c.getSnapshot().state).toBe('paused');
    c.onPlayerStateChange('playing', 'p:1');
    expect(c.getSnapshot().state).toBe('playing');
  });

  it('stop resets to idle and clears the current item', () => {
    const c = makeController();
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.transport.stop();
    expect(c.getSnapshot().state).toBe('idle');
    expect(c.getSnapshot().currentItem).toBeNull();
  });

  it('seek position changes only after real Player evidence; seekRel resolves from the hot tier', () => {
    const c = makeController();
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    c.setPlayerHandle(handle);
    c.transport.seekAbs(60);
    expect(handle.seek).toHaveBeenCalledWith(60);
    expect(c.getSnapshot().position).toBe(0);
    expect(c.position.get().seconds).toBe(0);
    c.onPlayerPositionTick(60);
    c.transport.seekRel(-15);
    expect(handle.seek).toHaveBeenLastCalledWith(45);
    expect(c.position.get().seconds).toBe(60);
  });

  it('resolves a relative seek from actual media time when the hot position is stale', () => {
    const c = makeController();
    const media = { currentTime: 40 };
    const handle = {
      play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getMediaElement: () => media,
    };
    c.setPlayerHandle(handle);
    c.onPlayerPositionTick(30);

    c.transport.seekRel(-10);

    expect(handle.seek).toHaveBeenCalledWith(30);
    expect(c.position.get().seconds).toBe(30);
  });
});

describe('LocalSessionController — queue ops', () => {
  it('queue.add exposes a ready queue without selecting or loading until explicit Play', () => {
    const c = makeController();
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    const loadActions = [];
    c.setPlayerHandle(handle);
    c.store.onTransition((_prev, _next, action) => {
      if (action?.type === 'LOAD_ITEM') loadActions.push(action);
    });

    c.queue.add({ contentId: 'a', format: 'video', title: 'A' });

    expect(c.getSnapshot().queue.items).toHaveLength(1);
    expect(c.getSnapshot().queue.currentIndex).toBe(-1);
    expect(c.getSnapshot().currentItem).toBeNull();
    expect(c.getSnapshot().state).toBe('ready');
    expect(loadActions).toHaveLength(0);
    expect(handle.play).not.toHaveBeenCalled();

    c.transport.play();

    expect(c.getSnapshot().queue.currentIndex).toBe(0);
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
    expect(c.getSnapshot().state).toBe('loading');
    expect(loadActions).toHaveLength(1);
    expect(handle.play).toHaveBeenCalledTimes(1);
  });

  it.each(['playing', 'paused'])('queue.add preserves a %s source, position, and state', (state) => {
    const c = makeController();
    c.queue.playNow({ contentId: 'active', format: 'video', title: 'Active' }, { clearRest: true });
    c.onPlayerProgress(31, 'active');
    c.onPlayerStateChange(state, 'active');
    const before = c.getSnapshot();

    c.queue.add({ contentId: 'later', format: 'video', title: 'Later' });

    const after = c.getSnapshot();
    expect(after.queue.items.map((item) => item.contentId)).toEqual(['active', 'later']);
    expect(after.queue.currentIndex).toBe(0);
    expect(after.currentItem).toEqual(before.currentItem);
    expect(after.position).toBe(31);
    expect(c.position.get().seconds).toBe(31);
    expect(after.state).toBe(state);
  });

  it('queue.add appends once to a stopped ready queue without selecting it', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'retained', format: 'video' }, { clearRest: true });
    c.transport.stop();

    c.queue.add({ contentId: 'later', format: 'video' });

    expect(c.getSnapshot()).toMatchObject({
      state: 'ready', currentItem: null,
      queue: { currentIndex: -1 },
    });
    expect(c.getSnapshot().queue.items.map((item) => item.contentId)).toEqual(['retained', 'later']);
  });

  it('queue.playNow replaces-and-loads', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'a', format: 'video' }, { clearRest: true });
    expect(c.getSnapshot().state).toBe('loading');
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('artist/album/containerTitle survive LOAD_ITEM onto the live currentItem', () => {
    // Regression guard for the third field whitelist (itemFromQueueEntry):
    // display context put on the queue entry must reach the store's
    // currentItem, not be stripped one dispatch after load. Round-2 bug had
    // this data die here even after queueOps was fixed.
    const c = makeController();
    c.queue.playNow(
      { contentId: 'plex:1', format: 'audio', title: 'Hey Jude', artist: 'The Beatles', album: 'Past Masters' },
      { clearRest: true },
    );
    const ci = c.getSnapshot().currentItem;
    expect(ci?.artist).toBe('The Beatles');
    expect(ci?.album).toBe('Past Masters');
  });

  it('a non-music item gains no artist/album keys on currentItem', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'plex:9', format: 'video', title: 'A Show' }, { clearRest: true });
    const ci = c.getSnapshot().currentItem;
    expect('artist' in ci).toBe(false);
    expect('album' in ci).toBe(false);
  });

  it('queue.clear empties the queue', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.queue.clear();
    expect(c.getSnapshot().queue.items).toEqual([]);
  });

  it('jump resets the hot position', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.onPlayerPositionTick(33);
    const second = c.getSnapshot().queue.items[1].queueItemId;
    c.queue.jump(second);
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
    expect(c.position.get().seconds).toBe(0);
  });
});

describe('LocalSessionController — config + lifecycle', () => {
  it('exposes finite positive local playback-rate configuration and rejects invalid values', () => {
    const c = makeController();
    expect(c.config.setPlaybackRate).toBeTypeOf('function');
    c.config.setPlaybackRate(1.25);
    expect(c.getSnapshot().config.playbackRate).toBe(1.25);
    for (const invalid of [0, -1, NaN, Infinity, '1.5']) c.config.setPlaybackRate(invalid);
    expect(c.getSnapshot().config.playbackRate).toBe(1.25);
    c.config.setPlaybackRate(0.75);
    expect(c.getSnapshot().config.playbackRate).toBe(0.75);
  });

  it('config.setVolume clamps to 0..100', () => {
    const c = makeController();
    c.config.setVolume(-5);
    expect(c.getSnapshot().config.volume).toBe(0);
    c.config.setVolume(150);
    expect(c.getSnapshot().config.volume).toBe(100);
  });

  it('config.setRepeat rejects invalid modes', () => {
    const c = makeController();
    c.config.setRepeat('bogus');
    expect(mediaLog.configChanged).not.toHaveBeenCalled();
    expect(c.getSnapshot().config.repeat).toBe('off');
  });

  it('lifecycle.reset clears persistence and returns to idle with a new session id', () => {
    const clearPersisted = vi.fn();
    let uuidCount = 0;
    const c = makeController({ clearPersisted, randomUuid: () => `s-${++uuidCount}` });
    c.queue.add({ contentId: 'a', format: 'video' });
    c.lifecycle.reset();
    expect(c.getSnapshot().state).toBe('idle');
    expect(c.getSnapshot().queue.items).toEqual([]);
    expect(c.getSnapshot().sessionId).toBe('s-2');
    expect(clearPersisted).toHaveBeenCalled();
  });

  it('lifecycle.adoptSnapshot replaces state and seeds position', () => {
    const c = makeController();
    const adopted = {
      sessionId: 'adopted', state: 'paused', currentItem: { contentId: 'z', format: 'audio' },
      position: 9,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 30, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-09-14T00:00:00.000Z' },
    };
    c.lifecycle.adoptSnapshot(adopted, { autoplay: false });
    expect(c.getSnapshot().sessionId).toBe('adopted');
    expect(c.getSnapshot().currentItem?.contentId).toBe('z');
    expect(c.position.get().seconds).toBe(9);
  });
});

describe('LocalSessionController — player events', () => {
  it('reconciles observed metadata into current item and its queue entry without changing identity', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'plex:1', title: 'Disclosure Day', duration: null, format: null });
    const originalQueueItemId = c.getSnapshot().queue.items[0].queueItemId;

    c.onPlayerObservation('plex:1', {
      duration: 5400,
      media: { contentId: 'plex:1', format: 'video', mediaType: 'dash_video', isLive: false },
    });

    expect(c.getSnapshot().currentItem).toEqual(expect.objectContaining({
      contentId: 'plex:1', duration: 5400, format: 'video', mediaType: 'dash_video', isLive: false,
    }));
    expect(c.getSnapshot().queue.items[0]).toEqual(expect.objectContaining({
      queueItemId: originalQueueItemId, contentId: 'plex:1', duration: 5400, format: 'video', mediaType: 'dash_video',
    }));
  });

  it.each([0, Number.POSITIVE_INFINITY])(
    'clears a known duration when Player explicitly reports %s as unknown or unbounded',
    (unknownDuration) => {
      const c = makeController();
      c.queue.playNow({ contentId: 'plex:1', format: 'video', duration: null });
      c.onPlayerObservation('plex:1', { duration: 120, paused: false });
      expect(c.capabilities.seekable).toBe(true);

      c.onPlayerObservation('plex:1', {
        duration: unknownDuration,
        media: { duration: 120 },
        paused: false,
      });

      expect(c.getSnapshot().currentItem.duration).toBeNull();
      expect(c.getSnapshot().queue.items[0].duration).toBeNull();
      expect(c.capabilities.seekable).toBe(false);
    }
  );

  it('keeps stalled progress in buffering until Player confirms recovery', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'plex:1', format: 'video', duration: 120 });
    c.onPlayerStateChange('playing', 'plex:1');

    c.onPlayerObservation('plex:1', { currentTime: 15, paused: false, stalled: true });
    expect(c.getSnapshot().state).toBe('buffering');

    c.onPlayerObservation('plex:1', { currentTime: 15.5, paused: false, stalled: false });
    expect(c.getSnapshot().state).toBe('buffering');
    c.onPlayerStateChange('playing', 'plex:1');
    expect(c.getSnapshot().state).toBe('playing');
  });

  it.each([
    ['paused', { currentTime: 16, paused: true, stalled: false, playing: false }],
    ['seeking', { currentTime: 16, paused: false, stalled: false, isSeeking: true, playing: false }],
    ['stalled', { currentTime: 16, paused: false, stalled: true, playing: false }],
    ['not advanced', { currentTime: 16, paused: false, stalled: false, playing: false }],
  ])('does not promote buffering on %s progress', (_case, observation) => {
    const c = makeController();
    c.queue.playNow({ contentId: 'plex:1', format: 'video', duration: 120 });
    c.onPlayerStateChange('playing', 'plex:1');
    c.onPlayerObservation('plex:1', { currentTime: 15, paused: false, stalled: true });

    c.onPlayerObservation('plex:1', observation);

    expect(c.getSnapshot().state).not.toBe('playing');
  });

  it('promotes buffering only on healthy advancing progress marked playing by Player', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'plex:1', format: 'video', duration: 120 });
    c.onPlayerStateChange('playing', 'plex:1');
    c.onPlayerObservation('plex:1', { currentTime: 15, paused: false, stalled: true });

    c.onPlayerObservation('plex:1', {
      currentTime: 16, paused: false, isSeeking: false, stalled: false, playing: true,
    });

    expect(c.getSnapshot().state).toBe('playing');
  });

  it('rejects observations and terminal callbacks from stale content identity', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.queue.jump(c.getSnapshot().queue.items[1].queueItemId);

    c.onPlayerObservation('a', { duration: 900, paused: false });
    c.onPlayerPositionTick(45, 'a');
    c.onPlayerEnded('a');

    expect(c.getSnapshot().currentItem.contentId).toBe('b');
    expect(c.getSnapshot().currentItem.duration).toBeNull();
    expect(c.position.get().seconds).toBe(0);
    expect(c.getSnapshot().state).toBe('loading');
  });

  it('onPlayerEnded auto-advances sequentially', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.transport.play();
    c.onPlayerEnded();
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
    expect(c.getSnapshot().queue.currentIndex).toBe(1);
  });

  it('onPlayerEnded at queue end with repeat=off goes to ended', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.transport.play();
    c.onPlayerEnded();
    expect(c.getSnapshot().state).toBe('ended');
  });

  it('onPlayerError logs and auto-advances', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.transport.play();
    c.onPlayerError({ message: 'boom', code: 'E_X' });
    expect(mediaLog.playbackError).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 'a', error: 'boom', code: 'E_X',
    }));
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
  });

  it('onPlayerStalled logs and advances; no-op without a current item', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'p:1', format: 'video', title: 'A', duration: 60 });
    c.queue.add({ contentId: 'p:2', format: 'video', title: 'B', duration: 60 });
    c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    c.onPlayerStalled({ stalledMs: 10500 });
    expect(mediaLog.playbackStallAutoAdvanced).toHaveBeenCalledWith(expect.objectContaining({
      stalledMs: 10500, contentId: 'p:1',
    }));
    expect(c.getSnapshot().currentItem.contentId).toBe('p:2');

    const idle = makeController();
    mediaLog.playbackStallAutoAdvanced.mockClear();
    idle.onPlayerStalled({ stalledMs: 10500 });
    expect(mediaLog.playbackStallAutoAdvanced).not.toHaveBeenCalled();
  });
});

describe('LocalSessionController — two-tier position', () => {
  it('position ticks feed the hot tier only; snapshot subscribers do not fire', () => {
    const c = makeController();
    const snapSub = vi.fn();
    const posSub = vi.fn();
    c.subscribe(snapSub);
    c.position.subscribe(posSub);
    c.onPlayerPositionTick(12.4);
    expect(posSub).toHaveBeenCalledWith(expect.objectContaining({ seconds: 12.4 }));
    expect(snapSub).not.toHaveBeenCalled();
    expect(c.getSnapshot().position).toBe(0); // durable untouched
  });

  it('onPlayerProgress writes the durable tier and reconciles the hot tier', () => {
    const c = makeController();
    c.onPlayerProgress(25);
    expect(c.getSnapshot().position).toBe(25);
    expect(c.position.get().seconds).toBe(25);
  });
});

describe('LocalSessionController — logging parity', () => {
  it('queue ops emit queueMutated with op/sessionId/queueLength', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'p:1', format: 'video' }, { clearRest: true });
    expect(mediaLog.queueMutated).toHaveBeenCalledWith(expect.objectContaining({
      op: 'playNow', sessionId: 's-test-1', contentId: 'p:1', queueLength: 1,
    }));
  });

  it.each(['play', 'pause', 'stop', 'skipNext', 'skipPrev'])(
    'transport.%s emits transportCommand with target=local',
    (action) => {
      const c = makeController();
      c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
      mediaLog.transportCommand.mockClear();
      c.transport[action]();
      expect(mediaLog.transportCommand).toHaveBeenCalledWith(
        expect.objectContaining({ action, target: 'local' }),
      );
    },
  );

  it('advancement emits playbackAdvanced with reason + nextContentId', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.transport.play();
    c.transport.skipNext();
    expect(mediaLog.playbackAdvanced).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'skip-next', nextContentId: 'b',
    }));
  });

  it('config setters emit configChanged with the patch', () => {
    const c = makeController();
    c.config.setShuffle(true);
    expect(mediaLog.configChanged).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's-test-1', patch: { shuffle: true },
    }));
  });
});

describe('LocalSessionController — capabilities', () => {
  it('does not invent seekability before a finite positive duration is observed', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'vod:1', format: 'video', duration: null });
    expect(c.capabilities.seekable).toBe(false);
    c.onPlayerObservation('vod:1', { duration: 0 });
    expect(c.capabilities.seekable).toBe(false);
    c.onPlayerObservation('vod:1', { duration: Number.POSITIVE_INFINITY });
    expect(c.capabilities.seekable).toBe(false);
    c.onPlayerObservation('vod:1', { duration: 120 });
    expect(c.capabilities.seekable).toBe(true);
  });

  it('seekable is false for live content', () => {
    const c = makeController();
    expect(c.capabilities.seekable).toBe(false);
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'cam:1', format: 'video', isLive: true, duration: 120 } });
    expect(c.capabilities.seekable).toBe(false);
  });
});

describe('LocalSessionController — portability', () => {
  it('adopts the actual detached queue, execution order and config without claiming native start', () => {
    const source = createLocalSessionController({ clientId: 'source', ownerInstanceId: 'source-owner' });
    source.queue.add({ contentId: 'plex:a', title: 'A', format: 'video' });
    source.queue.add({ contentId: 'plex:b', title: 'B', format: 'video' });
    source.queue.add({ contentId: 'plex:a', title: 'A again', format: 'video' });
    const thirdId = source.getSnapshot().queue.items[2].queueItemId;
    source.queue.jump(thirdId);
    source.queue.playNext({ contentId: 'plex:next', title: 'Next', format: 'video' });
    source.config.setVolume(73);
    source.config.setRepeat('all');
    source.config.setShuffle(false);
    source.config.setShader('night');
    source.store.dispatch({ type: 'SET_CONFIG', patch: { playbackRate: 1.25 } });
    source.onPlayerPositionTick(38.5, 'plex:a');
    const detached = source.portability.capture().snapshot;
    detached.queue.executionOrder.push(thirdId);

    const destination = createLocalSessionController({ clientId: 'destination', ownerInstanceId: 'destination-owner' });
    const native = { play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getMediaElement: () => null };
    destination.setPlayerHandle(native);
    const before = destination.portability.capture().identity;
    const result = destination.portability.adopt(detached, { autoplay: false, transferId: 'transfer-1' });
    const adopted = destination.portability.capture();

    expect(result).toEqual({ ok: true });
    expect(adopted.snapshot.queue).toEqual(detached.queue);
    expect(adopted.snapshot.config).toEqual(detached.config);
    expect(adopted.snapshot.position).toBe(38.5);
    expect(adopted.snapshot.meta.ownerId).toBe('destination');
    expect(adopted.identity.ownerInstanceId).toBe('destination-owner');
    expect(adopted.identity.playbackRevision).toBeGreaterThan(before.playbackRevision);
    expect(adopted.identity.queueRevision).toBeGreaterThan(before.queueRevision);
    expect(native.play).not.toHaveBeenCalled();
    expect(adopted.snapshot.state).not.toBe('playing');

    const beforeRepeat = adopted.identity;
    expect(destination.portability.adopt(detached, { autoplay: false, transferId: 'transfer-2' })).toEqual({ ok: true });
    const repeated = destination.portability.capture().identity;
    expect(repeated.playbackRevision).toBeGreaterThan(beforeRepeat.playbackRevision);
    expect(repeated.queueRevision).toBeGreaterThan(beforeRepeat.queueRevision);
  });

  it('revokes same-content and duplicate-entry native proof synchronously on adoption', () => {
    const c = createLocalSessionController({ clientId: 'native-revoke', ownerInstanceId: 'native-revoke-owner' });
    c.queue.add({ contentId: 'plex:a', title: 'A first', duration: 180, format: 'video' });
    c.queue.add({ contentId: 'plex:a', title: 'A duplicate', duration: 180, format: 'video' });
    c.transport.play();
    const firstId = c.getSnapshot().queue.items[0].queueItemId;
    const secondId = c.getSnapshot().queue.items[1].queueItemId;
    const node = { currentTime: 10, duration: 180, readyState: 3, paused: false, seeking: false, ended: false, error: null };
    let nativeGeneration = 1;
    c.setPlayerHandle({
      getMediaElement: () => node,
      getMountedContentId: () => 'plex:a',
      getMountedMediaGeneration: () => nativeGeneration,
    });
    c.bindNativeObservation(node, 'plex:a', 1);
    c.onNativeObservationEvent(node, 'playing');
    node.currentTime = 11;
    c.onNativeObservationEvent(node, 'timeupdate');
    expect(c.portability.getNativeObservation()).toMatchObject({
      identity: { queueItemId: firstId }, playingObserved: true, advancedObserved: true,
    });

    const sameEntry = c.portability.capture().snapshot;
    sameEntry.position = 40;
    expect(c.portability.adopt(sameEntry, { autoplay: true })).toEqual({ ok: true });
    expect(c.portability.getNativeObservation()).toMatchObject({
      identity: null, playingObserved: false, advancedObserved: false,
    });
    expect(c.portability.capture().snapshot.position).toBe(40);

    // A bridge render generation is not actual renderer provenance. Rebinding
    // the unchanged node/content/native generation must not admit the retired
    // decoder under the newly adopted owner revision.
    c.bindNativeObservation(node, 'plex:a', 1);
    c.onNativeObservationEvent(node, 'playing');
    expect(c.portability.getNativeObservation().identity).toBeNull();
    nativeGeneration = 2;
    c.bindNativeObservation(node, 'plex:a', nativeGeneration);
    expect(c.portability.getNativeObservation().identity).toMatchObject({ queueItemId: firstId });

    const duplicate = structuredClone(sameEntry);
    duplicate.queue.currentIndex = 1;
    duplicate.currentItem = { contentId: 'plex:a', title: 'A duplicate', duration: 180, format: 'video' };
    duplicate.queue.executionOrder = [secondId, firstId];
    duplicate.meta.playbackOwner = {
      ...duplicate.meta.playbackOwner, contentId: 'plex:a', queueItemId: secondId,
    };
    expect(c.portability.adopt(duplicate, { autoplay: true })).toEqual({ ok: true });
    expect(c.portability.getNativeObservation().identity).toBeNull();

    const b = structuredClone(duplicate);
    b.queue.items[1] = { ...b.queue.items[1], contentId: 'plex:b' };
    b.currentItem = { ...b.currentItem, contentId: 'plex:b' };
    b.meta.playbackOwner = { ...b.meta.playbackOwner, contentId: 'plex:b' };
    expect(c.portability.adopt(b, { autoplay: true })).toEqual({ ok: true });
    expect(c.portability.adopt(duplicate, { autoplay: true })).toEqual({ ok: true });
    expect(c.portability.getNativeObservation().identity).toBeNull();
  });

  it('executes an adopted remaining visit order, including repeated entry references', () => {
    const source = createLocalSessionController({ clientId: 'plan-source', ownerInstanceId: 'plan-source-owner' });
    source.queue.add({ contentId: 'plex:a', format: 'video' });
    source.queue.add({ contentId: 'plex:b', format: 'video' });
    source.queue.add({ contentId: 'plex:c', format: 'video' });
    source.transport.play();
    const adopted = source.portability.capture().snapshot;
    const [a, b, c] = adopted.queue.items.map((item) => item.queueItemId);
    adopted.queue.executionOrder = [a, c, a, b];

    const destination = createLocalSessionController({ clientId: 'plan-destination', ownerInstanceId: 'plan-destination-owner' });
    expect(destination.portability.adopt(adopted, { autoplay: false })).toEqual({ ok: true });
    destination.transport.skipNext();
    expect(destination.portability.capture().snapshot.queue).toMatchObject({ currentIndex: 2, executionOrder: [c, a, b] });
    destination.onPlayerEnded('plex:c');
    expect(destination.portability.capture().snapshot.queue).toMatchObject({ currentIndex: 0, executionOrder: [a, b] });
    destination.onPlayerEnded('plex:a');
    expect(destination.portability.capture().snapshot.queue).toMatchObject({ currentIndex: 1, executionOrder: [b] });
    destination.onPlayerEnded('plex:b');
    expect(destination.getSnapshot().state).toBe('ended');
  });

  it('preserves an adopted remaining plan when removing its current entry', () => {
    const source = createLocalSessionController({ clientId: 'remove-plan-source' });
    for (const contentId of ['plex:a', 'plex:b', 'plex:c', 'plex:d']) {
      source.queue.add({ contentId, format: 'video' });
    }
    source.transport.play();
    const adopted = source.portability.capture().snapshot;
    const [a, b, c, d] = adopted.queue.items.map((item) => item.queueItemId);
    adopted.queue.executionOrder = [a, c, b, d];

    const destination = createLocalSessionController({ clientId: 'remove-plan-destination' });
    expect(destination.portability.adopt(adopted, { autoplay: false })).toEqual({ ok: true });
    destination.queue.remove(a);
    expect(destination.portability.capture().snapshot.queue).toMatchObject({
      currentIndex: 1,
      executionOrder: [c, b, d],
    });
    destination.transport.skipNext();
    expect(destination.portability.capture().snapshot.queue.executionOrder).toEqual([b, d]);
  });

  it('preserves an adopted remaining plan across repeat-one natural completion', () => {
    const source = createLocalSessionController({ clientId: 'repeat-plan-source' });
    for (const contentId of ['plex:a', 'plex:b', 'plex:c', 'plex:d']) {
      source.queue.add({ contentId, format: 'video' });
    }
    source.transport.play();
    const adopted = source.portability.capture().snapshot;
    const [a, b, c, d] = adopted.queue.items.map((item) => item.queueItemId);
    adopted.queue.executionOrder = [a, c, b, d];
    adopted.config.repeat = 'one';

    const destination = createLocalSessionController({ clientId: 'repeat-plan-destination' });
    expect(destination.portability.adopt(adopted, { autoplay: false })).toEqual({ ok: true });
    destination.onPlayerEnded('plex:a');
    expect(destination.portability.capture().snapshot.queue.executionOrder).toEqual([a, c, b, d]);
    destination.transport.skipNext();
    expect(destination.portability.capture().snapshot.queue.executionOrder).toEqual([c, b, d]);
  });

  it('rejects malformed new adoption fields before mutation and normalizes legacy scalar bounds', () => {
    const c = createLocalSessionController({ clientId: 'adopt-validation', ownerInstanceId: 'adopt-validation-owner' });
    c.queue.add({ contentId: 'plex:kept', format: 'video' });
    c.transport.play();
    const before = c.portability.capture().snapshot;
    const malformed = structuredClone(before);
    malformed.queue.executionOrder = ['missing-entry'];

    expect(c.portability.adopt(malformed, { autoplay: false, transferId: 'bad' }))
      .toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    expect(c.portability.capture().snapshot.queue.items.map((item) => item.contentId)).toEqual(['plex:kept']);

    const wrongCurrent = structuredClone(before);
    wrongCurrent.currentItem = { contentId: 'plex:wrong', format: 'video' };
    expect(c.portability.adopt(wrongCurrent, { autoplay: false })).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    const missingCurrent = structuredClone(before);
    missingCurrent.currentItem = null;
    expect(c.portability.adopt(missingCurrent, { autoplay: false })).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    const missingSession = structuredClone(before);
    delete missingSession.meta.playbackOwner;
    delete missingSession.sessionId;
    expect(c.portability.adopt(missingSession, { autoplay: false })).toMatchObject({ ok: false, code: 'INVALID_SNAPSHOT' });
    expect(c.portability.capture().snapshot.queue.items.map((item) => item.contentId)).toEqual(['plex:kept']);

    const legacy = structuredClone(before);
    delete legacy.meta.playbackOwner;
    delete legacy.queue.executionOrder;
    legacy.position = -50;
    legacy.config = { shuffle: false, repeat: 'off', shader: null, volume: 150, playbackRate: -1 };
    expect(c.portability.adopt(legacy, { autoplay: false, transferId: 'legacy' })).toEqual({ ok: true });
    expect(c.portability.capture().snapshot).toMatchObject({
      position: 0,
      config: { shuffle: false, repeat: 'off', shader: null, volume: 100, playbackRate: 1 },
      queue: { items: [expect.objectContaining({ contentId: 'plex:kept' })] },
    });
  });

  it('conditionally Stops only the exact current owner identity and retains its queue', () => {
    const c = createLocalSessionController({ clientId: 'guard-client', ownerInstanceId: 'guard-owner' });
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getMediaElement: () => null };
    c.setPlayerHandle(handle);
    c.queue.add({ contentId: 'plex:a', title: 'Same title', format: 'video' });
    c.queue.add({ contentId: 'plex:b', title: 'B', format: 'video' });
    const secondId = c.getSnapshot().queue.items[1].queueItemId;
    c.transport.play();
    const original = c.portability.capture().identity;

    c.queue.playNow({ contentId: 'plex:a', title: 'Same title', format: 'video' });
    expect(c.portability.stopIfCurrent(original)).toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    const restartedId = c.getSnapshot().queue.items[0].queueItemId;
    c.queue.jump(secondId);
    c.queue.jump(restartedId);
    expect(c.portability.stopIfCurrent(original)).toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    c.queue.reorder({ items: [secondId, restartedId] });
    c.config.setVolume(64);
    expect(c.portability.stopIfCurrent(original)).toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    expect(handle.pause).not.toHaveBeenCalled();

    const fresh = c.portability.capture().identity;
    const retainedIds = c.getSnapshot().queue.items.map((item) => item.queueItemId);
    expect(c.portability.stopIfCurrent(fresh)).toEqual({ ok: true });
    expect(handle.pause).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toMatchObject({ state: 'ready', currentItem: null, queue: { currentIndex: -1 } });
    expect(c.getSnapshot().queue.items.map((item) => item.queueItemId)).toEqual(retainedIds);
  });

  it('snapshotForHandoff carries the hot-tier position', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'a', format: 'video' });
    c.onPlayerProgress(10); // durable at 10
    c.onPlayerPositionTick(14.2); // hot tier ahead
    const snap = c.portability.snapshotForHandoff();
    expect(snap.position).toBe(14.2);
  });

  it('captures its authoritative duplicate queue, hot position, and detached owner identity', () => {
    const c = createLocalSessionController({ clientId: 'capture-client', ownerInstanceId: 'local-owner-1' });
    c.queue.add({ contentId: 'plex:a', title: 'A', format: 'video' });
    c.queue.add({ contentId: 'plex:b', title: 'B', format: 'video' });
    c.queue.add({ contentId: 'plex:a', title: 'A again', format: 'video' });
    const thirdId = c.getSnapshot().queue.items[2].queueItemId;
    c.queue.jump(thirdId);
    c.queue.playNext({ contentId: 'plex:next', title: 'Next', format: 'video' });
    c.onPlayerPositionTick(37.25, 'plex:a');

    const capture = c.portability.capture();

    expect(capture.snapshot.queue.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:a', 'plex:next']);
    expect(new Set(capture.snapshot.queue.items.map((item) => item.queueItemId)).size).toBe(4);
    expect(capture.snapshot.queue.currentIndex).toBe(2);
    expect(capture.snapshot.queue.executionOrder).toEqual([thirdId, capture.snapshot.queue.items[3].queueItemId]);
    expect(capture.snapshot.position).toBe(37.25);
    expect(capture.identity).toMatchObject({
      ownerInstanceId: 'local-owner-1', sessionId: c.getSnapshot().sessionId,
      contentId: 'plex:a', queueItemId: thirdId,
    });
    expect(capture.capabilities.handoffV1).toBe(false);

    capture.snapshot.queue.items[0].title = 'mutated by consumer';
    expect(c.getSnapshot().queue.items[0].title).toBe('A');
  });

  it('revises playback for a same-content restart but not metadata or hot-position evidence', () => {
    const c = createLocalSessionController({ clientId: 'revision-client', ownerInstanceId: 'local-owner-2' });
    c.queue.add({ contentId: 'plex:a', title: 'A', format: 'video' });
    const initial = c.portability.capture().identity;

    c.onPlayerPositionTick(20, 'plex:a');
    c.onPlayerObservation('plex:a', { duration: 120, paused: true });
    const enriched = c.portability.capture().identity;
    expect(enriched).toEqual(initial);

    c.queue.playNow({ contentId: 'plex:a', title: 'A restarted', format: 'video' });
    const restarted = c.portability.capture().identity;
    expect(restarted.playbackRevision).toBeGreaterThan(initial.playbackRevision);
    expect(restarted.queueRevision).toBeGreaterThan(initial.queueRevision);
  });

  it('advances only queue revision for Add into an idle queue', () => {
    const c = createLocalSessionController({ clientId: 'add-revision-client', ownerInstanceId: 'local-owner-add' });
    const before = c.portability.capture().identity;

    c.queue.add({ contentId: 'plex:a', title: 'A', format: 'video' });

    const after = c.portability.capture().identity;
    expect(after.queueRevision).toBeGreaterThan(before.queueRevision);
    expect(after.playbackRevision).toBe(before.playbackRevision);
    expect(after.contentId).toBeNull();
    expect(after.queueItemId).toBeNull();
  });

  it('captures one finite repeat-all lap from the current entry, including the wrap', () => {
    const c = createLocalSessionController({ clientId: 'repeat-client', ownerInstanceId: 'local-repeat-owner' });
    c.queue.add({ contentId: 'plex:a', format: 'video' });
    c.queue.add({ contentId: 'plex:b', format: 'video' });
    c.queue.add({ contentId: 'plex:a', format: 'video' });
    const thirdId = c.getSnapshot().queue.items[2].queueItemId;
    c.queue.jump(thirdId);
    c.config.setRepeat('all');

    const capture = c.portability.capture();
    expect(capture.snapshot.queue.executionOrder).toEqual([
      thirdId,
      c.getSnapshot().queue.items[0].queueItemId,
      c.getSnapshot().queue.items[1].queueItemId,
    ]);
  });

  it('does not promise a future order while repeat-all shuffle chooses future visits randomly', () => {
    const c = createLocalSessionController({ clientId: 'shuffle-capture-client', ownerInstanceId: 'local-shuffle-owner' });
    c.queue.add({ contentId: 'plex:a', format: 'video' });
    c.queue.add({ contentId: 'plex:b', format: 'video' });
    c.queue.add({ contentId: 'plex:c', format: 'video' });
    const secondId = c.getSnapshot().queue.items[1].queueItemId;
    c.queue.jump(secondId);
    c.config.setRepeat('all');
    c.config.setShuffle(true);

    const capture = c.portability.capture();
    expect(capture.snapshot.queue.executionOrder).toEqual([secondId]);
    expect(capture.snapshot.queue.items.map((item) => item.contentId)).toEqual(['plex:a', 'plex:b', 'plex:c']);
    expect(capture.snapshot.config).toMatchObject({ repeat: 'all', shuffle: true });
  });
});

// "Play album plays one track and stops" regression suite: container queue
// inputs expand into their playable children via the list router before
// enqueueing (containerExpansion.js); leaves keep the exact sync behavior.
describe('LocalSessionController — container expansion', () => {
  const albumInput = { contentId: 'plex:900', title: 'The Album', itemType: 'container', format: null };
  const albumChildren = [1, 2, 3].map((n) => ({
    id: `plex:${n}`, title: `Track ${n}`, itemType: 'leaf', type: 'track',
    play: { contentId: `plex:${n}` }, duration: 100 + n, thumbnail: null,
  }));
  const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => ({ items: albumChildren }) }));

  it('playNow on a container plays the first child and queues the rest in order', async () => {
    const fetchImpl = okFetch();
    const c = makeController({ fetchImpl });
    c.queue.playNow(albumInput, { clearRest: true });
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(3));
    const snap = c.getSnapshot();
    expect(snap.queue.items.map((i) => i.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    expect(snap.queue.currentIndex).toBe(0);
    expect(snap.currentItem?.contentId).toBe('plex:1'); // first child loaded…
    expect(snap.state).toBe('loading'); // …and playing immediately
    expect(snap.queue.items[1].containerTitle).toBe('The Album');
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/list/plex/900');
  });

  it('playNext on a container inserts the whole batch at the front of the band, in order', async () => {
    const fetchImpl = okFetch();
    const c = makeController({ fetchImpl });
    c.queue.add({ contentId: 'now', format: 'video' });
    c.queue.add({ contentId: 'later', format: 'video' });
    c.transport.play();
    c.queue.playNext(albumInput);
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(5));
    const snap = c.getSnapshot();
    expect(snap.queue.items.map((i) => i.contentId))
      .toEqual(['now', 'plex:1', 'plex:2', 'plex:3', 'later']);
    expect(snap.queue.items[1].priority).toBe('upNext');
    expect(snap.queue.items[3].priority).toBe('upNext');
    expect(snap.currentItem?.contentId).toBe('now'); // current untouched
  });

  it('non-container inputs enqueue synchronously and never touch the network', () => {
    const fetchImpl = vi.fn();
    const c = makeController({ fetchImpl });
    c.queue.playNow({ contentId: 'plex:7', title: 'A Track', format: 'audio' }, { clearRest: true });
    // assert IMMEDIATELY — the leaf path must stay synchronous
    expect(c.getSnapshot().currentItem?.contentId).toBe('plex:7');
    expect(c.getSnapshot().queue.items).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('expansion failure degrades to the current single-item behavior (no dead tap)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const c = makeController({ fetchImpl });
    c.queue.playNow(albumInput, { clearRest: true });
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(1));
    expect(c.getSnapshot().currentItem?.contentId).toBe('plex:900');
    expect(c.getSnapshot().state).toBe('loading');
  });

  it('zero children also degrades to single-item', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    const c = makeController({ fetchImpl });
    c.queue.addUpNext(albumInput);
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(1));
    expect(c.getSnapshot().queue.items[0].contentId).toBe('plex:900');
  });

  it('add on a container holds all children in natural order without loading the first', async () => {
    const fetchImpl = okFetch();
    const c = makeController({ fetchImpl });
    const loadActions = [];
    c.store.onTransition((_prev, _next, action) => {
      if (action?.type === 'LOAD_ITEM') loadActions.push(action);
    });
    c.queue.add(albumInput);
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(3));
    const snap = c.getSnapshot();
    expect(snap.queue.items.map((item) => item.contentId)).toEqual(['plex:1', 'plex:2', 'plex:3']);
    expect(snap.queue.currentIndex).toBe(-1);
    expect(snap.currentItem).toBeNull();
    expect(snap.state).toBe('ready');
    expect(loadActions).toHaveLength(0);
  });

  it('does not let a delayed Add expansion replace newer explicit playback', async () => {
    let resolveFetch;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const c = makeController({ fetchImpl });
    const loadActions = [];
    c.store.onTransition((_prev, _next, action) => {
      if (action?.type === 'LOAD_ITEM') loadActions.push(action.item.contentId);
    });
    c.queue.add(albumInput);
    c.queue.playNow({ contentId: 'human-choice', format: 'video' }, { clearRest: true });

    resolveFetch({ ok: true, json: async () => ({ items: albumChildren }) });
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(4));

    const snap = c.getSnapshot();
    expect(snap.queue.items.map((item) => item.contentId))
      .toEqual(['human-choice', 'plex:1', 'plex:2', 'plex:3']);
    expect(snap.currentItem?.contentId).toBe('human-choice');
    expect(snap.state).toBe('loading');
    expect(loadActions).toEqual(['human-choice']);
  });
});
