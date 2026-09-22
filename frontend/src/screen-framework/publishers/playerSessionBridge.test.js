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
    const acceptedRegistration = {
      node: el,
      resolvedContentId: 'plex:state',
      resolvedGeneration: 1,
      ownerInstanceId: 'state-owner',
      playbackRevision: 1,
    };
    const handle = {
      ...makeHandle({ el }),
      getMountedContentId: () => 'plex:state',
      getMountedMediaGeneration: () => 1,
      getMountedMediaRegistration: () => acceptedRegistration,
      getPlaybackIdentity: () => ({ ownerInstanceId: 'state-owner', playbackRevision: 1, queueRevision: 1 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    expect(bridge.player.getState()).toBe('buffering');

    el.dispatchEvent(new Event('playing'));
    expect(bridge.player.getState()).toBe('playing');
    bridge.stop();
  });

  it('refreshes native observation when only the admitted owner revision changes', () => {
    const el = document.createElement('video');
    Object.defineProperties(el, {
      currentTime: { configurable: true, writable: true, value: 10 },
      paused: { configurable: true, writable: true, value: false },
      seeking: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
      error: { configurable: true, writable: true, value: null },
    });
    let playbackRevision = 1;
    let logicalOwnerInstanceId = 'resume-owner';
    const handle = {
      ...makeHandle({ el }),
      getMountedContentId: () => 'plex:resume',
      getMountedMediaGeneration: () => 7,
      getMountedMediaRegistration: () => ({
        node: el, resolvedContentId: 'plex:resume', resolvedGeneration: 7,
        // Mount registration is immutable for this admitted native node.
        // Stop → Play only changes the logical owner transport revision.
        ownerInstanceId: 'resume-owner', playbackRevision: 1,
      }),
      getPlaybackIdentity: () => ({ ownerInstanceId: logicalOwnerInstanceId, playbackRevision, queueRevision: 3 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    el.dispatchEvent(new Event('playing'));
    expect(bridge.player.getState()).toBe('playing');

    // Stop → Play changes the transport revision without remounting its
    // admitted media element or renderer generation.
    playbackRevision = 2;
    expect(bridge.player.getState()).toBe('buffering');
    el.dispatchEvent(new Event('playing'));
    expect(bridge.player.getState()).toBe('playing');

    // A different logical owner cannot inherit an older node's admission,
    // even when its element/content/generation have not yet changed.
    logicalOwnerInstanceId = 'replacement-owner';
    playbackRevision = 3;
    expect(bridge.player.getState()).toBe('buffering');
    el.dispatchEvent(new Event('playing'));
    expect(bridge.player.getState()).toBe('buffering');
    bridge.stop();
  });

  it('rearms playing only when the current admitted node advances after waiting', () => {
    const el = document.createElement('video');
    Object.defineProperties(el, {
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, value: 180 },
      paused: { configurable: true, writable: true, value: false },
      seeking: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
      error: { configurable: true, writable: true, value: null },
    });
    const acceptedRegistration = {
      node: el,
      resolvedContentId: 'plex:advance',
      resolvedGeneration: 1,
      ownerInstanceId: 'advance-owner',
      playbackRevision: 1,
    };
    const handle = {
      ...makeHandle({ el }),
      getMountedContentId: () => 'plex:advance',
      getMountedMediaGeneration: () => 1,
      getMountedMediaRegistration: () => acceptedRegistration,
      getPlaybackIdentity: () => ({ ownerInstanceId: 'advance-owner', playbackRevision: 1, queueRevision: 1 }),
    };
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);

    // No `playing` event: real forward motion is affirmative evidence after
    // a waiting event cleared the earlier observation.
    el.dispatchEvent(new Event('waiting'));
    el.currentTime = 11;
    el.dispatchEvent(new Event('timeupdate'));
    expect(bridge.player.getState()).toBe('playing');

    el.dispatchEvent(new Event('waiting'));
    el.paused = true;
    el.currentTime = 12;
    el.dispatchEvent(new Event('timeupdate'));
    expect(bridge.player.getState()).toBe('paused');

    el.paused = false;
    el.seeking = true;
    el.dispatchEvent(new Event('waiting'));
    el.currentTime = 13;
    el.dispatchEvent(new Event('timeupdate'));
    expect(bridge.player.getState()).toBe('buffering');

    el.seeking = false;
    el.dispatchEvent(new Event('waiting'));
    el.dispatchEvent(new Event('timeupdate'));
    expect(bridge.player.getState()).toBe('buffering');
    bridge.stop();
  });

  it('binds native observations to the resolved node/generation and ignores retired events', () => {
    const nodeA = document.createElement('video');
    const nodeB = document.createElement('video');
    for (const [node, time] of [[nodeA, 11], [nodeB, 23]]) {
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
    const queueB = {
      items: [{ queueItemId: 'entry-b', contentId: 'plex:b', format: 'video', priority: 'queue' }],
      currentIndex: 0, upNextCount: 0, executionOrder: ['entry-b'],
    };
    let node = nodeA;
    let mountedContentId = 'plex:a';
    let mountedGeneration = 1;
    let playbackRevision = 4;
    let acceptedRegistration = {
      node: nodeA,
      resolvedContentId: 'plex:a',
      resolvedGeneration: mountedGeneration,
      ownerInstanceId: 'native-owner',
      playbackRevision,
    };
    const handle = {
      ...makeHandle({ meta: { contentId: 'plex:b', format: 'video' }, queueSnapshot: queueB }),
      getMediaElement: () => node,
      getMountedContentId: () => mountedContentId,
      getMountedMediaGeneration: () => mountedGeneration,
      getMountedMediaRegistration: () => acceptedRegistration,
      getPlaybackIdentity: () => ({ ownerInstanceId: 'native-owner', playbackRevision, queueRevision: 7 }),
    };
    const bridge = startBridge(() => handle);
    const source = createRegistrySessionSource({ registry, ownerId: 'screen', sessionId: 'native-session' });

    const pending = source.getNativeObservation();
    expect(pending).toMatchObject({ node: nodeA, resolvedContentId: 'plex:a', identity: null });
    expect(pending.playingObserved).toBe(false);

    const observations = [];
    const unsubscribe = source.subscribeNative((observation) => observations.push(observation));
    node = nodeB;
    mountedContentId = 'plex:b';
    mountedGeneration += 1;
    playbackRevision += 1;
    acceptedRegistration = {
      node: nodeB,
      resolvedContentId: 'plex:b',
      resolvedGeneration: mountedGeneration,
      ownerInstanceId: 'native-owner',
      playbackRevision,
    };
    const resolved = source.getNativeObservation();
    expect(resolved).toMatchObject({
      node: nodeB,
      resolvedContentId: 'plex:b',
      identity: { ownerInstanceId: 'native-owner', playbackRevision: 5, queueRevision: 7, sessionId: 'native-session', contentId: 'plex:b', queueItemId: 'entry-b' },
      currentTime: 23, duration: 180, readyState: 3, paused: false, seeking: false, ended: false,
      playingObserved: false, advancedObserved: false,
    });

    nodeB.dispatchEvent(new Event('playing'));
    nodeB.currentTime = 24;
    nodeB.dispatchEvent(new Event('timeupdate'));
    expect(source.getNativeObservation()).toMatchObject({ playingObserved: true, advancedObserved: true, currentTime: 24 });
    const eventCount = observations.length;
    nodeA.dispatchEvent(new Event('playing'));
    nodeA.currentTime = 99;
    nodeA.dispatchEvent(new Event('timeupdate'));
    expect(observations).toHaveLength(eventCount);
    expect(source.getNativeObservation().currentTime).toBe(24);

    unsubscribe();
    nodeB.dispatchEvent(new Event('pause'));
    expect(observations).toHaveLength(eventCount);
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

  it('does not resurrect a static hint after an owner explicitly detaches its item', () => {
    let stopped = false;
    const handle = {
      ...makeHandle({ meta: null }),
      getNowPlaying: () => (stopped
        ? { item: null, stopped: true, queuePosition: null }
        : { item: null, queuePosition: null }),
      getOwnerState: () => (stopped ? 'ready' : 'loading'),
    };
    const bridge = startBridge(
      () => handle,
      { getItemHint: () => ({ contentId: 'plex:mount-hint', title: 'Mount hint' }) },
    );

    expect(bridge.queueController.getCurrentItem()).toMatchObject({ contentId: 'plex:mount-hint' });
    stopped = true;
    expect(bridge.queueController.getCurrentItem()).toBeNull();
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

  it('retains the decoder observer when React recreates the same Player public handle', () => {
    const oldNode = document.createElement('video');
    const freshNode = document.createElement('video');
    const rendererToken = Object.freeze({ tokenId: 'renderer-fresh', node: freshNode });
    let operationObserver = null;
    const adoptSessionSnapshot = vi.fn(() => ({ ok: true }));
    const registration = {
      node: freshNode,
      resolvedContentId: 'plex:a',
      resolvedGeneration: 2,
      rendererToken,
      ownerInstanceId: 'legacy-owner',
      playbackRevision: 1,
    };
    let activeNode = oldNode;
    let handle = {
      ...makeHandle({ el: oldNode, meta: { contentId: 'plex:a', format: 'video' }, queueSnapshot: {
        items: [{ queueItemId: 'a', contentId: 'plex:a', format: 'video' }],
        currentIndex: 0, executionOrder: ['a'],
      } }),
      getPlayerInstanceId: () => 'stable-player-instance',
      getMediaElement: () => activeNode,
      getMountedContentId: () => 'plex:a',
      getMountedMediaGeneration: () => activeNode === freshNode ? 2 : 1,
      getMountedMediaRegistration: () => activeNode === freshNode ? registration : null,
      getPlaybackIdentity: () => ({ ownerInstanceId: 'legacy-owner', playbackRevision: 1, queueRevision: 1 }),
      subscribeMountedMediaOperations: (observer) => {
        operationObserver = observer;
        return { observerId: 'legacy-operation-observer', unsubscribe: vi.fn() };
      },
      adoptSessionSnapshot,
    };
    const bridge = startBridge(() => handle);
    expect(operationObserver).toBeTypeOf('function');

    // Player's useImperativeHandle publishes a fresh object after owner state
    // changes even though the physical Player instance and observer map remain.
    handle = { ...handle };
    bridge.queueController.adopt({ queue: {} }, { autoplay: false, operationId: 'legacy-adopt-1' });
    expect(adoptSessionSnapshot).toHaveBeenCalledWith({ queue: {} }, {
      autoplay: false,
      operationId: 'legacy-adopt-1',
      requiredObserverIds: ['legacy-operation-observer'],
    });

    activeNode = freshNode;
    const binding = {
      operationId: 'legacy-adopt-1', targetSeconds: 8,
      node: freshNode, resolvedGeneration: 2, rendererToken,
    };
    expect(operationObserver(binding)).toEqual({ ready: true, ...binding });
    expect(bridge.queueController.getNativeObservation('legacy-session')).toMatchObject({
      operationId: 'legacy-adopt-1', rendererToken, resolvedGeneration: 2,
      targetSeekedObserved: false,
    });
    freshNode.currentTime = 5;
    freshNode.dispatchEvent(new Event('seeking'));
    freshNode.currentTime = 8;
    freshNode.dispatchEvent(new Event('seeked'));
    expect(bridge.queueController.getNativeObservation('legacy-session'))
      .toMatchObject({ targetSeekedObserved: true });
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

  it('routes guarded Stop only to the currently registered owner', () => {
    const makeOwner = (ownerInstanceId, queueItemId) => {
      const stopIfCurrent = vi.fn((expected, sessionId) => {
        const actual = {
          ownerInstanceId, playbackRevision: 1, queueRevision: 1,
          sessionId, contentId: `plex:${ownerInstanceId}`, queueItemId,
        };
        return JSON.stringify(expected) === JSON.stringify(actual)
          ? { ok: true }
          : { ok: false, code: 'SOURCE_CHANGED' };
      });
      return {
        stopIfCurrent,
        registration: {
          queueController: {
            capture: (sessionId) => ({
              queue: {
                items: [{ queueItemId, contentId: `plex:${ownerInstanceId}`, format: 'video', priority: 'normal' }],
                currentIndex: 0, upNextCount: 0, executionOrder: [queueItemId],
              },
              currentItem: { contentId: `plex:${ownerInstanceId}`, format: 'video' },
              config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
              state: 'paused', position: 0,
              identity: {
                ownerInstanceId, playbackRevision: 1, queueRevision: 1,
                sessionId, contentId: `plex:${ownerInstanceId}`, queueItemId,
              },
            }),
            getOwnerCapabilities: () => ({ handoffV1: false, seekable: true, liveEdge: false }),
            stopIfCurrent,
            subscribe: () => () => {},
          },
        },
      };
    };
    const ownerA = makeOwner('owner-a', 'queue-a');
    const ownerB = makeOwner('owner-b', 'queue-b');
    registry.registerPlayerSession(ownerA.registration);
    const src = createRegistrySessionSource({ registry, ownerId: 'tv', sessionId: 'registry-guard' });
    const stale = src.capture().identity;

    registry.registerPlayerSession(ownerB.registration);
    expect(src.stopIfCurrent(stale)).toEqual({ ok: false, code: 'SOURCE_CHANGED' });
    expect(ownerA.stopIfCurrent).not.toHaveBeenCalled();
    expect(ownerB.stopIfCurrent).toHaveBeenCalledTimes(1);

    const fresh = src.capture().identity;
    expect(src.stopIfCurrent(fresh)).toEqual({ ok: true });
    expect(ownerB.stopIfCurrent).toHaveBeenCalledTimes(2);
  });

  it('rewires native subscriptions on owner replacement and retires old emitters', () => {
    const makeNativeOwner = (label) => {
      const listeners = new Set();
      return {
        emit: () => { for (const listener of [...listeners]) listener({ label }); },
        listenerCount: () => listeners.size,
        registration: {
          queueController: {
            subscribeNative: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            subscribe: () => () => {},
          },
        },
      };
    };
    const ownerA = makeNativeOwner('a');
    const ownerB = makeNativeOwner('b');
    registry.registerPlayerSession(ownerA.registration);
    const src = createRegistrySessionSource({ registry, ownerId: 'tv', sessionId: 'native-rewire' });
    const seen = [];
    const unsubscribe = src.subscribeNative((observation) => seen.push(observation.label));
    ownerA.emit();
    expect(seen).toEqual(['a']);

    registry.registerPlayerSession(ownerB.registration);
    expect(ownerA.listenerCount()).toBe(0);
    expect(ownerB.listenerCount()).toBe(1);
    ownerA.emit();
    ownerB.emit();
    expect(seen).toEqual(['a', 'b']);

    unsubscribe();
    expect(ownerB.listenerCount()).toBe(0);
  });
});
