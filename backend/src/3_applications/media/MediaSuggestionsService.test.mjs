import { describe, it, expect, vi } from 'vitest';
import { MediaSuggestionsService } from './MediaSuggestionsService.mjs';
import { selectPlays } from '#domains/media/playLedger.mjs';

const NOW = Date.parse('2026-10-03T14:30:00.000Z'); // 07:30 local in the fixtures below
const local = (day, time) => `2026-10-${String(day).padStart(2, '0')} ${time}`;
const iso = (day) => `2026-10-${String(day).padStart(2, '0')}T14:00:00.000Z`;

function build({ rows = [], favourites = [], carry = [], nowPlaying = [], removed = [], fresh = [], maxScreens } = {}) {
  let now = NOW;
  const memory = {
    listFavourites: vi.fn(async () => ({ items: favourites })),
    carryOn: vi.fn(async () => ({ items: carry, nowOn: [], nowPlayingKnown: true })),
    listRemoved: vi.fn(async () => ({ items: removed.map((id) => ({ id, removedAt: 't' })) })),
    nowPlaying: vi.fn(async () => ({ known: true, list: nowPlaying })),
    describeMany: vi.fn(async (ids) => new Map(ids.map((id) => [id, { title: `Title ${id}`, thumbnail: `/t/${id}`, type: id === 'plex:bluey' ? 'show' : 'movie' }]))),
  };
  const recentAdditions = { list: vi.fn(async () => fresh) };
  const service = new MediaSuggestionsService({
    memory,
    playLedger: { plays: vi.fn(async (q) => selectPlays(rows, q)) },
    recentAdditions,
    screens: { aliasesOf: async (id) => [id] },
    nowLocal: () => '2026-10-03 07:30:00',
    clock: { now: () => now },
    logger: { info: vi.fn(), warn: vi.fn() },
    ...(maxScreens ? { maxScreens } : {}),
  });
  return { service, memory, recentAdditions, advance: (ms) => { now += ms; } };
}

const blueyRows = (deviceId) => [1, 2, 3].map((d) => ({
  deviceId, contentId: `plex:e${d}`, title: `S1E${d}`, kind: 'episode', parentId: 'plex:s1', grandparentId: 'plex:bluey',
  localTime: local(d, '07:10:00'), startedAt: iso(d),
}));

describe('MediaSuggestionsService', () => {
  it('builds the four rows in order, labelled for this screen', async () => {
    const { service } = build({
      rows: blueyRows('fleet:livingroom-tv'),
      favourites: [{ id: 'plex:fav', kind: 'collection', title: 'Fav' }],
      carry: [{ contentId: 'plex:film', title: 'Film', type: 'movie', percent: 40, reason: 'unfinished' }],
      fresh: [{ id: 'plex:newshow', type: 'show', title: 'New Show', addedAt: '2026-10-01T00:00:00.000Z', latestId: 'plex:n1', latestTitle: 'Ep 1' }],
    });
    const result = await service.suggest({ deviceId: 'fleet:livingroom-tv' });
    expect(result.empty).toBe(false);
    expect(result.rows.map((r) => [r.id, r.title, r.items.map((i) => i.id)])).toEqual([
      ['favourites', 'Favourites', ['plex:fav']],
      ['carry-on', 'Carry on', ['plex:film']],
      ['time-of-day', 'Usually here at this time', ['plex:bluey']],
      ['new', 'New', ['plex:newshow']],
    ]);
    expect(result.rows[2].items[0]).toMatchObject({ kind: 'collection', title: 'Title plex:bluey', days: 3, continue: { contentId: 'plex:e3', title: 'S1E3' } });
    expect(result.rows[3].items[0]).toMatchObject({ kind: 'collection', latest: { contentId: 'plex:n1', title: 'Ep 1' } });
  });

  it('a new or quiet screen falls back to the household\'s habits, labelled "Usually at this time"', async () => {
    const { service } = build({ rows: blueyRows('fleet:office-tv') });
    const result = await service.suggest({ deviceId: 'browser:brand-new' });
    expect(result.rows).toEqual([expect.objectContaining({ id: 'time-of-day', title: 'Usually at this time' })]);
  });

  it('caches the build for 5 minutes but applies now-playing and removal on every request', async () => {
    const { service, memory, advance } = build({ rows: blueyRows('fleet:livingroom-tv'), carry: [{ contentId: 'plex:film', title: 'Film' }] });
    await service.suggest({ deviceId: 'fleet:livingroom-tv' });
    memory.nowPlaying.mockResolvedValueOnce({ known: true, list: [{ deviceId: 'fleet:office-tv', contentId: 'plex:e2' }] });
    const whilePlaying = await service.suggest({ deviceId: 'fleet:livingroom-tv' });
    // Bluey is on in the office (its episode's show is excluded through the ledger's parents).
    expect(whilePlaying.rows.map((r) => r.id)).toEqual(['carry-on']);
    memory.listRemoved.mockResolvedValueOnce({ items: [{ id: 'plex:film' }] });
    expect((await service.suggest({ deviceId: 'fleet:livingroom-tv' })).rows.map((r) => r.id)).toEqual(['time-of-day']);
    expect(memory.carryOn).toHaveBeenCalledTimes(1);
    // ...while favourites are read fresh each time (a new favourite shows at once).
    expect(memory.listFavourites).toHaveBeenCalledTimes(3);
    advance(5 * 60_000 + 1);
    await service.suggest({ deviceId: 'fleet:livingroom-tv' });
    expect(memory.carryOn).toHaveBeenCalledTimes(2);
  });

  it('household-wide parts are built once per household; only time of day is per screen', async () => {
    const { service, memory, recentAdditions } = build({ rows: blueyRows('fleet:livingroom-tv') });
    await service.suggest({ deviceId: 'fleet:livingroom-tv' });
    await service.suggest({ deviceId: 'fleet:office-tv' });
    await service.suggest({ deviceId: 'browser:a' });
    expect(memory.carryOn).toHaveBeenCalledTimes(1);
    expect(recentAdditions.list).toHaveBeenCalledTimes(1);
  });

  it('the per-screen cache is capped', async () => {
    const { service } = build({ maxScreens: 2 });
    for (const id of ['browser:a', 'browser:b', 'browser:c', 'browser:d']) await service.suggest({ deviceId: id });
    expect(service.cachedScreens).toBe(2);
  });

  it('refuses a device id that is not a screen id', async () => {
    const { service } = build();
    await expect(service.suggest({ deviceId: 'nope' })).rejects.toMatchObject({ code: 'INVALID_SCREEN_ID' });
  });

  it('a household with nothing yet → { rows: [], empty: true }', async () => {
    const { service } = build();
    expect(await service.suggest({ deviceId: 'fleet:livingroom-tv' })).toMatchObject({ rows: [], empty: true });
  });

  it('a failing section is logged and left empty; the others still come back', async () => {
    const { service, memory } = build({ favourites: [{ id: 'plex:fav', kind: 'item' }] });
    memory.carryOn.mockRejectedValueOnce(new Error('plex down'));
    const result = await service.suggest({});
    expect(result.rows.map((r) => r.id)).toEqual(['favourites']);
  });

  it('"New" only offers additions from the last 14 days', async () => {
    const { service } = build({ fresh: [
      { id: 'plex:new', type: 'movie', addedAt: '2026-09-25T00:00:00.000Z' },
      { id: 'plex:old', type: 'movie', addedAt: '2026-09-01T00:00:00.000Z' },
    ] });
    const result = await service.suggest({});
    expect(result.rows[0].items.map((i) => i.id)).toEqual(['plex:new']);
  });
});

describe('cache invalidation and degraded builds (batch A review)', () => {
  it('invalidateAll drops every household and screen cache', async () => {
    const { service, memory } = build();
    await service.suggest({ deviceId: 'browser:a' });
    await service.suggest({ householdId: 'h2', deviceId: 'browser:a' });
    expect(memory.carryOn).toHaveBeenCalledTimes(2);
    service.invalidateAll();
    await service.suggest({ deviceId: 'browser:a' });
    await service.suggest({ householdId: 'h2', deviceId: 'browser:a' });
    expect(memory.carryOn).toHaveBeenCalledTimes(4);
  });

  it('a degraded carry on is flagged and cached only briefly', async () => {
    const { service, memory, advance } = build();
    memory.carryOn.mockResolvedValue({ items: [], nowOn: [], nowPlayingKnown: true, degraded: true });
    const first = await service.suggest({ deviceId: 'browser:a' });
    expect(first.degraded).toBe(true);
    advance(11_000);
    memory.carryOn.mockResolvedValue({ items: [], nowOn: [], nowPlayingKnown: true, degraded: false });
    const second = await service.suggest({ deviceId: 'browser:a' });
    expect(memory.carryOn).toHaveBeenCalledTimes(2);
    expect(second.degraded).toBe(false);
  });
});
