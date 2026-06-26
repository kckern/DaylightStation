import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from './play.mjs';

const makeRouter = (store) => {
  const app = express();
  app.use(express.json());
  // Minimal mocks for the play/log dependencies
  const mediaProgressMemory = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue() };
  const registry = { get: () => null, adapters: { get: () => null } };
  app.use('/api/v1/play', createPlayRouter({
    registry, mediaProgressMemory,
    playResponseService: { getWatchState: vi.fn(), toPlayResponse: vi.fn() },
    contentQueryService: null, contentIdResolver: { resolve: () => null },
    progressSyncSources: new Set(), progressSyncService: null,
    eventBus: null, userVideoProgressStore: store,
    logger: { info: vi.fn(), warn: vi.fn() },
  }));
  return app;
};

describe('POST /play/log user delegation', () => {
  it('calls store.record when userId is present', async () => {
    const store = { record: vi.fn().mockReturnValue({ percent: 92, completedAt: '2026-01-01T00:00:00Z', engaged: true }) };
    const res = await request(makeRouter(store))
      .post('/api/v1/play/log')
      .send({ type: 'plex', assetId: 'plex:100', percent: 92, seconds: 480, userId: 'user_3', engaged: true });
    expect(res.status).toBe(200);
    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_3', plexId: 'plex:100', engaged: true }));
    expect(res.body.response.userProgress).toBeTruthy();
  });

  it('does NOT call store.record when userId is absent', async () => {
    const store = { record: vi.fn() };
    const res = await request(makeRouter(store))
      .post('/api/v1/play/log')
      .send({ type: 'plex', assetId: 'plex:100', percent: 50, seconds: 120 });
    expect(res.status).toBe(200);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('still returns 200 when store.record throws (device write already succeeded)', async () => {
    const store = { record: vi.fn(() => { throw new Error('disk full'); }) };
    const res = await request(makeRouter(store))
      .post('/api/v1/play/log')
      .send({ type: 'plex', assetId: 'plex:100', percent: 92, seconds: 480, userId: 'user_3', engaged: true });
    expect(res.status).toBe(200);
  });
});
