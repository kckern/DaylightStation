// RELY.5a ruling — a refused file on this device: a waiting sign after 3 s,
// cleared when the file comes back; skipped "file unavailable" at the 60 s
// owner limit; and a storm guard that holds instead of skipping through a
// library outage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'video', title, duration: 600, priority: 'queue', addedAt: '' });
function controller(ids = [[1, 'Arrival'], [2, 'Nova'], [3, 'Dune']]) {
  const c = createLocalSessionController({
    clientId: 'c1',
    persistedSnapshot: {
      sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'video', title: 'Arrival', duration: 600 }, position: 0,
      queue: { items: ids.map(([id, t]) => entry(id, t)), currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  });
  c.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
  c.transport.play();
  return c;
}

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

describe('local source wait', () => {
  it('raises a waiting problem only after 3 s of waiting, and clears it when the wait ends', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(2_900);
    expect(c.problems.get()).toBeNull();
    vi.advanceTimersByTime(200);
    expect(c.problems.get()).toEqual(expect.objectContaining({ kind: 'waiting', reason: 'source-unavailable', item: expect.objectContaining({ title: 'Arrival' }) }));
    c.onPlayerSourceWait({ waiting: false, decision: 'resume', contentId: 'plex:1' });
    expect(c.problems.get()).toBeNull();
    expect(mediaLog.playbackRecovered).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-restored' }));
  });

  it('a short wait that ends inside 3 s raises nothing', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(1_000);
    c.onPlayerSourceWait({ waiting: false, decision: 'resume', contentId: 'plex:1' });
    vi.advanceTimersByTime(5_000);
    expect(c.problems.get()).toBeNull();
  });

  it('gives up on an unavailable file by skipping it with what plays instead', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(60_000);
    c.onPlayerError({ message: 'Playback gave up (source-unavailable-gave-up)', code: 'source-unavailable-gave-up' });
    expect(c.problems.get()).toEqual(expect.objectContaining({ kind: 'skipped', reason: 'file-unavailable', replacement: expect.objectContaining({ title: 'Nova' }) }));
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:2');
  });

  it('storm guard: when the next item also waits within 60 s, it holds with one library-unavailable problem instead of skipping on', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(60_000);
    c.onPlayerError({ code: 'source-unavailable-gave-up' });
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:2');
    vi.advanceTimersByTime(5_000);
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:2' });
    expect(c.problems.get()).toEqual(expect.objectContaining({ kind: 'library-unavailable' }));
    vi.advanceTimersByTime(60_000);
    c.onPlayerError({ code: 'source-unavailable-gave-up' });
    c.onPlayerEnded('plex:2');
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:2');
    expect(c.problems.get()).toEqual(expect.objectContaining({ kind: 'library-unavailable' }));
    expect(mediaLog.playbackProblem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'library-unavailable' }));
  });

  it('a wait more than 60 s after the last unavailable skip is an ordinary wait again', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(60_000);
    c.onPlayerError({ code: 'source-unavailable-gave-up' });
    vi.advanceTimersByTime(61_000);
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:2' });
    vi.advanceTimersByTime(3_100);
    expect(c.problems.get()).toEqual(expect.objectContaining({ kind: 'waiting' }));
  });

  it('Skip now moves on from a waiting item', () => {
    const c = controller();
    c.onPlayerSourceWait({ waiting: true, since: Date.now(), contentId: 'plex:1' });
    vi.advanceTimersByTime(3_100);
    c.transport.skipNext();
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:2');
    expect(c.problems.get()).toBeNull();
  });
});
