// Tests for the fleet state-bridge chain: playerSessionRegistry →
// playerSessionBridge → registrySessionSource. This is what makes a screen
// device (living room TV / office) publish real device-state instead of
// "unknown" — it runs 24/7 on the kiosks, so every seam is exercised here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayerSessionRegistry } from './playerSessionRegistry.js';
import { createPlayerSessionBridge, normalizePlayableItem } from './playerSessionBridge.js';
import { createRegistrySessionSource } from './registrySessionSource.js';

function makeMediaEl({ paused = false, ended = false } = {}) {
  return { paused, ended };
}

function makeHandle({ el = makeMediaEl(), meta = null, time = 12, duration = 300, volume = 0.4, rate = 1 } = {}) {
  return {
    getMediaElement: () => el,
    getNowPlaying: () => ({ item: meta, isQueue: false, queuePosition: null, queueLength: meta ? 1 : 0 }),
    getCurrentTime: () => time,
    getDuration: () => duration,
    getVolume: () => volume,
    getPlaybackRate: () => rate,
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

  it('maps the media element to playing/paused/ended and no element to loading', () => {
    const el = makeMediaEl();
    let handle = makeHandle({ el });
    const bridge = startBridge(() => handle);
    vi.advanceTimersByTime(1000);
    expect(bridge.player.getState()).toBe('playing');

    el.paused = true;
    expect(bridge.player.getState()).toBe('paused');
    el.ended = true;
    expect(bridge.player.getState()).toBe('ended');

    handle = { ...makeHandle(), getMediaElement: () => null };
    expect(bridge.player.getState()).toBe('loading');
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
    expect(states).toEqual(['playing']);
    const itemEventsAfterSteady = queueEvents.mock.calls.length;

    el.paused = true;
    vi.advanceTimersByTime(1000);
    expect(states).toEqual(['playing', 'paused']);

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
