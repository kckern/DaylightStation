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

  it('returns 503 when fitnessPlayableService is not configured', async () => {
    const res = await request(makeApp(false)).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(503);
  });
});
