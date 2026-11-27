import { describe, it, expect, vi } from 'vitest';
import { ContentQueryService } from './ContentQueryService.mjs';

// Unwatched counts on show and season tiles and rows (2026-11-27): the
// household's own progress, not Plex's view counts.
function setup({ leaves, progress }) {
  const contentCatalog = {
    search: vi.fn(),
    hasSource: () => true,
    resolveSource: (source, localId) => ({ source, localId }),
    progressNamespace: async () => 'plex/tv',
    resolvePlayables: vi.fn(async (_r, localId) => leaves[localId] ?? []),
  };
  const mediaProgressMemory = { listProgress: vi.fn(async () => progress) };
  let now = 1_000;
  const svc = new ContentQueryService({ contentCatalog, mediaProgressMemory, logger: { debug() {}, info() {}, warn() {} }, clock: () => now });
  return { svc, contentCatalog, advance: (ms) => { now += ms; } };
}

describe('ContentQueryService.unwatchedCounts', () => {
  const leaves = {
    '10': [{ id: 'plex:1', duration: 600 }, { id: 'plex:2', duration: 600 }, { id: 'plex:3', duration: 600 }],
    '20': [{ id: 'plex:4', duration: 600 }],
  };
  const progress = [
    { contentId: 'plex:1', playhead: 590, duration: 600, percent: 98 },
    { contentId: 'plex:2', playhead: 60, duration: 600, percent: 10 },
    { contentId: 'plex:4', playhead: 600, duration: 600, percent: 100 },
  ];

  it('counts the leaves under each container the household has not finished', async () => {
    const { svc } = setup({ leaves, progress });
    expect(await svc.unwatchedCounts(['plex:10', 'plex:20'])).toEqual({
      'plex:10': { unwatched: 2, total: 3 },
      'plex:20': { unwatched: 0, total: 1 },
    });
  });

  it('caches each container for a minute and skips ids it cannot read', async () => {
    const { svc, contentCatalog, advance } = setup({ leaves, progress });
    contentCatalog.resolvePlayables.mockImplementationOnce(async () => { throw new Error('plex down'); });
    expect(await svc.unwatchedCounts(['plex:10'])).toEqual({});
    await svc.unwatchedCounts(['plex:10']);
    await svc.unwatchedCounts(['plex:10']);
    expect(contentCatalog.resolvePlayables).toHaveBeenCalledTimes(2);
    advance(61_000);
    await svc.unwatchedCounts(['plex:10']);
    expect(contentCatalog.resolvePlayables).toHaveBeenCalledTimes(3);
  });

  it('answers at most 40 ids and ignores malformed ones', async () => {
    const { svc, contentCatalog } = setup({ leaves, progress });
    const ids = Array.from({ length: 60 }, (_, i) => `plex:${i + 100}`);
    await svc.unwatchedCounts([...ids, 'nonsense', '']);
    expect(contentCatalog.resolvePlayables).toHaveBeenCalledTimes(40);
  });
});
