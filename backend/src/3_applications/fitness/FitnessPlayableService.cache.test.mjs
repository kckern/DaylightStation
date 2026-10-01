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

function makeService({ now = () => 0, structureTtlMs = 1000 } = {}) {
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
    now,
  });
  return { service, resolvePlayables, getContainerInfo, getItem, enrichWithWatchState, listConfiguredShows };
}

describe('FitnessPlayableService structure cache', () => {
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

  // Past the TTL the caller gets the stale structure at once and ONE
  // background fetch renews it. The Fitness home polls on the same 5-minute
  // period as the TTL, so blocking on expiry made nearly every poll cold.
  it('past the TTL serves stale structure immediately and renews it in the background', async () => {
    let clock = 0;
    const { service, resolvePlayables } = makeService({ now: () => clock, structureTtlMs: 1000 });
    await service.getPlayableEpisodes('675689', 'h');
    resolvePlayables.mockImplementation(async () => [{ id: 'plex:1', title: 'Lesson 1' }, { id: 'plex:2', title: 'Lesson 2' }]);
    clock = 1500;
    const stale = await service.getPlayableEpisodes('675689', 'h');
    expect(stale.items).toHaveLength(1);
    // A second stale read while the renewal is in flight does not start another.
    await service.getPlayableEpisodes('675689', 'h');
    await new Promise((r) => setTimeout(r, 0));
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
    const renewed = await service.getPlayableEpisodes('675689', 'h');
    expect(renewed.items).toHaveLength(2);
    expect(resolvePlayables).toHaveBeenCalledTimes(2);
  });

  it('waits for a fresh fetch once an entry is older than the stale ceiling', async () => {
    let clock = 0;
    const resolvePlayables = vi.fn(async () => [{ id: 'plex:1', title: `at ${clock}` }]);
    const service = new FitnessPlayableService({
      fitnessConfigService: configService,
      contentCatalog: catalog({ resolvePlayables, getContainerInfo: async () => null, getItem: async () => null }),
      createProgressClassifier: () => ({ classify: () => 'unwatched' }),
      logger: { warn() {}, debug() {}, info() {} },
      structureTtlMs: 1000, structureMaxStaleMs: 5000, now: () => clock,
    });
    await service.getPlayableEpisodes('675689', 'h');
    clock = 10_000;
    const result = await service.getPlayableEpisodes('675689', 'h');
    expect(result.items[0].title).toBe('at 10000');
  });

  it('keeps serving stale structure when a background renewal fails', async () => {
    let clock = 0;
    const { service, resolvePlayables } = makeService({ now: () => clock, structureTtlMs: 1000 });
    await service.getPlayableEpisodes('675689', 'h');
    resolvePlayables.mockRejectedValueOnce(new Error('plex down'));
    clock = 1500;
    await service.getPlayableEpisodes('675689', 'h');
    await new Promise((r) => setTimeout(r, 0));
    const after = await service.getPlayableEpisodes('675689', 'h');
    expect(after.items[0].title).toBe('Lesson 1');
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
