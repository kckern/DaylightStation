import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
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

const makeApp = (withService = true) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter({
    configService: mockConfigService,
    fitnessPlayableService: withService ? mockPlayableService : null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
};

describe('GET /api/v1/piano/courses/:courseId/playable', () => {
  beforeEach(() => mockPlayableService.getPlayableEpisodes.mockClear());

  it('returns items and isSequential:true when course has sequential label', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.isSequential).toBe(true);
    expect(res.body.items).toHaveLength(2);
  });

  const PROGRESS_FILE = '/tmp/piano-test-user/apps/piano/video-progress.yml';

  afterEach(() => {
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  });

  it('adds all 5 user-progress fields with null/false defaults when no progress file exists', async () => {
    // Ensure no stale fixture from a previous run
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item).toHaveProperty('userPercent', null);
    expect(item).toHaveProperty('userPlayhead', null);
    expect(item).toHaveProperty('userWatched', false);
    expect(item).toHaveProperty('userEngaged', false);
    expect(item).toHaveProperty('userCompletedAt', null);
  });

  it('merges actual progress values and marks userWatched:true for a completed item', async () => {
    // Write a fixture for item plex:100 (percent >= 90 and engagementCount > 0)
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, [
      '"plex:100":',
      '  percent: 92',
      '  playhead: 480',
      '  duration: 520',
      '  engagementCount: 2',
      '  completedAt: "2026-06-26T10:00:00.000Z"',
      '  lastPlayed: "2026-06-26T10:00:00.000Z"',
    ].join('\n'), 'utf8');

    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);

    const completed = res.body.items[0]; // plex:100
    expect(completed.userPercent).toBe(92);
    expect(completed.userPlayhead).toBe(480);
    expect(completed.userWatched).toBe(true);
    expect(completed.userEngaged).toBe(true);
    expect(completed.userCompletedAt).toBe('2026-06-26T10:00:00.000Z');

    const untouched = res.body.items[1]; // plex:101 — no entry in fixture
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

  it('returns 503 when fitnessPlayableService is not configured', async () => {
    const res = await request(makeApp(false)).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(503);
  });
});
