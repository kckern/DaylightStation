/**
 * The Plex STRUCTURE cache — and, more importantly, what it must never cache.
 *
 * Measured on the live library 2026-08-25: resolving one piano course's
 * playables costs 1.0-1.5s with no warm-up benefit, and the school agenda pays
 * it once per learner, so a board of four waited on the slowest child. Caching
 * the course's SHAPE fixes that. Caching the child's PROGRESS would tell them
 * they still owe work they have finished — so the split is the whole design,
 * and these tests exist to keep it split.
 */
import { describe, it, expect, vi } from 'vitest';
import { FitnessPlayableService } from './FitnessPlayableService.mjs';

const configService = { getProgressClassification: () => ({}), getSuggestionPolicy: () => ({ slots: 8, lookbackDays: 10 }) };
const catalog = ({ resolvePlayables, getContainerInfo, getItem, enrichWithWatchState = async (items) => items, listConfiguredShows = async () => ({ shows: [] }) }) => ({
  canonicalize: (id) => ({ contentId: `plex:${String(id).replace(/^(?:plex:)+/, '')}`, localId: String(id).replace(/^(?:plex:)+/, ''), source: 'plex' }),
  resolvePlayables,
  getContainerInfo,
  getItem,
  enrichWatchState: enrichWithWatchState,
  listConfiguredShows,
  describeFrom: (item, info) => ({ title: item?.title ?? null, labels: info?.labels ?? [] }),
});

function makeService({ now = () => 0, structureTtlMs = 1000, structureSnapshot = null } = {}) {
  const resolvePlayables = vi.fn(async () => [{ id: 'plex:1', title: 'Lesson 1' }]);
  const getContainerInfo = vi.fn(async () => ({ type: 'show', labels: ['Piano'] }));
  const getItem = vi.fn(async () => ({ id: 'plex:675689', title: 'Hoffman' }));
  const enrichWithWatchState = vi.fn(async (items) => items.map((i) => ({ ...i, watched: true })));
  const listConfiguredShows = vi.fn(async () => ({ shows: [{ id: '1' }] }));
  const service = new FitnessPlayableService({
    fitnessConfigService: configService,
    contentCatalog: catalog({ resolvePlayables, getContainerInfo, getItem, enrichWithWatchState, listConfiguredShows }),
    createProgressClassifier: () => ({ classify: () => 'unwatched' }),
    logger: { warn() {}, debug() {}, info() {} },
    structureTtlMs,
    structureSnapshot,
    now,
  });
  return { service, resolvePlayables, getContainerInfo, getItem, enrichWithWatchState, listConfiguredShows };
}

describe('FitnessPlayableService structure cache', () => {
  it('seeds course structure from a durable snapshot so a post-deploy School read never waits on Plex', async () => {
    const structureSnapshot = {
      load: () => new Map([
        ['playables:plex:675689', { value: [{ id: 'plex:1', title: 'Snapshotted lesson' }], at: 900 }],
        ['info:plex:675689', { value: { type: 'show', labels: ['Piano'] }, at: 900 }],
        ['item:plex:675689', { value: { id: 'plex:675689', title: 'Snapshotted Hoffman' }, at: 900 }],
      ]),
      put: vi.fn(),
    };
    const { service, resolvePlayables, getContainerInfo, getItem } = makeService({
      now: () => 1000, structureSnapshot,
    });

    const result = await Promise.race([
      service.getPlayableEpisodes('675689', 'h'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('blocked on Plex refresh')), 25)),
    ]);

    expect(result.items[0].title).toBe('Snapshotted lesson');
    expect(result.info.labels).toEqual(['Piano']);
    expect(result.containerItem.title).toBe('Snapshotted Hoffman');
    expect(resolvePlayables).not.toHaveBeenCalled();
    expect(getContainerInfo).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('fetches the Plex episode list once for repeat reads inside the TTL', async () => {
    const { service, resolvePlayables } = makeService();
    await service.getPlayableEpisodes('675689', 'h');
    await service.getPlayableEpisodes('plex:675689', 'h');
    await service.getPlayableEpisodes('675689', 'h');
    expect(resolvePlayables).toHaveBeenCalledTimes(1);
  });

  // THE ONE THAT MATTERS. Watch state decides whether a child still owes work
  // today; it must be read on every single call, cache or no cache.
  it('never caches watch state — every read re-enriches', async () => {
    const { service, resolvePlayables, enrichWithWatchState } = makeService();
    await service.getPlayableEpisodes('675689', 'h');
    await service.getPlayableEpisodes('675689', 'h');
    await service.getPlayableEpisodes('675689', 'h');
    expect(resolvePlayables).toHaveBeenCalledTimes(1);
    expect(enrichWithWatchState).toHaveBeenCalledTimes(3);
  });

  it('re-fetches once the TTL has passed', async () => {
    let clock = 0;
    const { service, resolvePlayables } = makeService({ now: () => clock, structureTtlMs: 1000 });
    await service.getPlayableEpisodes('675689', 'h');
    clock = 1500;
    await service.getPlayableEpisodes('675689', 'h');
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
  });

  it('serves expired structure immediately while Plex refreshes in the background', async () => {
    let clock = 0;
    let releaseRefresh;
    const { service, resolvePlayables } = makeService({ now: () => clock, structureTtlMs: 1000 });
    await service.getPlayableEpisodes('675689', 'h');
    resolvePlayables.mockImplementationOnce(() => new Promise((resolve) => { releaseRefresh = resolve; }));
    clock = 1500;

    const result = await Promise.race([
      service.getPlayableEpisodes('675689', 'h'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('blocked on Plex refresh')), 25)),
    ]);

    expect(result.items[0].title).toBe('Lesson 1');
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
    releaseRefresh([{ id: 'plex:2', title: 'Fresh lesson' }]);
  });

  it('describeItem reuses the cached item/info reads', async () => {
    const { service, getContainerInfo, getItem } = makeService();
    await service.getPlayableEpisodes('675689', 'h');
    const described = await service.describeItem('plex:675689');
    expect(described).toEqual({ title: 'Hoffman', labels: ['Piano'] });
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getContainerInfo).toHaveBeenCalledTimes(1);
  });

  it('caches the library show list', async () => {
    const { service, listConfiguredShows } = makeService();
    await service.listFitnessShows();
    await service.listFitnessShows();
    expect(listConfiguredShows).toHaveBeenCalledTimes(1);
  });

  // Plex serialises concurrent requests, so four learners resolving the same
  // course at once must collapse into one fetch, not queue four.
  it('shares an in-flight fetch rather than starting a second one', async () => {
    const { service, resolvePlayables } = makeService();
    await Promise.all([
      service.getPlayableEpisodes('675689', 'h'),
      service.getPlayableEpisodes('675689', 'h'),
      service.getPlayableEpisodes('675689', 'h'),
      service.getPlayableEpisodes('675689', 'h'),
    ]);
    expect(resolvePlayables).toHaveBeenCalledTimes(1);
  });

  // A caller writes `info.labels = ...` directly. If that reached the cached
  // object, one request's edit would become every later request's input.
  it('hands out copies, so a caller mutating the result cannot poison the cache', async () => {
    const { service } = makeService();
    const first = await service.getPlayableEpisodes('675689', 'h');
    expect(first.info).toBeTruthy();
    first.info.labels = ['MUTATED'];
    first.items[0].title = 'MUTATED';
    const second = await service.getPlayableEpisodes('675689', 'h');
    expect(second.info.labels).toEqual(['Piano']);
    expect(second.items[0].title).not.toBe('MUTATED');
  });

  it('does not remember a failed fetch', async () => {
    const resolvePlayables = vi.fn()
      .mockRejectedValueOnce(new Error('plex down'))
      .mockResolvedValue([{ id: 'plex:1', title: 'Lesson 1' }]);
    const service = new FitnessPlayableService({
      fitnessConfigService: configService,
      contentCatalog: catalog({ resolvePlayables, getContainerInfo: async () => null, getItem: async () => null }),
      createProgressClassifier: () => ({ classify: () => 'unwatched' }),
      logger: { warn() {}, debug() {}, info() {} },
    });
    await expect(service.getPlayableEpisodes('675689', 'h')).rejects.toThrow('plex down');
    await expect(service.getPlayableEpisodes('675689', 'h')).resolves.toBeTruthy();
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
  });

  it('can be invalidated when content actually changes', async () => {
    const { service, resolvePlayables } = makeService();
    await service.getPlayableEpisodes('675689', 'h');
    service.invalidateStructure('675689');
    await service.getPlayableEpisodes('675689', 'h');
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
  });
});
