import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

const MOCK_USER = 'test-user';
const MOCK_SHOW = '12345';

const mockConfigService = {
  getUserProfile: (id) => id === MOCK_USER ? { id, name: 'Test' } : null,
  getUserDir: () => '/tmp/piano-test-user',
  getMediaDir: () => '/tmp/piano-test-media',
  getHouseholdAppConfig: () => ({
    users: { primary: [MOCK_USER] },
    videos: {
      sequential_labels: ['sequential'],
      completion_threshold_percent: 90,
      engagement_timeout_seconds: 90,
    },
  }),
};

const mockPlayableService = {
  getPlayableEpisodes: vi.fn().mockResolvedValue({
    compoundId: `plex:${MOCK_SHOW}`,
    showId: MOCK_SHOW,
    items: [
      { plex: '100', label: 'Lesson 1', itemIndex: 1, parentId: '10', isWatched: false, watchProgress: 0 },
      { plex: '101', label: 'Lesson 2', itemIndex: 2, parentId: '10', isWatched: false, watchProgress: 0 },
    ],
    parents: { '10': { index: 1, title: 'Season 1', thumbnail: null } },
    info: { title: 'Piano Course', labels: ['sequential'], type: 'show' },
    containerItem: null,
  }),
};

const mockStore = {
  isKnownUser: (id) => id === MOCK_USER,
  enrich: (items, userId) => items.map((it) => ({
    ...it,
    userPercent: it.plex === '100' ? 92 : null,
    userPlayhead: it.plex === '100' ? 480 : null,
    userWatched: it.plex === '100',
    userEngaged: it.plex === '100',
    userCompletedAt: it.plex === '100' ? '2026-06-26T00:00:00Z' : null,
  })),
};

const makeApp = (withService = true) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter({
    configService: mockConfigService,
    fitnessPlayableService: withService ? mockPlayableService : null,
    userVideoProgressStore: mockStore,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
};

describe('GET /api/v1/piano/courses/:courseId/playable', () => {
  beforeEach(() => { mockPlayableService.getPlayableEpisodes.mockClear(); });

  it('returns items and isSequential:true when course has sequential label', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.isSequential).toBe(true);
    expect(res.body.items).toHaveLength(2);
  });

  it('adds userPercent/userWatched fields via the progress store enrichment', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);

    const completed = res.body.items[0]; // plex:100
    expect(completed.userPercent).toBe(92);
    expect(completed.userPlayhead).toBe(480);
    expect(completed.userWatched).toBe(true);
    expect(completed.userEngaged).toBe(true);
    expect(completed.userCompletedAt).toBe('2026-06-26T00:00:00Z');

    const untouched = res.body.items[1]; // plex:101
    expect(untouched.userPercent).toBeNull();
    expect(untouched.userPlayhead).toBeNull();
    expect(untouched.userWatched).toBe(false);
    expect(untouched.userEngaged).toBe(false);
    expect(untouched.userCompletedAt).toBeNull();
  });

  it('returns 400 when userId is unknown', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=ghost`);
    expect(res.status).toBe(400);
  });

  it('accepts guest (the who\'s-playing dismiss identity): 200, not the unknown-user 400', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=guest`);
    expect(res.status).toBe(200);            // guest is NOT rejected like an unknown user
    expect(res.body.isSequential).toBe(true); // still computed from the label
    expect(res.body.items).toHaveLength(2);
  });

  it('does not run progress enrichment for guest', async () => {
    // Spy: guest must not invoke the per-user progress store enrich.
    const spy = vi.spyOn(mockStore, 'enrich');
    await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=guest`);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lifts the unit link from metadata.parentId to the item top-level', async () => {
    // The shared playable service nests the season/unit link under metadata; the
    // frontend unit grouping keys off a TOP-LEVEL parentId. Regression guard: a
    // course whose items only carry metadata.parentId must come out lifted.
    mockPlayableService.getPlayableEpisodes.mockResolvedValueOnce({
      compoundId: `plex:${MOCK_SHOW}`,
      showId: MOCK_SHOW,
      items: [
        { plex: '200', label: 'Unit 1 Lesson', metadata: { parentId: '676051', parentIndex: 1, parentTitle: 'Unit 1' } },
      ],
      parents: { '676051': { index: 1, title: 'Unit 1', thumbnail: null } },
      info: { title: 'Hoffman Academy', labels: ['sequential'], type: 'show' },
      containerItem: null,
    });
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    const ep = res.body.items[0];
    expect(ep.parentId).toBe('676051');   // lifted from metadata
    expect(ep.parentIndex).toBe(1);
    expect(ep.parentTitle).toBe('Unit 1');
    expect(res.body.parents['676051']).toBeTruthy();
  });

  it('returns 503 when fitnessPlayableService is not configured', async () => {
    const res = await request(makeApp(false)).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(503);
  });
});

// ── Co-progress lock helpers ────────────────────────────────────────────────
const PARTNER_USER = 'partner-user';

const items6 = Array.from({ length: 6 }, (_, i) => ({
  plex: String(100 + i), label: `Lesson ${i + 1}`, itemIndex: i + 1,
  parentId: '10', isWatched: false, watchProgress: 0,
}));

function makePartnerStore(userWatched) {
  return {
    isKnownUser: (id) => id === MOCK_USER || id === PARTNER_USER,
    enrich: (items, userId) => {
      const watchedIds = new Set(userWatched[userId] || []);
      return items.map((it) => ({
        ...it,
        userWatched: watchedIds.has(it.plex),
        userPercent: watchedIds.has(it.plex) ? 92 : null,
        userPlayhead: watchedIds.has(it.plex) ? 480 : null,
        userEngaged: watchedIds.has(it.plex),
        userCompletedAt: watchedIds.has(it.plex) ? '2026-06-26T00:00:00Z' : null,
      }));
    },
  };
}

const coProgressConfig = {
  users: { primary: [MOCK_USER, PARTNER_USER] },
  videos: {
    sequential_labels: ['sequential'],
    co_progress: [{ courseId: `plex:${MOCK_SHOW}`, users: [MOCK_USER, PARTNER_USER], buffer: 5 }],
  },
};

const makeAppWith = ({ config, store, items, parents } = {}) => {
  const configSvc = config
    ? { ...mockConfigService, getHouseholdAppConfig: () => config }
    : mockConfigService;
  const svc = items
    ? {
        getPlayableEpisodes: vi.fn().mockResolvedValue({
          compoundId: `plex:${MOCK_SHOW}`,
          showId: MOCK_SHOW,
          items,
          parents: parents || { '10': { index: 1, title: 'Season 1', thumbnail: null } },
          info: { title: 'Piano Course', labels: ['sequential'], type: 'show' },
          containerItem: null,
        }),
      }
    : mockPlayableService;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter({
    configService: configSvc,
    fitnessPlayableService: svc,
    userVideoProgressStore: store || mockStore,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
};

describe('co-progress lock', () => {
  it('returns coProgressLock: null when no co_progress config exists', async () => {
    const res = await request(makeApp())
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('returns coProgressLock: null when the gap is below the buffer (4 < 5)', async () => {
    const store = makePartnerStore({ [MOCK_USER]: ['100', '101', '102', '103'], [PARTNER_USER]: [] });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('locks when the requesting user is ahead by exactly buffer episodes', async () => {
    const store = makePartnerStore({
      [MOCK_USER]: ['100', '101', '102', '103', '104'],
      [PARTNER_USER]: [],
    });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toEqual({
      locked: true,
      aheadBy: 5,
      waitingForId: PARTNER_USER,
      buffer: 5,
    });
  });

  it('does not lock guest users (guest is always exempt)', async () => {
    const store = makePartnerStore({ guest: ['100', '101', '102', '103', '104'] });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=guest`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('does not lock for a non-sequential course even with a matching rule', async () => {
    const nonSeqConfig = {
      ...coProgressConfig,
      videos: { ...coProgressConfig.videos, sequential_labels: [] },
    };
    const store = makePartnerStore({ [MOCK_USER]: ['100', '101', '102', '103', '104'] });
    const res = await request(makeAppWith({ config: nonSeqConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });
});

// ── Reference-unit helpers ──────────────────────────────────────────────────
// Two units: a lesson unit ('20') and an "Exercise Module" reference unit ('30').
const refParents = {
  '20': { index: 1, title: 'Welcome & Basics', thumbnail: null },
  '30': { index: 2, title: 'Exercise Module - C Position', thumbnail: null },
};
const refItems = [
  { plex: '201', label: 'Lesson A1', itemIndex: 1, parentId: '20', isWatched: false, watchProgress: 0 },
  { plex: '202', label: 'Lesson A2', itemIndex: 2, parentId: '20', isWatched: false, watchProgress: 0 },
  { plex: '301', label: '01 Drill', itemIndex: 1, parentId: '30', isWatched: false, watchProgress: 0 },
  { plex: '302', label: '02 Drill', itemIndex: 2, parentId: '30', isWatched: false, watchProgress: 0 },
];
const refConfig = (refRule) => ({
  users: { primary: [MOCK_USER, PARTNER_USER] },
  videos: {
    sequential_labels: ['sequential'],
    reference_units: [{ courseId: `plex:${MOCK_SHOW}`, ...refRule }],
  },
});

describe('reference units', () => {
  it('returns referenceUnitIds: [] and isReference:false on every item when no rule', async () => {
    const res = await request(makeAppWith({ items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual([]);
    expect(res.body.items.every((it) => it.isReference === false)).toBe(true);
  });

  it('flags a unit whose title matches a titlePattern (case-insensitive)', async () => {
    const config = refConfig({ titlePatterns: ['exercise module'] });
    const res = await request(makeAppWith({ config, items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['30']);
    const byId = Object.fromEntries(res.body.items.map((it) => [it.plex, it.isReference]));
    expect(byId['201']).toBe(false);
    expect(byId['202']).toBe(false);
    expect(byId['301']).toBe(true);
    expect(byId['302']).toBe(true);
  });

  it('flags a unit listed in unitIds regardless of title', async () => {
    const config = refConfig({ titlePatterns: [], unitIds: ['20'] });
    const res = await request(makeAppWith({ config, items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['20']);
  });

  it('excludes reference episodes from the co-progress count', async () => {
    // milo watched 4 lessons + 5 reference; felix watched none. buffer 5.
    // Counting reference would make milo 9 ahead (lock); excluding it leaves 4 (no lock).
    const lessons = Array.from({ length: 6 }, (_, i) => ({
      plex: String(400 + i), label: `Lesson ${i + 1}`, itemIndex: i + 1, parentId: '20',
    }));
    const drills = Array.from({ length: 5 }, (_, i) => ({
      plex: String(500 + i), label: `Drill ${i + 1}`, itemIndex: i + 1, parentId: '30',
    }));
    const items = [...lessons, ...drills];
    const store = makePartnerStore({
      [MOCK_USER]: ['400', '401', '402', '403', '500', '501', '502', '503', '504'],
      [PARTNER_USER]: [],
    });
    const config = {
      users: { primary: [MOCK_USER, PARTNER_USER] },
      videos: {
        sequential_labels: ['sequential'],
        co_progress: [{ courseId: `plex:${MOCK_SHOW}`, users: [MOCK_USER, PARTNER_USER], buffer: 5 }],
        reference_units: [{ courseId: `plex:${MOCK_SHOW}`, titlePatterns: ['Exercise Module'] }],
      },
    };
    const res = await request(makeAppWith({ config, store, items, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['30']);
    expect(res.body.coProgressLock).toBeNull(); // 4 lesson-ahead < 5, reference excluded
  });
});
