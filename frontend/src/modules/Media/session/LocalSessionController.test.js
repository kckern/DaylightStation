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
      meta: { ownerId: 'c1', updatedAt: '' },
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
  it('pause updates state; play/pause/seek reach the player handle', () => {
    const c = makeController();
    const handle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    c.setPlayerHandle(handle);
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    c.transport.pause();
    expect(c.getSnapshot().state).toBe('paused');
    expect(handle.pause).toHaveBeenCalled();
    c.transport.play();
    expect(handle.play).toHaveBeenCalled();
    c.transport.seekAbs(30);
    expect(handle.seek).toHaveBeenCalledWith(30);
  });

  it('stop resets to idle and clears the current item', () => {
    const c = makeController();
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    c.transport.stop();
    expect(c.getSnapshot().state).toBe('idle');
    expect(c.getSnapshot().currentItem).toBeNull();
  });

  it('seekAbs writes both tiers; seekRel resolves from the hot tier', () => {
    const c = makeController();
    c.transport.seekAbs(60);
    expect(c.getSnapshot().position).toBe(60);
    expect(c.position.get().seconds).toBe(60);
    c.transport.seekRel(-15);
    expect(c.getSnapshot().position).toBe(45);
  });
});

describe('LocalSessionController — queue ops', () => {
  it('queue.add appends; first add sets currentItem and loads', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video', title: 'A' });
    expect(c.getSnapshot().queue.items).toHaveLength(1);
    expect(c.getSnapshot().queue.currentIndex).toBe(0);
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
    expect(c.getSnapshot().state).toBe('loading');
  });

  it('queue.playNow replaces-and-loads', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'a', format: 'video' }, { clearRest: true });
    expect(c.getSnapshot().state).toBe('loading');
    expect(c.getSnapshot().currentItem?.contentId).toBe('a');
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
      meta: { ownerId: 'c1', updatedAt: '' },
    };
    c.lifecycle.adoptSnapshot(adopted, { autoplay: false });
    expect(c.getSnapshot().sessionId).toBe('adopted');
    expect(c.getSnapshot().currentItem?.contentId).toBe('z');
    expect(c.position.get().seconds).toBe(9);
  });
});

describe('LocalSessionController — player events', () => {
  it('onPlayerEnded auto-advances sequentially', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
    c.onPlayerEnded();
    expect(c.getSnapshot().currentItem?.contentId).toBe('b');
    expect(c.getSnapshot().queue.currentIndex).toBe(1);
  });

  it('onPlayerEnded at queue end with repeat=off goes to ended', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.onPlayerEnded();
    expect(c.getSnapshot().state).toBe('ended');
  });

  it('onPlayerError logs and auto-advances', () => {
    const c = makeController();
    c.queue.add({ contentId: 'a', format: 'video' });
    c.queue.add({ contentId: 'b', format: 'video' });
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
  it('seekable is false for live content', () => {
    const c = makeController();
    expect(c.capabilities.seekable).toBe(true);
    c.store.dispatch({ type: 'LOAD_ITEM', item: { contentId: 'cam:1', format: 'video', isLive: true } });
    expect(c.capabilities.seekable).toBe(false);
  });
});

describe('LocalSessionController — portability', () => {
  it('snapshotForHandoff carries the hot-tier position', () => {
    const c = makeController();
    c.queue.playNow({ contentId: 'a', format: 'video' });
    c.onPlayerProgress(10); // durable at 10
    c.onPlayerPositionTick(14.2); // hot tier ahead
    const snap = c.portability.snapshotForHandoff();
    expect(snap.position).toBe(14.2);
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
    c.queue.add({ contentId: 'now', format: 'video' }); // becomes current
    c.queue.add({ contentId: 'later', format: 'video' });
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

  it('add on a container into an empty queue appends all children and loads the first', async () => {
    const fetchImpl = okFetch();
    const c = makeController({ fetchImpl });
    c.queue.add(albumInput);
    await vi.waitFor(() => expect(c.getSnapshot().queue.items).toHaveLength(3));
    const snap = c.getSnapshot();
    expect(snap.queue.currentIndex).toBe(0);
    expect(snap.currentItem?.contentId).toBe('plex:1');
  });
});
