// tests/isolated/api/routers/play-log-completedAt.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#api/v1/routers/play.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeApp({ existingState = null, setSpy }) {
  const mockAdapter = {
    getStoragePath: jest.fn().mockResolvedValue('plex/14_fitness'),
    getItem: jest.fn().mockResolvedValue({ metadata: { title: 'Upper Body', duration: 678000 } })
  };
  const mockRegistry = {
    get: jest.fn().mockReturnValue(mockAdapter),
    adapters: new Map()
  };
  const mockMediaProgress = {
    get: jest.fn().mockResolvedValue(existingState),
    set: setSpy
  };
  const app = express();
  app.use(express.json());
  app.use(createPlayRouter({
    registry: mockRegistry,
    mediaProgressMemory: mockMediaProgress,
    playResponseService: { toPlayResponse: () => ({}), getWatchState: () => null },
    contentIdResolver: { resolve: () => null },
    progressSyncSources: new Set(),
    logger: makeLogger()
  }));
  return app;
}

describe('/play/log stamps completedAt when watched threshold is crossed', () => {
  test('stamps completedAt when percent >= 90 and no prior completedAt', async () => {
    const setSpy = jest.fn().mockResolvedValue(undefined);
    const app = makeApp({ existingState: null, setSpy });

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:674498', percent: 95, seconds: 644 })
      .expect(200);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const persisted = setSpy.mock.calls[0][0];
    expect(persisted.completedAt).toBeTruthy();
    expect(typeof persisted.completedAt).toBe('string');
  });

  test('does not stamp completedAt when percent < 90', async () => {
    const setSpy = jest.fn().mockResolvedValue(undefined);
    const app = makeApp({ existingState: null, setSpy });

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:674498', percent: 50, seconds: 339 })
      .expect(200);

    const persisted = setSpy.mock.calls[0][0];
    expect(persisted.completedAt).toBeFalsy();
  });

  test('preserves existing completedAt on subsequent logs even if percent drops', async () => {
    const setSpy = jest.fn().mockResolvedValue(undefined);
    const existing = {
      contentId: 'plex:674498',
      playhead: 678,
      duration: 678,
      percent: 100,
      playCount: 1,
      lastPlayed: '2026-04-20 06:07:44',
      watchTime: 735,
      completedAt: '2026-04-20 06:07:44'
    };
    const app = makeApp({ existingState: existing, setSpy });

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:674498', percent: 6, seconds: 40 })
      .expect(200);

    const persisted = setSpy.mock.calls[0][0];
    expect(persisted.completedAt).toBe('2026-04-20 06:07:44');
  });
});
