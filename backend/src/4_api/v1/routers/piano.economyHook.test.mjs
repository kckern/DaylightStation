// @vitest-environment node
// Task 8 — piano lesson-completion → coin earn-hook, exercised through the real
// play /log route. The route owns the UserVideoProgressStore.record(...) call
// whose `newlyCompleted` transition flag drives a fire-and-forget economy earn.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { UserVideoProgressStore } from '#apps/piano/UserVideoProgressStore.mjs';
import { createPlayRouter } from './play.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/piano-econhook-test-user';
const PROGRESS = path.join(USER_DIR, 'apps', 'piano', 'video-progress.yml');

// Threshold here MUST match what the store reads (completion_threshold_percent).
const configService = {
  getUserProfile: (id) => (id === USER ? { id, name: 'Test' } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ({ videos: { completion_threshold_percent: 90 } }),
};

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };

const makeApp = ({ economyService }) => {
  const userVideoProgressStore = new UserVideoProgressStore({ configService, logger: silentLogger });
  const registry = { get: () => null }; // no adapter → storagePath stays `type`, no metadata
  const router = createPlayRouter({
    registry,
    mediaProgressMemory: null,
    userVideoProgressStore,
    economyService,
    logger: silentLogger,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/play', router);
  return app;
};

const completingBody = { type: 'plex', assetId: '100', percent: 95, seconds: 120, userId: USER, engaged: true };

beforeEach(clean);
afterEach(clean);

describe('play /log economy earn-hook (piano lesson completion)', () => {
  it('fires earn exactly once with the expected args on the completion transition', async () => {
    const earn = vi.fn().mockResolvedValue({ earned: 5 });
    const app = makeApp({ economyService: { earn } });

    await request(app).post('/api/play/log').send(completingBody).expect(200);

    expect(earn).toHaveBeenCalledTimes(1);
    expect(earn).toHaveBeenCalledWith(USER, {
      action: 'piano-lesson-complete',
      source: 'piano',
      ref: 'plex:100',
    });
  });

  it('does NOT fire earn again on a repeat completing post (not newlyCompleted)', async () => {
    const earn = vi.fn().mockResolvedValue({ earned: 5 });
    const app = makeApp({ economyService: { earn } });

    await request(app).post('/api/play/log').send(completingBody).expect(200);
    await request(app).post('/api/play/log').send(completingBody).expect(200);

    expect(earn).toHaveBeenCalledTimes(1);
  });

  it('does not leak newlyCompleted into the HTTP response payload', async () => {
    const earn = vi.fn().mockResolvedValue({ earned: 5 });
    const app = makeApp({ economyService: { earn } });

    const res = await request(app).post('/api/play/log').send(completingBody).expect(200);
    expect(res.body.response.userProgress).toBeTruthy();
    expect(res.body.response.userProgress).not.toHaveProperty('newlyCompleted');
    expect(res.body.response.userProgress.completedAt).toBeTruthy();
  });

  it('records completion without crashing when no economyService is wired (200)', async () => {
    const app = makeApp({ economyService: null });

    await request(app).post('/api/play/log').send(completingBody).expect(200);

    // Progress still persisted even with the earn-hook absent.
    expect(fs.existsSync(PROGRESS)).toBe(true);
  });
});
