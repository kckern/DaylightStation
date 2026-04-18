import { describe, it, expect, vi } from 'vitest';
import { createSessionSource } from './SessionSource.js';
import { validateSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

function makeQueue(initial = {}) {
  const state = {
    items: initial.items ?? [],
    currentIndex: initial.currentIndex ?? -1,
    currentItem: initial.currentItem ?? null,
    upNextCount: initial.upNextCount,
    subscribers: new Set(),
  };
  return {
    getQueue: vi.fn(() => state.items),
    getCurrentIndex: vi.fn(() => state.currentIndex),
    getCurrentItem: vi.fn(() => state.currentItem),
    getUpNextCount: state.upNextCount !== undefined ? vi.fn(() => state.upNextCount) : undefined,
    subscribe: vi.fn((cb) => {
      state.subscribers.add(cb);
      return () => state.subscribers.delete(cb);
    }),
    _fire: () => { for (const cb of state.subscribers) cb(); },
    _state: state,
    _setItems(items) { state.items = items; },
    _setCurrentItem(item) { state.currentItem = item; },
    _setCurrentIndex(i) { state.currentIndex = i; },
  };
}

function makePlayer(initial = {}) {
  const state = {
    stateVal: initial.state ?? 'idle',
    position: initial.position ?? 0,
    duration: initial.duration ?? 0,
    config: initial.config,
    subscribers: new Set(),
  };
  const api = {
    getState: vi.fn(() => state.stateVal),
    getPosition: vi.fn(() => state.position),
    getDuration: vi.fn(() => state.duration),
    subscribe: vi.fn((cb) => {
      state.subscribers.add(cb);
      return () => state.subscribers.delete(cb);
    }),
    _setState(s) { state.stateVal = s; },
    _setPosition(p) { state.position = p; },
    _fire(evt) { for (const cb of state.subscribers) cb(evt); },
    _state: state,
  };
  if (initial.config !== undefined) {
    api.getConfig = vi.fn(() => state.config);
  }
  return api;
}

describe('createSessionSource', () => {
  it('requires an ownerId', () => {
    expect(() => createSessionSource({})).toThrow(/ownerId/);
  });

  it('produces a valid SessionSnapshot when both sources are provided', () => {
    const queue = makeQueue({
      items: [
        { queueItemId: 'q1', contentId: 'plex:1', priority: 'upNext' },
        { queueItemId: 'q2', contentId: 'plex:2', priority: 'queue' },
      ],
      currentIndex: 0,
      currentItem: { contentId: 'plex:1', format: 'video', title: 'Foo' },
    });
    const player = makePlayer({
      state: 'playing',
      position: 42.5,
      config: { shuffle: true, repeat: 'all', shader: 'wave', volume: 80, playbackRate: 1.5 },
    });

    const source = createSessionSource({
      queueController: queue,
      player,
      ownerId: 'tv-1',
    });

    const snap = source.getSnapshot();
    const v = validateSessionSnapshot(snap);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(snap.state).toBe('playing');
    expect(snap.position).toBe(42.5);
    expect(snap.queue.items).toHaveLength(2);
    expect(snap.queue.currentIndex).toBe(0);
    expect(snap.queue.upNextCount).toBe(1);
    expect(snap.currentItem).toEqual({ contentId: 'plex:1', format: 'video', title: 'Foo' });
    expect(snap.config).toEqual({ shuffle: true, repeat: 'all', shader: 'wave', volume: 80, playbackRate: 1.5 });
    expect(snap.meta.ownerId).toBe('tv-1');
  });

  it('returns an idle snapshot when both queueController and player are null', () => {
    const source = createSessionSource({ ownerId: 'tv-1' });
    const snap = source.getSnapshot();
    const v = validateSessionSnapshot(snap);
    expect(v.valid).toBe(true);
    expect(snap.state).toBe('idle');
    expect(snap.position).toBe(0);
    expect(snap.queue.items).toEqual([]);
    expect(snap.queue.currentIndex).toBe(-1);
    expect(snap.currentItem).toBe(null);
  });

  it('handles a missing player but present queue', () => {
    const queue = makeQueue({
      items: [{ queueItemId: 'q1', contentId: 'plex:1', priority: 'queue' }],
      currentIndex: 0,
      currentItem: { contentId: 'plex:1', format: 'audio' },
    });
    const source = createSessionSource({ queueController: queue, ownerId: 'tv-1' });
    const snap = source.getSnapshot();
    const v = validateSessionSnapshot(snap);
    expect(v.valid).toBe(true);
    expect(snap.state).toBe('idle');
    expect(snap.currentItem).toEqual({ contentId: 'plex:1', format: 'audio' });
  });

  it('reflects current queue items and position', () => {
    const queue = makeQueue({ items: [], currentIndex: -1 });
    const player = makePlayer({ state: 'paused', position: 10 });
    const source = createSessionSource({ queueController: queue, player, ownerId: 'tv-1' });

    let snap = source.getSnapshot();
    expect(snap.state).toBe('paused');
    expect(snap.position).toBe(10);

    queue._setItems([{ queueItemId: 'q1', contentId: 'plex:3', priority: 'queue' }]);
    queue._setCurrentIndex(0);
    player._setState('playing');
    player._setPosition(99.9);

    snap = source.getSnapshot();
    expect(snap.state).toBe('playing');
    expect(snap.position).toBe(99.9);
    expect(snap.queue.items).toHaveLength(1);
    expect(snap.queue.currentIndex).toBe(0);
  });

  it('onChange fires when the queueController subscriber callback fires', () => {
    const queue = makeQueue();
    const player = makePlayer();
    const source = createSessionSource({ queueController: queue, player, ownerId: 'tv-1' });

    const onChange = vi.fn();
    const onStateTransition = vi.fn();
    const unsub = source.subscribe({ onChange, onStateTransition });

    expect(queue.subscribe).toHaveBeenCalledTimes(1);
    queue._fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('onStateTransition fires with mapped state when the player subscriber fires', () => {
    const queue = makeQueue();
    const player = makePlayer();
    const source = createSessionSource({ queueController: queue, player, ownerId: 'tv-1' });

    const transitions = [];
    const unsub = source.subscribe({
      onChange: () => {},
      onStateTransition: (s) => transitions.push(s),
    });

    player._fire('playing');
    player._fire({ state: 'paused' });
    player._fire({ type: 'ended' });
    player._fire('totally-unknown');

    expect(transitions).toEqual(['playing', 'paused', 'ended', 'idle']);
    unsub();
  });

  it('unsubscribe detaches both the queue and player subscriptions', () => {
    const queue = makeQueue();
    const player = makePlayer();
    const source = createSessionSource({ queueController: queue, player, ownerId: 'tv-1' });

    const onChange = vi.fn();
    const onStateTransition = vi.fn();
    const unsub = source.subscribe({ onChange, onStateTransition });

    unsub();

    queue._fire();
    player._fire('playing');

    expect(onChange).not.toHaveBeenCalled();
    expect(onStateTransition).not.toHaveBeenCalled();
    expect(queue._state.subscribers.size).toBe(0);
    expect(player._state.subscribers.size).toBe(0);
  });

  it('sessionId is stable across getSnapshot calls', () => {
    const queue = makeQueue({ currentItem: null });
    const player = makePlayer({ state: 'idle' });
    const source = createSessionSource({
      queueController: queue,
      player,
      ownerId: 'tv-1',
    });
    const snap1 = source.getSnapshot();
    const snap2 = source.getSnapshot();
    expect(snap1.sessionId).toBe(snap2.sessionId);
    expect(source.sessionId).toBe(snap1.sessionId);
  });

  it('respects an explicit sessionId option', () => {
    const source = createSessionSource({ ownerId: 'tv-1', sessionId: 'forced-id' });
    expect(source.sessionId).toBe('forced-id');
    expect(source.getSnapshot().sessionId).toBe('forced-id');
  });

  it('defaults config to canonical defaults when player has no getConfig', () => {
    const queue = makeQueue();
    const player = makePlayer();  // no getConfig
    const source = createSessionSource({ queueController: queue, player, ownerId: 'tv-1' });
    const snap = source.getSnapshot();
    expect(snap.config).toEqual({
      shuffle: false,
      repeat: 'off',
      shader: null,
      volume: 50,
      playbackRate: 1.0,
    });
  });
});
