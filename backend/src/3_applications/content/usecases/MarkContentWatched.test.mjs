/**
 * Mark watched / unwatched (RQ-FIND-13).
 *
 * Writes the same completion state play/log writes (percent >= 90 and
 * completedAt) so every existing reader — Plex next-episode selection,
 * fitness, school, Player resume — sees the mark, and closes every screen's
 * spot so the item leaves carry-on.
 */
import { describe, it, expect, vi } from 'vitest';
import { MarkContentWatched } from './MarkContentWatched.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

function memory(records = []) {
  const store = new Map(records.map(({ namespaceId, progress }) => [`${namespaceId}|${progress.contentId}`, progress]));
  return {
    store,
    findProgress: vi.fn(async (id, ns) => store.get(`${ns}|${id}`) || null),
    saveProgress: vi.fn(async (state, ns) => { store.set(`${ns}|${state.contentId}`, state); }),
    listAllProgress: vi.fn(async () => [...store.entries()].map(([key, progress]) => ({ namespaceId: key.split('|')[0], progress }))),
  };
}

const catalog = (over = {}) => ({
  resolveSource: vi.fn(() => ({ source: 'plex', localId: '1' })),
  progressNamespace: vi.fn(async () => 'plex/6_movies'),
  getItem: vi.fn(async () => ({ id: 'plex:1', title: 'Film', metadata: { duration: 7_200_000 } })),
  ...over,
});

const build = (deps) => new MarkContentWatched({
  contentCatalog: catalog(),
  nowTimestamp: () => '2026-10-02 12:00:00',
  logger: { info: vi.fn(), warn: vi.fn() },
  ...deps,
});

const spots = {
  'fleet:livingroom-tv': { playhead: 4800, duration: 7200, percent: 67, lastPlayed: '2026-10-01 21:00:00' },
};

describe('MarkContentWatched', () => {
  it('watched: full playhead, completedAt stamped, spots closed, lastPlayed kept', async () => {
    const mem = memory([{ namespaceId: 'plex/6_movies', progress: new MediaProgress({
      contentId: 'plex:1', playhead: 4800, duration: 7200, playCount: 2, lastPlayed: '2026-10-01 21:00:00', spots, lastDevice: 'fleet:livingroom-tv',
    }) }]);
    const result = await build({ mediaProgressMemory: mem }).execute({ contentId: 'plex:1', watched: true });
    const state = mem.store.get('plex/6_movies|plex:1');
    expect(state.playhead).toBe(7200);
    expect(state.percent).toBe(100);
    expect(state.isWatched()).toBe(true);
    expect(state.completedAt).toBe('2026-10-02 12:00:00');
    expect(state.spots).toEqual({});
    expect(state.lastDevice).toBe('fleet:livingroom-tv');
    expect(state.lastPlayed).toBe('2026-10-01 21:00:00');
    expect(state.playCount).toBe(2);
    expect(result).toMatchObject({ contentId: 'plex:1', watched: true, namespaces: ['plex/6_movies'] });
  });

  it('watched keeps an earlier completedAt (first completion is never rewritten)', async () => {
    const mem = memory([{ namespaceId: 'plex/6_movies', progress: new MediaProgress({
      contentId: 'plex:1', playhead: 10, duration: 7200, completedAt: '2025-01-01 00:00:00',
    }) }]);
    await build({ mediaProgressMemory: mem }).execute({ contentId: 'plex:1', watched: true });
    expect(mem.store.get('plex/6_movies|plex:1').completedAt).toBe('2025-01-01 00:00:00');
  });

  it('unwatched: playhead 0, completion cleared, spots closed', async () => {
    const mem = memory([{ namespaceId: 'plex/6_movies', progress: new MediaProgress({
      contentId: 'plex:1', playhead: 7100, duration: 7200, completedAt: '2026-10-01 22:00:00', spots,
    }) }]);
    await build({ mediaProgressMemory: mem }).execute({ contentId: 'plex:1', watched: false });
    const state = mem.store.get('plex/6_movies|plex:1');
    expect(state.playhead).toBe(0);
    expect(state.isWatched()).toBe(false);
    expect(state.isInProgress()).toBe(false);
    expect(state.completedAt).toBeNull();
    expect(state.spots).toEqual({});
  });

  it('updates every namespace that holds the item (e.g. a watchlist copy)', async () => {
    const mem = memory([
      { namespaceId: 'plex/6_movies', progress: new MediaProgress({ contentId: 'plex:1', playhead: 100, duration: 7200 }) },
      { namespaceId: 'kidsscriptures2026', progress: new MediaProgress({ contentId: 'plex:1', playhead: 200, duration: 7200 }) },
    ]);
    const result = await build({ mediaProgressMemory: mem }).execute({ contentId: 'plex:1', watched: true });
    expect(result.namespaces.sort()).toEqual(['kidsscriptures2026', 'plex/6_movies']);
    expect(mem.store.get('kidsscriptures2026|plex:1').percent).toBe(100);
  });

  it('an item never played is written to its source namespace using the catalog duration', async () => {
    const mem = memory();
    await build({ mediaProgressMemory: mem }).execute({ contentId: 'plex:1', watched: true });
    const state = mem.store.get('plex/6_movies|plex:1');
    expect(state.duration).toBe(7200);
    expect(state.playhead).toBe(7200);
    expect(state.lastPlayed).toBeNull();
  });

  it('with no known duration, watched still reads as watched (stored percent 100)', async () => {
    const mem = memory();
    const mark = build({ mediaProgressMemory: mem, contentCatalog: catalog({ getItem: vi.fn(async () => null) }) });
    await mark.execute({ contentId: 'plex:1', watched: true });
    const state = mem.store.get('plex/6_movies|plex:1');
    expect(state.isWatched()).toBe(true);
  });

  it('pushes the mark to a remote-synced source', async () => {
    const mem = memory();
    const progressSyncService = { pushMarkedState: vi.fn().mockResolvedValue() };
    const mark = build({
      mediaProgressMemory: mem,
      progressSyncSources: new Set(['abs']),
      progressSyncService,
      contentCatalog: catalog({ resolveSource: vi.fn(() => ({ source: 'abs', localId: 'b1' })), progressNamespace: vi.fn(async () => 'abs'), getItem: vi.fn(async () => ({ metadata: { duration: 3600 } })) }),
    });
    await mark.execute({ contentId: 'abs:b1', watched: true });
    expect(progressSyncService.pushMarkedState).toHaveBeenCalledWith('abs:b1', 'b1', { currentTime: expect.any(Number), isFinished: true });
  });

  it('rejects an id without a source', async () => {
    await expect(build({ mediaProgressMemory: memory() }).execute({ contentId: '12345', watched: true })).rejects.toThrow(/source/);
  });
});
