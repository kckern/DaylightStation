/**
 * /api/v1/media/household/* — the household media memory HTTP contract
 * (docs/reference/media/media-app-technical.md §2.4).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaRouter } from './media.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { HouseholdMediaMemoryService } from '#apps/media/HouseholdMediaMemoryService.mjs';

function makeApp({ records = [], nowPlaying = [] } = {}) {
  const favs = new Map();
  const removed = new Map();
  let tick = 0;
  const mark = { execute: vi.fn(async ({ contentId, watched }) => ({ contentId, watched, namespaces: ['plex/6_movies'] })) };
  const householdMediaMemory = new HouseholdMediaMemoryService({
    progressMemory: { listAllProgress: async () => records },
    listsStore: {
      loadFavourites: async (hid = '_') => favs.get(hid) || [],
      saveFavourites: async (l, hid = '_') => { favs.set(hid, l); },
      loadRemoved: async (hid = '_') => removed.get(hid) || {},
      saveRemoved: async (m, hid = '_') => { removed.set(hid, m); },
    },
    contentCatalog: {
      resolveSource: (source, id) => ({ source, localId: id.split(':')[1] }),
      getItem: async (_r, id) => ({ id, title: `T ${id}`, thumbnail: `/thumb/${id}`, metadata: { type: 'movie' } }),
      getList: async () => [],
    },
    markContentWatched: mark,
    nowPlaying: { list: async () => nowPlaying },
    nowTimestamp: () => `2026-10-02 23:00:${String(tick++).padStart(2, '0')}`,
    clock: { now: () => 0 },
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/media', createMediaRouter({
    mediaQueueService: {},
    mediaSurfaceConfig: { get: () => ({}) },
    mediaQueueEvents: { changed: vi.fn() },
    createMediaQueue: (p) => p,
    householdMediaMemory,
    logger: { info: vi.fn(), warn: vi.fn() },
  }));
  app.use(errorHandlerMiddleware({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
  return { app, mark };
}

const P = (contentId, over) => ({ namespaceId: 'plex/6_movies', progress: { contentId, playhead: 0, duration: 0, lastPlayed: null, ...over } });
const records = [
  P('plex:film', {
    playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00', lastDevice: 'fleet:livingroom-tv',
    spots: { 'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' } },
  }),
];

describe('GET /media/household/recent', () => {
  it('returns items with display fields, where they played and every spot', async () => {
    const res = await request(makeApp({ records }).app).get('/api/v1/media/household/recent?limit=5').expect(200);
    expect(res.body.items).toEqual([expect.objectContaining({
      contentId: 'plex:film', title: 'T plex:film', thumbnail: '/thumb/plex:film', type: 'movie',
      lastPlayed: '2026-10-01 21:00:00',
      playedOn: { deviceId: 'fleet:livingroom-tv', kind: 'screen', screenId: 'livingroom-tv' },
      spots: [expect.objectContaining({ deviceId: 'fleet:livingroom-tv', playhead: 4800, duration: 7200, open: true })],
    })]);
  });
});

describe('GET /media/household/carry-on', () => {
  it('lists unfinished items and reports now-playing ones as nowOn', async () => {
    const res = await request(makeApp({ records }).app).get('/api/v1/media/household/carry-on').expect(200);
    expect(res.body.items.map((i) => i.contentId)).toEqual(['plex:film']);
    expect(res.body.nowOn).toEqual([]);
    expect(res.body.nowPlayingKnown).toBe(true);

    const playing = await request(makeApp({ records, nowPlaying: [{ deviceId: 'fleet:office-tv', screenId: 'office-tv', contentId: 'plex:film', state: 'playing', position: 10 }] }).app)
      .get('/api/v1/media/household/carry-on').expect(200);
    expect(playing.body.items).toEqual([]);
    expect(playing.body.nowOn[0]).toMatchObject({ contentId: 'plex:film', screenId: 'office-tv' });
  });
});

describe('favourites', () => {
  it('add, list, remove (ids carry colons and slashes, so they travel in the body/query)', async () => {
    const { app } = makeApp();
    const added = await request(app).post('/api/v1/media/household/favourites').send({ id: 'files:clips/pullup', kind: 'item' }).expect(200);
    expect(added.body.item).toMatchObject({ id: 'files:clips/pullup', kind: 'item', title: 'T files:clips/pullup' });
    await request(app).post('/api/v1/media/household/favourites').send({ id: 'plex:100', kind: 'collection' }).expect(200);
    let list = await request(app).get('/api/v1/media/household/favourites').expect(200);
    expect(list.body.items.map((f) => f.id)).toEqual(['plex:100', 'files:clips/pullup']);
    await request(app).delete('/api/v1/media/household/favourites').query({ id: 'plex:100' }).expect(200);
    list = await request(app).get('/api/v1/media/household/favourites').expect(200);
    expect(list.body.items.map((f) => f.id)).toEqual(['files:clips/pullup']);
  });
  it('400 on a missing id or an unknown kind', async () => {
    const { app } = makeApp();
    await request(app).post('/api/v1/media/household/favourites').send({}).expect(400);
    await request(app).post('/api/v1/media/household/favourites').send({ id: 'plex:1', kind: 'banana' }).expect(400);
    await request(app).delete('/api/v1/media/household/favourites').expect(400);
  });
});

describe('remove from / restore to the household list', () => {
  it('removal hides the item from recent; restore brings it back', async () => {
    const { app } = makeApp({ records });
    const removed = await request(app).post('/api/v1/media/household/removed').send({ id: 'plex:film' }).expect(200);
    expect(removed.body).toMatchObject({ id: 'plex:film', removedAt: expect.any(String) });
    expect((await request(app).get('/api/v1/media/household/recent')).body.items).toEqual([]);
    expect((await request(app).get('/api/v1/media/household/removed')).body.items).toEqual([{ id: 'plex:film', removedAt: removed.body.removedAt }]);
    const restored = await request(app).delete('/api/v1/media/household/removed').send({ id: 'plex:film' }).expect(200);
    expect(restored.body).toEqual({ id: 'plex:film', restored: true });
    expect((await request(app).get('/api/v1/media/household/recent')).body.items).toHaveLength(1);
  });
});

describe('POST /media/household/watched', () => {
  it('marks watched / unwatched', async () => {
    const { app, mark } = makeApp();
    const res = await request(app).post('/api/v1/media/household/watched').send({ contentId: 'plex:film', watched: false }).expect(200);
    expect(mark.execute).toHaveBeenCalledWith({ contentId: 'plex:film', watched: false });
    expect(res.body).toMatchObject({ contentId: 'plex:film', watched: false });
  });
  it('400 when watched is not a boolean', async () => {
    const { app } = makeApp();
    await request(app).post('/api/v1/media/household/watched').send({ contentId: 'plex:film' }).expect(400);
  });
});

describe('without the household memory wired', () => {
  it('answers 501', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaRouter({ mediaQueueService: {}, mediaSurfaceConfig: { get: () => ({}) }, mediaQueueEvents: {}, createMediaQueue: (p) => p }));
    await request(app).get('/api/v1/media/household/recent').expect(501);
  });
});

describe('GET /media/household/plays', () => {
  it('400 on a bad time bound; otherwise the service answer', async () => {
    const { app } = makeApp();
    await request(app).get('/api/v1/media/household/plays?from=yesterday').expect(400);
    const res = await request(app).get('/api/v1/media/household/plays?deviceId=fleet:tv').expect(200);
    expect(res.body).toEqual({ items: [], ledger: false });
  });
});
