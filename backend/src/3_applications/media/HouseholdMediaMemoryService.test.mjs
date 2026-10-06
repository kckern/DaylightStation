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

describe('carry on ordering and songs', () => {
  it('a recent next episode is not crowded out by older unfinished items', async () => {
    const records = [
      P('plex:12', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-02 18:00:00', completedAt: 'x' }),
      P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-09-01 21:00:00' }),
      P('plex:doc', { playhead: 4800, duration: 7200, lastPlayed: '2026-09-02 21:00:00' }),
    ];
    const { service } = build({ records });
    const { items } = await service.carryOn({ limit: 2 });
    expect(items.map((i) => [i.contentId, i.reason])).toEqual([['plex:21', 'next-episode'], ['plex:doc', 'unfinished']]);
    expect(items[0].afterPlayedAt).toBe('2026-10-02 18:00:00');
  });
  it('songs (type track) are never "carry on"', async () => {
    const { deps } = build({ records: [P('plex:song', { playhead: 120, duration: 240, lastPlayed: '2026-10-02 18:00:00' })] });
    deps.contentCatalog.getItem = vi.fn(async () => ({ id: 'plex:song', title: 'Song', metadata: { type: 'track' } }));
    const service = new HouseholdMediaMemoryService(deps);
    expect((await service.carryOn({})).items).toEqual([]);
  });
});

describe('review fixes', () => {
  it('next episode is found even when newer finished items are songs (type filter before the cap)', async () => {
    const songs = Array.from({ length: 12 }, (_, i) => P(`plex:song${i}`, { playhead: 200, duration: 200, lastPlayed: `2026-10-02 20:${String(i).padStart(2, '0')}:00`, completedAt: 'x' }));
    const { deps } = build({ records: [...songs, P('plex:11', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-01 18:00:00', completedAt: 'x' })] });
    const getItem = deps.contentCatalog.getItem;
    deps.contentCatalog.getItem = vi.fn(async (r, id) => (id.startsWith('plex:song') ? { id, title: id, metadata: { type: 'track' } } : getItem(r, id)));
    const service = new HouseholdMediaMemoryService(deps);
    expect((await service.carryOn({})).items.map((i) => i.contentId)).toContain('plex:12');
  });

  it('a failed lookup is not remembered: the next read tries again', async () => {
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    deps.contentCatalog.getItem = vi.fn()
      .mockRejectedValueOnce(new Error('plex down'))
      .mockResolvedValue({ id: 'plex:film', title: 'Film', metadata: { type: 'movie' } });
    const service = new HouseholdMediaMemoryService(deps);
    expect((await service.recent({})).items[0].title).toBeNull();
    expect((await service.recent({})).items[0].title).toBe('Film');
  });

  it('a failed lookup warns through the sampled logger', async () => {
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    deps.contentCatalog.getItem = vi.fn().mockRejectedValue(new Error('plex down'));
    deps.logger.sampled = vi.fn();
    await new HouseholdMediaMemoryService(deps).recent({});
    expect(deps.logger.sampled).toHaveBeenCalledWith('media.household-list.describe_failed', expect.objectContaining({ contentId: 'plex:film' }), expect.objectContaining({ maxPerMinute: expect.any(Number) }));
  });

  it('never runs more than 4 catalog lookups at once', async () => {
    const records = Array.from({ length: 12 }, (_, i) => P(`plex:m${i}`, { playhead: 10, duration: 100, lastPlayed: `2026-10-02 10:00:${String(i).padStart(2, '0')}` }));
    const { deps } = build({ records });
    let inFlight = 0; let peak = 0;
    deps.contentCatalog.getItem = vi.fn(async (_r, id) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return { id, title: id, metadata: { type: 'movie' } };
    });
    await new HouseholdMediaMemoryService(deps).recent({ limit: 12 });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('carry on answers within its overall deadline even when the catalog hangs', async () => {
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    deps.contentCatalog.getItem = vi.fn(() => new Promise(() => {}));
    const runtime = { withDeadline: (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('t')), ms))]) };
    const service = new HouseholdMediaMemoryService({ ...deps, clock: Date, runtime, describeTimeoutMs: 60_000, carryOnDeadlineMs: 50 });
    const started = Date.now();
    const { items } = await service.carryOn({});
    expect(Date.now() - started).toBeLessThan(1000);
    expect(items[0]).toMatchObject({ contentId: 'plex:film', title: null });
  });

  it('recent reads only the last 14 days of the ledger', async () => {
    const playLedger = { plays: vi.fn(async () => []) };
    const { deps } = build();
    const now = Date.UTC(2026, 9, 2);
    await new HouseholdMediaMemoryService({ ...deps, playLedger, clock: { now: () => now } }).recent({});
    expect(playLedger.plays).toHaveBeenCalledWith(expect.objectContaining({ from: new Date(now - 14 * 86_400_000).toISOString() }));
  });

  it('says whether marks are available', () => {
    const { deps } = build();
    expect(new HouseholdMediaMemoryService(deps).canMarkWatched).toBe(true);
    expect(new HouseholdMediaMemoryService({ ...deps, markContentWatched: null }).canMarkWatched).toBe(false);
  });
});

describe('shared views for other household lists', () => {
  it('describeMany looks each id up once, through the cache; a miss is null', async () => {
    const { service, deps } = build();
    const first = await service.describeMany(['plex:21', 'plex:21', 'plex:nope', null]);
    expect([...first.keys()]).toEqual(['plex:21', 'plex:nope']);
    expect(first.get('plex:nope')).toBeNull();
    expect(first.get('plex:21')).toEqual(expect.objectContaining({ title: EPISODES['plex:21'].title }));
    await service.describeMany(['plex:21']);
    expect(deps.contentCatalog.getItem.mock.calls.filter(([, id]) => id === 'plex:21')).toHaveLength(1);
  });
  it('nowPlaying reports what is on screens, or that it cannot know', async () => {
    expect(await build({ nowPlaying: [{ deviceId: 'fleet:tv', contentId: 'plex:1' }] }).service.nowPlaying())
      .toEqual({ known: true, list: [{ deviceId: 'fleet:tv', contentId: 'plex:1' }] });
    expect(await build({ nowPlayingAvailable: false }).service.nowPlaying()).toEqual({ known: false, list: [] });
  });
});

describe('list-change listeners and degraded reads (batch A review)', () => {
  it('tells listeners when the household list changes: remove, restore, watched marks', async () => {
    const { service } = build();
    const seen = [];
    const off = service.onListChanged((change) => seen.push(change));
    await service.removeFromList('h1', 'plex:1');
    await service.restoreToList('h1', 'plex:1');
    await service.markWatched('plex:1', true);
    expect(seen).toEqual([
      { householdId: 'h1', reason: 'removed', id: 'plex:1' },
      { householdId: 'h1', reason: 'restored', id: 'plex:1' },
      { householdId: null, reason: 'watched', id: 'plex:1' },
    ]);
    off();
    await service.removeFromList('h1', 'plex:2');
    expect(seen).toHaveLength(3);
  });

  it('a throwing listener never fails the write', async () => {
    const { service } = build();
    service.onListChanged(() => { throw new Error('boom'); });
    await expect(service.removeFromList(undefined, 'plex:1')).resolves.toMatchObject({ id: 'plex:1' });
  });

  it('carry on and recent say degraded when a catalog lookup ran out of time', async () => {
    const { deps } = build({ records: [P('plex:film', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    deps.contentCatalog.getItem = vi.fn(() => new Promise(() => {}));
    const runtime = { withDeadline: (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('t')), ms))]) };
    const service = new HouseholdMediaMemoryService({ ...deps, clock: Date, runtime, describeTimeoutMs: 60_000, carryOnDeadlineMs: 50 });
    expect((await service.carryOn({})).degraded).toBe(true);
    expect((await service.recent({})).degraded).toBe(true);
  });

  it('carry on says degraded when only the next-episode lookup ran out of time', async () => {
    const { deps } = build({ records: [
      P('plex:11', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-01 18:00:00', completedAt: '2026-10-01 18:00:00' }),
      P('plex:12', { playhead: 1400, duration: 1400, lastPlayed: '2026-10-02 18:00:00', completedAt: '2026-10-02 18:00:00' }),
    ] });
    deps.contentCatalog.getList = vi.fn(() => new Promise(() => {}));
    const runtime = { withDeadline: (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('t')), ms))]) };
    const service = new HouseholdMediaMemoryService({ ...deps, clock: Date, runtime, describeTimeoutMs: 50, carryOnDeadlineMs: 5000 });
    const result = await service.carryOn({});
    expect(result.items).toEqual([]);
    expect(result.degraded).toBe(true);
  });

  it('is not degraded when every lookup answered (even "not found")', async () => {
    const { service } = build({ records: [P('plex:missing', { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' })] });
    expect((await service.carryOn({})).degraded).toBe(false);
  });
});
