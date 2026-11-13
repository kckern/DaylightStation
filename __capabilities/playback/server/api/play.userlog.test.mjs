import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from "./play.mjs";
import { RecordPlaybackProgress } from "../application/usecases/RecordPlaybackProgress.mjs";
import { RegistryContentCatalogGateway } from "../../../content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";

let lastLogger;
const makeRouter = (store) => {
  const app = express();
  app.use(express.json());
  // Minimal mocks for the play/log dependencies
  const mediaProgressMemory = {
    findProgress: vi.fn().mockResolvedValue(null),
    saveProgress: vi.fn().mockResolvedValue(),
  };
  const registry = { get: () => null, adapters: { get: () => null } };
  const contentCatalog = new RegistryContentCatalogGateway({ registry });
  const logger = { info: vi.fn(), warn: vi.fn() };
  lastLogger = logger;
  const recordPlaybackProgress = new RecordPlaybackProgress({
    contentCatalog,
    mediaProgressMemory,
    userVideoProgressStore: store,
    nowTimestamp: () => '2026-08-28 12:00:00',
    logger,
  });
  app.use('/api/v1/play', createPlayRouter({
    recordPlaybackProgress,
    logger,
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

  it('a piano good-faith state reaches the store whole but is not repeated into the request log', async () => {
    const store = { record: vi.fn().mockReturnValue({}), prepareCredit: vi.fn(async () => {}) };
    const goodFaith = { lesson: {}, presence: {}, perMinute: [1], notes: [{ pitch: 60, onsetMs: 0, durMs: 1, velocity: 9 }] };
    await request(makeRouter(store)).post('/api/v1/play/log')
      .send({ type: 'plex', assetId: 'plex:100', percent: 92, seconds: 480, userId: 'u', practice: { sittingId: 's', goodFaith } });
    expect(store.prepareCredit.mock.calls[0][0].practice.goodFaith).toEqual(goodFaith);
    const logged = lastLogger.info.mock.calls.find(([e]) => e === 'play.log.request_received')[1];
    expect(logged.body.practice.goodFaith).toEqual({ notes: 1 });
  });
});
