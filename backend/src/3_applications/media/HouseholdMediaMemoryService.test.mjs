/**
 * Household media memory — acceptance criteria of FIND.9a, FIND.10a,
 * FIND.12a/b, FIND.13a and PLAY.4a as service-level tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { HouseholdMediaMemoryService } from './HouseholdMediaMemoryService.mjs';

const P = (contentId, over = {}) => ({ namespaceId: 'plex/8_tv-shows', progress: { contentId, playhead: 0, duration: 0, lastPlayed: null, ...over } });

const EPISODES = {
  // season 1 of show 100: 11, 12 ; season 2: 21
  'plex:11': { id: 'plex:11', title: 'S1E1', type: 'episode', thumbnail: '/t/11', metadata: { type: 'episode', parentId: '10', grandparentId: '100', parentTitle: 'Season 1', grandparentTitle: 'Bluey' } },
  'plex:12': { id: 'plex:12', title: 'S1E2', type: 'episode', thumbnail: '/t/12', metadata: { type: 'episode', parentId: '10', grandparentId: '100', parentTitle: 'Season 1', grandparentTitle: 'Bluey' } },
  'plex:21': { id: 'plex:21', title: 'S2E1', type: 'episode', thumbnail: '/t/21', metadata: { type: 'episode', parentId: '20', grandparentId: '100', parentTitle: 'Season 2', grandparentTitle: 'Bluey' } },
  'plex:film': { id: 'plex:film', title: 'Film', type: 'movie', thumbnail: '/t/film', metadata: { type: 'movie' } },
  'plex:doc': { id: 'plex:doc', title: 'Doc', type: 'movie', thumbnail: '/t/doc', metadata: { type: 'movie' } },
};
const LISTS = {
  10: [EPISODES['plex:11'], EPISODES['plex:12']],
  20: [EPISODES['plex:21']],
  100: [{ id: 'plex:10', title: 'Season 1' }, { id: 'plex:20', title: 'Season 2' }],
};

function catalog() {
  return {
    resolveSource: vi.fn((source, id) => ({ source, localId: String(id).replace(/^\w+:/, '') })),
    getItem: vi.fn(async (_r, id) => EPISODES[id] || null),
    getList: vi.fn(async (_r, ref) => LISTS[ref] || []),
  };
}

function listsStore() {
  const favs = new Map();
  const removed = new Map();
  return {
    loadFavourites: vi.fn(async (hid = 'default') => favs.get(hid) || []),
    saveFavourites: vi.fn(async (list, hid = 'default') => { favs.set(hid, list); }),
    loadRemoved: vi.fn(async (hid = 'default') => removed.get(hid) || {}),
    saveRemoved: vi.fn(async (map, hid = 'default') => { removed.set(hid, map); }),
  };
}

function build({ records = [], nowPlaying = [], nowPlayingAvailable = true } = {}) {
  let tick = 0;
  const deps = {
    progressMemory: { listAllProgress: vi.fn(async () => records) },
    listsStore: listsStore(),
    contentCatalog: catalog(),
    markContentWatched: { execute: vi.fn(async ({ contentId, watched }) => ({ contentId, watched })) },
    nowPlaying: nowPlayingAvailable ? { list: vi.fn(async () => nowPlaying) } : null,
    nowTimestamp: () => `2026-10-02 23:00:${String(tick++).padStart(2, '0')}`,
    clock: { now: () => 0 },
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { service: new HouseholdMediaMemoryService(deps), deps };
}

const tvSpot = { 'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' } };
const kidSpot = { 'browser:kid': { playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00' } };

describe('recent (FIND.9a)', () => {
  it('lists items from every screen, newest first, each with where it played and display fields', async () => {
    const { service } = build({ records: [
      P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00', lastDevice: 'fleet:livingroom-tv', spots: tvSpot }),
      P('plex:doc', { playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00', lastDevice: 'browser:kid', spots: kidSpot }),
    ] });
    const { items } = await service.recent({ limit: 10 });
    expect(items.map((i) => i.contentId)).toEqual(['plex:doc', 'plex:film']);
    expect(items[1]).toMatchObject({
      title: 'Film', thumbnail: '/t/film', type: 'movie',
      playedOn: { deviceId: 'fleet:livingroom-tv', kind: 'screen', screenId: 'livingroom-tv' },
    });
  });
});

describe('carry on (FIND.10a, PLAY.4a)', () => {
  it('shows where each screen stopped; both spots when they differ', async () => {
    const { service } = build({ records: [
      P('plex:film', { playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00', lastDevice: 'browser:kid', spots: { ...tvSpot, ...kidSpot } }),
    ] });
    const { items } = await service.carryOn({});
    expect(items).toHaveLength(1);
    expect(items[0].spots.map((s) => [s.deviceId, s.playhead])).toEqual([['browser:kid', 720], ['fleet:livingroom-tv', 4800]]);
    expect(items[0].title).toBe('Film');
  });

  it('offers the next episode of a series, across a season boundary', async () => {
    const { service } = build({ records: [
      P('plex:11', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-01 18:00:00', completedAt: '2026-10-01 18:00:00' }),
      P('plex:12', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-02 18:00:00', completedAt: '2026-10-02 18:00:00' }),
    ] });
    const { items } = await service.carryOn({});
    expect(items).toEqual([expect.objectContaining({ contentId: 'plex:21', reason: 'next-episode', after: 'plex:12', title: 'S2E1', grandparentTitle: 'Bluey' })]);
  });

  it('does not offer a next episode that was already watched', async () => {
    const { service } = build({ records: [
      P('plex:11', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-02 18:00:00', completedAt: 'x' }),
      P('plex:12', { playhead: 1400, duration: 1400, lastPlayed: '2026-09-01 18:00:00', completedAt: 'x' }),
    ] });
    const { items } = await service.carryOn({});
    expect(items.map((i) => i.contentId)).not.toContain('plex:12');
  });

  it('anything playing on a screen right now is shown as "now on" instead', async () => {
    const { service } = build({
      records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00', lastDevice: 'fleet:livingroom-tv', spots: tvSpot })],
      nowPlaying: [{ deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', contentId: 'plex:film', state: 'playing', position: 4900 }],
    });
    const result = await service.carryOn({});
    expect(result.items).toEqual([]);
    expect(result.nowOn).toEqual([expect.objectContaining({ contentId: 'plex:film', screenId: 'livingroom-tv', title: 'Film' })]);
    expect(result.nowPlayingKnown).toBe(true);
  });

  it('says so when it cannot know what is playing', async () => {
    const { service } = build({ records: [], nowPlayingAvailable: false });
    expect((await service.carryOn({})).nowPlayingKnown).toBe(false);
  });

  it('marking watched/unwatched delegates to the shared completion writer', async () => {
    const { service, deps } = build();
    await service.markWatched('plex:film', true);
    expect(deps.markContentWatched.execute).toHaveBeenCalledWith({ contentId: 'plex:film', watched: true });
  });
});

describe('favourites (FIND.12a/b)', () => {
  it('adds an item or a collection in one step, shared by the household, anyone can remove', async () => {
    const { service } = build();
    await service.addFavourite(undefined, { id: 'plex:film' });
    await service.addFavourite(undefined, { id: 'plex:100', kind: 'collection', title: 'Bluey', thumbnail: '/t/show' });
    let { items } = await service.listFavourites();
    expect(items.map((f) => [f.id, f.kind])).toEqual([['plex:100', 'collection'], ['plex:film', 'item']]);
    // a favourite added without display fields gets them from the catalog (big pictures)
    expect(items[1]).toMatchObject({ title: 'Film', thumbnail: '/t/film' });
    await service.removeFavourite(undefined, 'plex:100');
    ({ items } = await service.listFavourites());
    expect(items.map((f) => f.id)).toEqual(['plex:film']);
  });
});

describe('remove from the household list (FIND.13a)', () => {
  const records = [
    P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00', lastDevice: 'fleet:livingroom-tv', spots: tvSpot }),
  ];
  it('removes from recent and carry on in one step; restore (undo) brings it back', async () => {
    const { service } = build({ records });
    await service.removeFromList(undefined, 'plex:film');
    expect((await service.recent({})).items).toEqual([]);
    expect((await service.carryOn({})).items).toEqual([]);
    expect((await service.listRemoved()).items.map((r) => r.id)).toEqual(['plex:film']);
    await service.restoreToList(undefined, 'plex:film');
    expect((await service.recent({})).items.map((i) => i.contentId)).toEqual(['plex:film']);
  });
});

describe('slow catalog', () => {
  it('a lookup past its deadline degrades the entry to its id instead of failing the list', async () => {
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    const service = new HouseholdMediaMemoryService({
      ...deps,
      runtime: { withDeadline: vi.fn(() => Promise.reject(new Error('catalog lookup timeout'))) },
    });
    const { items } = await service.recent({});
    expect(items).toEqual([expect.objectContaining({ contentId: 'plex:film', title: null })]);
  });
});

describe('play ledger (per-screen start history)', () => {
  it('recent carries each item\'s starts; plays() queries by screen', async () => {
    const rows = [
      { startedAt: '2026-10-02T15:00:00.000Z', localTime: '2026-10-02 08:00:00', deviceId: 'fleet:livingroom-tv', contentId: 'plex:film', origin: null },
    ];
    const playLedger = { plays: vi.fn(async ({ deviceId }) => rows.filter((r) => !deviceId || r.deviceId === deviceId)) };
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-02 09:00:00' })] });
    const service = new HouseholdMediaMemoryService({ ...deps, playLedger });
    const { items } = await service.recent({});
    expect(items[0].playedOn).toEqual({ deviceId: 'fleet:livingroom-tv', kind: 'screen', screenId: 'livingroom-tv' });
    expect(items[0].plays).toHaveLength(1);
    expect((await service.plays({ deviceId: 'browser:x' }))).toEqual({ items: [], ledger: true });
    expect((await service.plays({ deviceId: 'fleet:livingroom-tv' })).items).toHaveLength(1);
  });
  it('without a ledger, plays() says so', async () => {
    const { service } = build();
    expect(await service.plays({})).toEqual({ items: [], ledger: false });
  });
});
