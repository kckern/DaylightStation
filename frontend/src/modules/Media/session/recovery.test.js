// RELY.5a / RELY.7a / RELY.8a — paused restore, safe discard, local problems,
// and itemised Start fresh at the local session owner.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';
import { readPersistedSession, PERSIST_KEY } from './persistence.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const item = (id, title) => ({ contentId: `plex:${id}`, format: 'video', title, duration: 600 });
const entry = (id, title) => ({ queueItemId: `q-${id}`, ...item(id, title), priority: 'queue', addedAt: '2026-10-01T00:00:00.000Z' });

function persisted(overrides = {}) {
  return {
    sessionId: 'old',
    state: 'playing',
    currentItem: item(1, 'Arrival'),
    position: 321,
    queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: true, repeat: 'all', shader: null, volume: 40, playbackRate: 1 },
    meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    ...overrides,
  };
}

function makeController(overrides = {}) {
  const player = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
  const controller = createLocalSessionController({
    clientId: 'c1', randomUuid: () => 'fresh-session', nowFn: () => new Date('2026-10-02T00:00:00Z'), ...overrides,
  });
  controller.setPlayerHandle(player);
  return { controller, player };
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('paused restore (RELY.7a)', () => {
  it('restores what was playing, its spot, queue, repeat and shuffle — paused and held', () => {
    const { controller, player } = makeController({ persistedSnapshot: persisted() });
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('paused');
    expect(snap.currentItem.contentId).toBe('plex:1');
    expect(snap.position).toBe(321);
    expect(snap.queue.items.map(e => e.contentId)).toEqual(['plex:1', 'plex:2']);
    expect(snap.config).toEqual(expect.objectContaining({ shuffle: true, repeat: 'all' }));
    expect(controller.restore.isHeld()).toBe(true);
    expect(player.play).not.toHaveBeenCalled();
    expect(mediaLog.sessionRestoredPaused).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'old', contentId: 'plex:1', position: 321 }));
  });

  it('only an explicit Play releases the hold', () => {
    const { controller } = makeController({ persistedSnapshot: persisted() });
    const listener = vi.fn();
    controller.restore.subscribe(listener);
    controller.transport.play();
    expect(controller.restore.isHeld()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('a seek while held moves the restored spot without touching a player', () => {
    const { controller, player } = makeController({ persistedSnapshot: persisted() });
    controller.transport.seekAbs(40);
    expect(controller.getSnapshot().position).toBe(40);
    expect(player.seek).not.toHaveBeenCalled();
    expect(controller.restore.isHeld()).toBe(true);
  });

  it('an empty restored session is not held', () => {
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'idle', currentItem: null, position: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 } }) });
    expect(controller.restore.isHeld()).toBe(false);
  });
});

describe('persisted data is version-valid or discarded (RELY.7a)', () => {
  it('discards malformed and older persisted sessions safely', () => {
    localStorage.setItem(PERSIST_KEY, '{not json');
    expect(readPersistedSession()).toBe('malformed');
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 0, snapshot: persisted() }));
    expect(readPersistedSession()).toBe('schema-mismatch');
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 1, snapshot: { ...persisted(), queue: { items: 'nope' } } }));
    expect(readPersistedSession()).toBe('malformed');
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 1, snapshot: { ...persisted(), currentItem: { title: 'no id' } } }));
    expect(readPersistedSession()).toBe('malformed');
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 1, snapshot: persisted() }));
    expect(readPersistedSession().snapshot.sessionId).toBe('old');
  });

  it('review (e): a non-finite or negative spot is coerced to 0, not discarded', () => {
    for (const position of [null, 'abc', -5]) {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ schemaVersion: 1, snapshot: { ...persisted(), position } }));
      const read = readPersistedSession();
      expect(read).not.toBe('malformed');
      expect(read.snapshot.position).toBe(0);
      expect(read.snapshot.queue.items).toHaveLength(2);
    }
  });
});

describe('local playback problems (RELY.5a)', () => {
  it('a stall skip raises a problem naming the item and what plays instead, until playback recovers', () => {
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'paused' }) });
    controller.transport.play();
    controller.onPlayerStateChange('playing', 'plex:1');
    const seen = vi.fn();
    controller.problems.subscribe(seen);
    controller.onPlayerStalled({ stalledMs: 10_000 });
    expect(controller.problems.get()).toEqual(expect.objectContaining({
      kind: 'skipped', reason: 'stalled', item: expect.objectContaining({ contentId: 'plex:1', title: 'Arrival' }),
      replacement: expect.objectContaining({ contentId: 'plex:2', title: 'Nova' }),
    }));
    expect(seen).toHaveBeenCalled();
    controller.onPlayerStateChange('playing', 'plex:2');
    expect(controller.problems.get()).toBeNull();
  });

  it('a failure with nothing left reports failed with no replacement', () => {
    const one = persisted({ state: 'paused', queue: { items: [entry(1, 'Arrival')], currentIndex: 0, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 40, playbackRate: 1 } });
    const { controller } = makeController({ persistedSnapshot: one });
    controller.transport.play();
    controller.onPlayerError({ message: 'resilience exhausted', code: 'resilience-exhausted' });
    expect(controller.problems.get()).toEqual(expect.objectContaining({ kind: 'failed', replacement: null }));
    expect(mediaLog.playbackProblem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'failed', contentId: 'plex:1' }));
  });
});

describe('itemised Start fresh (RELY.8a)', () => {
  it('clears everything into a new session when nothing is kept', () => {
    const clearPersisted = vi.fn();
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'paused' }), clearPersisted });
    controller.lifecycle.reset({ keep: {} });
    const snap = controller.getSnapshot();
    expect(snap.sessionId).toBe('fresh-session');
    expect(snap.currentItem).toBeNull();
    expect(snap.queue.items).toEqual([]);
    expect(clearPersisted).toHaveBeenCalled();
  });

  it('keeps the queue but clears what is playing', () => {
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'paused' }) });
    controller.lifecycle.reset({ keep: { queue: true } });
    const snap = controller.getSnapshot();
    expect(snap.currentItem).toBeNull();
    expect(snap.queue.items.map(e => e.contentId)).toEqual(['plex:2']);
    expect(mediaLog.sessionStartFresh).toHaveBeenCalledWith(expect.objectContaining({ kept: ['queue'] }));
  });

  it('keeps what is playing and its spot but clears the rest of the queue', () => {
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'paused' }) });
    controller.lifecycle.reset({ keep: { playing: true, spot: true } });
    const snap = controller.getSnapshot();
    expect(snap.currentItem.contentId).toBe('plex:1');
    expect(snap.position).toBe(321);
    expect(snap.queue.items.map(e => e.contentId)).toEqual(['plex:1']);
  });

  it('keeps what is playing but starts it from the beginning when the spot is cleared', () => {
    const { controller } = makeController({ persistedSnapshot: persisted({ state: 'paused' }) });
    controller.lifecycle.reset({ keep: { playing: true, queue: true } });
    const snap = controller.getSnapshot();
    expect(snap.currentItem.contentId).toBe('plex:1');
    expect(snap.position).toBe(0);
    expect(snap.queue.items).toHaveLength(2);
  });
});
