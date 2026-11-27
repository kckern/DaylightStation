/**
 * /api/v1/media/household/continue — Continue listening means listened (lookup
 * spec §13): the threshold, one row per book, finished and hidden books leaving,
 * the legacy review, and carry-on (the web's Continue) giving the same answer.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaRouter } from "./media.mjs";
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { HouseholdMediaMemoryService } from "../application/HouseholdMediaMemoryService.mjs";

const BOOK = 'plex:900';
const part = (n) => ({
  id: `plex:90${n}`, title: `Part ${n}`, duration: 3000, thumbnail: `/t/90${n}`,
  metadata: { type: 'track', parentId: '900', grandparentId: '800', parentTitle: 'Henry VI Part 3', grandparentTitle: 'William Shakespeare', librarySectionID: 7, librarySectionTitle: 'Audiobooks', itemIndex: n },
});
const ITEMS = {
  [BOOK]: { id: BOOK, title: 'Henry VI Part 3', thumbnail: '/t/book', metadata: { type: 'album', librarySectionID: 7 } },
  'plex:901': part(1), 'plex:902': part(2), 'plex:903': part(3),
  'plex:song': { id: 'plex:song', title: 'A song', duration: 3600, metadata: { type: 'track', librarySectionID: 3, librarySectionTitle: 'Music' } },
  'plex:talk': { id: 'plex:talk', title: 'Snakes', duration: 5000, metadata: { type: 'track', parentId: '950', librarySectionID: 8, librarySectionTitle: 'Talks' } },
};
const LISTS = { 900: [part(1), part(2), part(3)], 950: [ITEMS['plex:talk']] };

function makeApp({ records = [], minListenedMin } = {}) {
  const removed = new Map();
  const decisions = new Map();
  let tick = 0;
  const householdMediaMemory = new HouseholdMediaMemoryService({
    progressMemory: { listAllProgress: async () => records },
    listsStore: {
      loadFavourites: async () => [],
      saveFavourites: async () => {},
      loadRemoved: async (hid = '_') => removed.get(hid) || {},
      saveRemoved: async (m, hid = '_') => { removed.set(hid, m); },
      loadContinueDecisions: async (hid = '_') => decisions.get(hid) || {},
      saveContinueDecisions: async (m, hid = '_') => { decisions.set(hid, m); },
    },
    contentCatalog: {
      resolveSource: (source, id) => ({ source, localId: id.split(':')[1] }),
      getItem: async (_r, id) => ITEMS[id] ?? null,
      getList: async (_r, ref) => LISTS[ref] ?? [],
    },
    markContentWatched: { execute: vi.fn() },
    nowPlaying: { list: async () => [] },
    nowTimestamp: () => `2026-11-26 23:00:${String(tick++).padStart(2, '0')}`,
    clock: { now: () => Date.parse('2026-11-26T12:00:00Z') },
    continueConfig: () => (minListenedMin === undefined ? null : { minListenedMin }),
    libraryKinds: () => ({ Audiobooks: 'books', Talks: 'talks', Music: 'music' }),
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
  return { app, decisions };
}

const P = (contentId, over) => ({ namespaceId: 'plex/7_audiobooks', progress: { contentId, playhead: 0, duration: 3000, lastPlayed: null, ...over } });
const heard = [
  P('plex:901', { playhead: 3000, lastPlayed: '2026-11-25 20:00:00', listenedSec: 2900, completedAt: '2026-11-25 20:00:00' }),
  P('plex:902', { playhead: 900, lastPlayed: '2026-11-26 09:00:00', listenedSec: 880 }),
];

describe('GET /media/household/continue', () => {
  it('one row per book, showing the current part, with the answer\'s fields', async () => {
    const res = await request(makeApp({ records: heard }).app).get('/api/v1/media/household/continue').expect(200);
    expect(res.body.minListenedMin).toBe(5);
    expect(res.body.reviewCount).toBe(0);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      contentId: BOOK, playContentId: 'plex:902', title: 'Henry VI Part 3', byline: 'William Shakespeare',
      thumbnail: '/t/book', partTitle: 'Part 2', partIndex: 2, partCount: 3, playhead: 900, duration: 3000,
      remainingSec: 2100 + 3000, legacy: false,
    });
    expect(res.body.items[0].listenedSec).toBeCloseTo(3780, 0);
  });

  it('a seek into a talk with seconds heard is not listed; music never', async () => {
    const res = await request(makeApp({ records: [
      P('plex:talk', { playhead: 2000, duration: 5000, lastPlayed: '2026-11-26 10:00:00', listenedSec: 8 }),
      P('plex:song', { playhead: 1200, duration: 3600, lastPlayed: '2026-11-26 10:00:00', listenedSec: 1200 }),
    ] }).app).get('/api/v1/media/household/continue').expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('the threshold comes from continue.minListenedMin', async () => {
    const records = [P('plex:talk', { playhead: 2000, duration: 5000, lastPlayed: '2026-11-26 10:00:00', listenedSec: 200 })];
    const strict = await request(makeApp({ records }).app).get('/api/v1/media/household/continue').expect(200);
    expect(strict.body.items).toEqual([]);
    const loose = await request(makeApp({ records, minListenedMin: 3 }).app).get('/api/v1/media/household/continue').expect(200);
    expect(loose.body.items.map((i) => i.contentId)).toEqual(['plex:950']);
  });

  it('a book whose every part is finished leaves at once', async () => {
    const records = [1, 2, 3].map((n) => P(`plex:90${n}`, { playhead: 3000, lastPlayed: '2026-11-26 09:00:00', listenedSec: 2900 }));
    const res = await request(makeApp({ records }).app).get('/api/v1/media/household/continue').expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('hiding the book hides it from the phone\'s answer and from carry-on', async () => {
    const { app } = makeApp({ records: heard });
    await request(app).post('/api/v1/media/household/continue/hide').send({ contentId: BOOK }).expect(200);
    expect((await request(app).get('/api/v1/media/household/continue').expect(200)).body.items).toEqual([]);
    expect((await request(app).get('/api/v1/media/household/carry-on').expect(200)).body.items).toEqual([]);
  });

  it('carry-on (the web\'s Continue) lists the same book row', async () => {
    const res = await request(makeApp({ records: heard }).app).get('/api/v1/media/household/carry-on').expect(200);
    expect(res.body.items.map((i) => i.contentId)).toEqual([BOOK]);
    expect(res.body.items[0]).toMatchObject({ playContentId: 'plex:902', reason: 'unfinished', title: 'Henry VI Part 3' });
  });
});

describe('Continue listening review (/household/continue/review)', () => {
  const legacy = [
    P('plex:902', { playhead: 900, lastPlayed: '2026-11-20 09:00:00' }),
    P('plex:talk', { playhead: 2000, duration: 5000, lastPlayed: '2026-11-19 10:00:00' }),
  ];

  it('lists entries from before listened time was measured; they stay in Continue flagged legacy', async () => {
    const { app } = makeApp({ records: legacy });
    const review = await request(app).get('/api/v1/media/household/continue/review').expect(200);
    expect(review.body.items.map((i) => i.contentId)).toEqual([BOOK, 'plex:950']);
    const cont = await request(app).get('/api/v1/media/household/continue').expect(200);
    expect(cont.body.reviewCount).toBe(2);
    expect(cont.body.items.every((i) => i.legacy)).toBe(true);
  });

  it('Keep makes an entry a normal one; Clear takes it out', async () => {
    const { app } = makeApp({ records: legacy });
    const kept = await request(app).post('/api/v1/media/household/continue/review').send({ contentId: BOOK, decision: 'keep' }).expect(200);
    expect(kept.body).toEqual({ decided: [BOOK], decision: 'keep' });
    await request(app).post('/api/v1/media/household/continue/review').send({ contentId: 'plex:950', decision: 'clear' }).expect(200);
    const cont = await request(app).get('/api/v1/media/household/continue').expect(200);
    expect(cont.body.items.map((i) => [i.contentId, i.legacy])).toEqual([[BOOK, false]]);
    expect(cont.body.reviewCount).toBe(0);
    expect((await request(app).get('/api/v1/media/household/continue/review').expect(200)).body.items).toEqual([]);
  });

  it('Clear all clears every undecided entry', async () => {
    const { app, decisions } = makeApp({ records: legacy });
    const res = await request(app).post('/api/v1/media/household/continue/review').send({ all: true, decision: 'clear' }).expect(200);
    expect(res.body.decided.sort()).toEqual([BOOK, 'plex:950'].sort());
    expect(Object.values(decisions.get('_') ?? decisions.values().next().value).every((d) => d.decision === 'clear')).toBe(true);
    expect((await request(app).get('/api/v1/media/household/continue').expect(200)).body.items).toEqual([]);
  });

  it('refuses a bad decision or a missing id', async () => {
    const { app } = makeApp({ records: legacy });
    await request(app).post('/api/v1/media/household/continue/review').send({ contentId: BOOK, decision: 'maybe' }).expect(400);
    await request(app).post('/api/v1/media/household/continue/review').send({ decision: 'keep' }).expect(400);
    await request(app).post('/api/v1/media/household/continue/review').send({ all: true, decision: 'keep' }).expect(400);
  });
});
