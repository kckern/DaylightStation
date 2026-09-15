// Tests for the fleet state-bridge chain: playerSessionRegistry →
// playerSessionBridge → registrySessionSource. This is what makes a screen
// device (living room TV / office) publish real device-state instead of
// "unknown" — it runs 24/7 on the kiosks, so every seam is exercised here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayerSessionRegistry } from './playerSessionRegistry.js';
import { createPlayerSessionBridge, normalizePlayableItem } from './playerSessionBridge.js';
import { createRegistrySessionSource } from './registrySessionSource.js';
import { createSessionSource } from './SessionSource.js';

function makeMediaEl({ paused = false, ended = false } = {}) {
  return { paused, ended };
}

function makeHandle({ el = makeMediaEl(), meta = null, time = 12, duration = 300, volume = 0.4, rate = 1, queueSnapshot = null } = {}) {
  return {
    getMediaElement: () => el,
    getNowPlaying: () => ({ item: meta, isQueue: false, queuePosition: null, queueLength: meta ? 1 : 0 }),
    getCurrentTime: () => time,
    getDuration: () => duration,
    getVolume: () => volume,
    getPlaybackRate: () => rate,
    getQueueSnapshot: () => queueSnapshot,
  };
}

describe('playerSessionRegistry', () => {
  it('last write wins and stale unregister is a no-op', () => {
    const reg = createPlayerSessionRegistry();
    const un1 = reg.registerPlayerSession({ player: { a: 1 } });
    const un2 = reg.registerPlayerSession({ player: { b: 2 } });
    expect(reg.getCurrent().player).toEqual({ b: 2 });

    un1(); // stale — must NOT clobber the newer registration
    expect(reg.getCurrent()).not.toBeNull();
    expect(reg.getCurrent().player).toEqual({ b: 2 });

    un2();
    expect(reg.getCurrent()).toBeNull();
  });

  it('notifies subscribers on register/unregister and survives a throwing listener', () => {
    const reg = createPlayerSessionRegistry();
    const seen = [];
    reg.subscribe(() => { throw new Error('boom'); });
    reg.subscribe((cur) => seen.push(cur ? 'set' : 'null'));
    const un = reg.registerPlayerSession({});
    un();
    expect(seen).toEqual(['set', 'null']);
  });
});

describe('normalizePlayableItem', () => {
  it('derives contentId from meta id fields with hint fallback', () => {
    expect(normalizePlayableItem({ assetId: 'plex:347695', title: 'Christmas Clips' }))
      .toMatchObject({ contentId: 'plex:347695', title: 'Christmas Clips', format: 'video' });
    expect(normalizePlayableItem(null, { plex: '59493', title: 'Bluey' }))
      .toMatchObject({ contentId: '59493', title: 'Bluey' });
    expect(normalizePlayableItem(null, null)).toBeNull();
    expect(normalizePlayableItem({ title: 'no identity' })).toBeNull();
  });

  it('maps mediaType to a known format and keeps valid formats', () => {
    expect(normalizePlayableItem({ id: 'x', mediaType: 'audio' }).format).toBe('audio');
    expect(normalizePlayableItem({ id: 'x', format: 'readalong' }).format).toBe('readalong');
    expect(normalizePlayableItem({ id: 'x', format: 'not-a-format' }).format).toBe('video');
  });
});

describe('createPlayerSessionBridge', () => {
  it('preserves hls_video in normalized owner metadata', () => {
    expect(normalizePlayableItem({ contentId: 'plex:hls', format: 'hls_video', title: 'HLS' })).toMatchObject({
      contentId: 'plex:hls', format: 'hls_video', title: 'HLS',
    });
  });

  let registry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = createPlayerSessionRegistry();
  });
  afterEach(() => vi.useRealTimers());

  function startBridge(getHandle, opts = {}) {
    const bridge = createPlayerSessionBridge({
      getPlayerHandle: getHandle,
      registry,
      pollMs: 1000,
      ...opts,
    });
    bridge.start();
    return bridge;
  }

  it('registers when the handle appears and unregisters when it disappears', () => {
    let handle = null;
    const bridge = startBridge(() => handle);
    expect(registry.getCurrent()).toBeNull();

    handle = makeHandle();
    vi.advanceTimersByTime(1000);
    expect(registry.getCurrent()).not.toBeNull();

    handle = null;
    vi.advanceTimersByTime(1000);
    expect(registry.getCurrent()).toBeNull();
    bridge.stop();
  });

  it('maps the media element to buffering/paused/ended and no element to loading until playing is observed', () => {
    const el = makeMediaEl();
    let handle = makeHandle({ el });
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    expect(bridge.player.getState()).toBe('buffering');

    el.paused = true;
    expect(bridge.player.getState()).toBe('paused');
    el.ended = true;
    expect(bridge.player.getState()).toBe('ended');

    handle = { ...makeHandle(), getMediaElement: () => null };
    expect(bridge.player.getState()).toBe('loading');
    bridge.stop();
  });

  it('requires a native playing event before an unpaused decoder is reported as playing', () => {
    const el = document.createElement('video');
    Object.defineProperties(el, {
      paused: { configurable: true, value: false },
      ended: { configurable: true, value: false },
    });
    const bridge = startBridge(() => makeHandle({ el }));
    vi.advanceTimersByTime(1000);
    expect(bridge.player.getState()).toBe('buffering');

    el.dispatchEvent(new Event('playing'));
    expect(bridge.player.getState()).toBe('playing');
    bridge.stop();
  });

  it('reports position/duration/config from the handle (volume rescaled 0..100)', () => {
    const bridge = startBridge(() => makeHandle({ time: 42.5, duration: 420, volume: 0.4, rate: 1.5 }));
    vi.advanceTimersByTime(1000);
    expect(bridge.player.getPosition()).toBe(42.5);
    expect(bridge.player.getDuration()).toBe(420);
    expect(bridge.player.getConfig()).toMatchObject({ volume: 40, playbackRate: 1.5 });
    bridge.stop();
  });

  it('builds the current item from now-playing meta, falling back to the mount hint', () => {
    let meta = null;
    const bridge = startBridge(
      () => makeHandle({ meta, duration: 420 }),
      { getItemHint: () => ({ plex: '59493', title: 'Bluey' }) },
    );
    vi.advanceTimersByTime(1000);
    // Meta unresolved → hint carries identity, duration filled from handle.
    expect(bridge.queueController.getCurrentItem()).toMatchObject({ contentId: '59493', title: 'Bluey', duration: 420 });

    meta = { assetId: 'plex:347695', title: 'Christmas Clips', duration: 421 };
    expect(bridge.queueController.getCurrentItem()).toMatchObject({ contentId: 'plex:347695', title: 'Christmas Clips' });
    bridge.stop();
  });

  it('reads the legacy owner’s complete duplicate queue and current execution order', () => {
    const queueSnapshot = {
      items: [
        { queueItemId: 'a-1', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b-1', contentId: 'plex:b', format: 'video', priority: 'upNext' },
        { queueItemId: 'a-2', contentId: 'plex:a', format: 'video', priority: 'queue' },
      ],
      currentIndex: 2,
      upNextCount: 1,
      executionOrder: ['a-2', 'b-1'],
    };
    const bridge = startBridge(() => makeHandle({ queueSnapshot }));
    vi.advanceTimersByTime(1000);
    expect(bridge.queueController.getQueue()).toEqual(queueSnapshot.items);
    expect(bridge.queueController.getCurrentIndex()).toBe(2);
    expect(bridge.queueController.getExecutionOrder()).toEqual(['a-2', 'b-1']);
    bridge.stop();
  });

  it('publishes a detached full legacy capture with owner revisions and current Player config', () => {
    const queueSnapshot = {
      items: [
        { queueItemId: 'a-1', contentId: 'plex:a', format: 'video', priority: 'queue' },
        { queueItemId: 'b-1', contentId: 'plex:b', format: 'video', priority: 'queue' },
        { queueItemId: 'a-2', contentId: 'plex:a', format: 'video', priority: 'queue' },
      ],
      currentIndex: 2,
      upNextCount: 0,
      executionOrder: ['a-2'],
    };
    let issuedIdentity = {
      ownerInstanceId: 'legacy-player-owner-1', playbackRevision: 4, queueRevision: 7,
    };
    const handle = {
      ...makeHandle({ queueSnapshot, meta: { contentId: 'plex:a', format: 'video' }, volume: 0.73, rate: 1.25 }),
      getPlayerInstanceId: () => 'legacy-player-owner-1',
      getPlaybackIdentity: () => issuedIdentity,
      getShader: () => 'night',
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    const source = createSessionSource({
      player: bridge.player, queueController: bridge.queueController,
      ownerId: 'screen-1', sessionId: 'screen-session-1',
    });

    const first = source.getSnapshot();
    expect(first).toMatchObject({
      position: 12,
      config: { volume: 73, playbackRate: 1.25, shader: 'night' },
      queue: { currentIndex: 2, executionOrder: ['a-2'] },
      meta: { playbackOwner: {
        ownerInstanceId: 'legacy-player-owner-1', sessionId: 'screen-session-1',
        contentId: 'plex:a', queueItemId: 'a-2', queueRevision: 7, playbackRevision: 4,
      } },
    });
    first.queue.items[0].contentId = 'mutated';
    expect(source.getSnapshot().queue.items[0].contentId).toBe('plex:a');

    const nextQueue = { ...queueSnapshot, currentIndex: 0, executionOrder: ['a-1', 'b-1', 'a-2'] };
    handle.getQueueSnapshot = () => nextQueue;
    issuedIdentity = { ...issuedIdentity, playbackRevision: 5, queueRevision: 8 };
    const restarted = source.getSnapshot().meta.playbackOwner;
    expect(restarted).toMatchObject({ playbackRevision: 5, queueRevision: 8 });
    bridge.stop();
  });

  it('does not mint verified owner identity from unresolved requested metadata alone', () => {
    const handle = {
      ...makeHandle({ meta: { contentId: 'plex:requested', format: 'video' } }),
      getPlayerInstanceId: () => 'legacy-player-owner-unresolved',
      getPlaybackIdentity: () => ({ ownerInstanceId: 'legacy-player-owner-unresolved', playbackRevision: 0, queueRevision: 0 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    const source = createSessionSource({
      player: bridge.player, queueController: bridge.queueController,
      ownerId: 'screen-1', sessionId: 'screen-session-unresolved',
    });

    expect(source.getSnapshot()).not.toHaveProperty('meta.playbackOwner');
    bridge.stop();
  });

  it('does not infer owner revisions from native events or polls', () => {
    const queues = {
      a: { items: [{ queueItemId: 'a-1', contentId: 'plex:a', format: 'video', priority: 'queue' }], currentIndex: 0, upNextCount: 0, executionOrder: ['a-1'] },
      b: { items: [{ queueItemId: 'b-1', contentId: 'plex:b', format: 'video', priority: 'queue' }], currentIndex: 0, upNextCount: 0, executionOrder: ['b-1'] },
    };
    let queue = queues.a;
    const el = document.createElement('video');
    Object.defineProperties(el, { paused: { configurable: true, value: false }, ended: { configurable: true, writable: true, value: false } });
    const handle = {
      ...makeHandle({ el, meta: { contentId: 'plex:a', format: 'video' } }),
      getQueueSnapshot: () => queue,
      getPlayerInstanceId: () => 'owner-revision-events',
      getPlaybackIdentity: () => ({ ownerInstanceId: 'owner-revision-events', playbackRevision: 7, queueRevision: 11 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    const source = createSessionSource({ player: bridge.player, queueController: bridge.queueController, ownerId: 'screen', sessionId: 'stable-session' });
    const initial = source.getSnapshot().meta.playbackOwner;

    queue = queues.b;
    vi.advanceTimersByTime(1000);
    queue = queues.a;
    vi.advanceTimersByTime(1000);
    el.dispatchEvent(new Event('playing')); // same entry restarted
    el.ended = true;
    vi.advanceTimersByTime(1000);
    el.ended = false;
    el.dispatchEvent(new Event('playing')); // stopped → playing
    vi.advanceTimersByTime(1000);

    const later = source.getSnapshot().meta.playbackOwner;
    expect(later.playbackRevision).toBe(initial.playbackRevision);
    expect(later.queueRevision).toBe(initial.queueRevision);
    bridge.stop();
  });

  it('uses exactly one bridge queue capture for an internally coherent SessionSource snapshot', () => {
    const a = { items: [{ queueItemId: 'a-1', contentId: 'plex:a', format: 'video', priority: 'queue' }], currentIndex: 0, upNextCount: 0, executionOrder: ['a-1'] };
    const b = { items: [{ queueItemId: 'b-1', contentId: 'plex:b', format: 'video', priority: 'queue' }], currentIndex: 0, upNextCount: 0, executionOrder: ['b-1'] };
    let calls = 0;
    const handle = {
      ...makeHandle({ meta: { contentId: 'plex:a', format: 'video' } }),
      getQueueSnapshot: () => (++calls % 2 ? a : b),
      getPlayerInstanceId: () => 'owner-one-capture',
      getPlaybackIdentity: () => ({ ownerInstanceId: 'owner-one-capture', playbackRevision: 0, queueRevision: 0 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    calls = 0;
    const source = createSessionSource({ player: bridge.player, queueController: bridge.queueController, ownerId: 'screen', sessionId: 'capture-session' });
    const snapshot = source.getSnapshot();

    expect(calls).toBe(1);
    expect(snapshot.queue.executionOrder[0]).toBe(snapshot.queue.items[snapshot.queue.currentIndex].queueItemId);
    expect(snapshot.meta.playbackOwner.queueItemId).toBe(snapshot.queue.items[snapshot.queue.currentIndex].queueItemId);
    bridge.stop();
  });

  it('emits player state changes and item changes only when they actually change', () => {
    const el = makeMediaEl();
    let meta = { id: 'plex:1', title: 'A' };
    let handle = null; // player not mounted yet — subscribe first, then mount
    const bridge = startBridge(() => handle);
    const states = [];
    bridge.player.subscribe((s) => states.push(s));
    const queueEvents = vi.fn();
    bridge.queueController.subscribe(queueEvents);

    handle = makeHandle({ el, meta });
    vi.advanceTimersByTime(3000); // several ticks, steady playback
    expect(states).toEqual(['buffering']);
    const itemEventsAfterSteady = queueEvents.mock.calls.length;

    el.paused = true;
    vi.advanceTimersByTime(1000);
    expect(states).toEqual(['buffering', 'paused']);

    handle = makeHandle({ el, meta: { id: 'plex:2', title: 'B' } });
    vi.advanceTimersByTime(1000);
    expect(queueEvents.mock.calls.length).toBe(itemEventsAfterSteady + 1);
    bridge.stop();
  });

  it('a throwing handle getter degrades to unregistered, never throws', () => {
    const bridge = startBridge(() => { throw new Error('ref gone'); });
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(registry.getCurrent()).toBeNull();
    bridge.stop();
  });
});

describe('createRegistrySessionSource', () => {
  let registry;
  beforeEach(() => { registry = createPlayerSessionRegistry(); });

  function playingEntry() {
    return {
      player: {
        getState: () => 'playing',
        getPosition: () => 100,
        getDuration: () => 420,
        getConfig: () => ({ volume: 40 }),
        subscribe: () => () => {},
      },
      queueController: {
        getCurrentItem: () => ({ contentId: 'plex:347695', format: 'video', title: 'Christmas Clips' }),
        getQueue: () => [],
        getCurrentIndex: () => 0,
        subscribe: () => () => {},
      },
    };
  }

  it('is idle with no registration, live when one appears, idle again after', () => {
    const src = createRegistrySessionSource({ registry, ownerId: 'livingroom-tv' });
    expect(src.getSnapshot()).toMatchObject({ state: 'idle', meta: { ownerId: 'livingroom-tv' } });

    const un = registry.registerPlayerSession(playingEntry());
    const live = src.getSnapshot();
    expect(live.state).toBe('playing');
    expect(live.currentItem).toMatchObject({ title: 'Christmas Clips' });
    expect(live.position).toBe(100);

    un();
    expect(src.getSnapshot().state).toBe('idle');
  });

  it('keeps ONE stable sessionId across registration flips', () => {
    const src = createRegistrySessionSource({ registry, ownerId: 'tv' });
    const idleSid = src.getSnapshot().sessionId;
    registry.registerPlayerSession(playingEntry());
    expect(src.getSnapshot().sessionId).toBe(idleSid);
  });

  it('re-emits change + state transition when the registration flips', () => {
    const src = createRegistrySessionSource({ registry, ownerId: 'tv' });
    const onChange = vi.fn();
    const onStateTransition = vi.fn();
    const unsub = src.subscribe({ onChange, onStateTransition });

    registry.registerPlayerSession(playingEntry());
    expect(onChange).toHaveBeenCalled();
    expect(onStateTransition).toHaveBeenCalledWith('playing');
    unsub();
  });

  it('a broken player degrades to idle snapshot, never throws', () => {
    const src = createRegistrySessionSource({ registry, ownerId: 'tv' });
    registry.registerPlayerSession({
      player: { getState: () => { throw new Error('boom'); }, subscribe: () => () => {} },
      queueController: null,
    });
    const snap = src.getSnapshot();
    expect(snap).toBeTruthy();
    // SessionSource maps unknown/broken states to a valid one; identity intact.
    expect(snap.meta.ownerId).toBe('tv');
  });
});
