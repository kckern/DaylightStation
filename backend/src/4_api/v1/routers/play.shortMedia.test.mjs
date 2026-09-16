/**
 * A video SHORTER than the browsing floor must still be reportable.
 *
 * `POST /play/log` refused `seconds < 10` to filter out scrubbing — a few
 * seconds into a long item is not progress worth storing. But the floor is
 * absolute, so an item whose WHOLE DURATION is under ten seconds can never
 * clear it, and therefore can never be recorded, completed, or credited.
 *
 * Found 2026-09-15: a 9.45s "Coming Soon!" placeholder sat at the end of a
 * child's assigned singing course. It was the next uncompleted lesson, so the
 * kiosk handed it to him every time; he watched it through repeatedly and the
 * progress post was rejected at this guard every time, leaving the day
 * permanently owed.
 *
 * The filter's real subject is "did they watch a meaningful FRACTION", which
 * `percent` already answers for media of any length.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from './play.mjs';
import { RecordPlaybackProgress } from '#apps/content/usecases/RecordPlaybackProgress.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';

const makeRouter = (store) => {
  const app = express();
  app.use(express.json());
  const mediaProgressMemory = {
    findProgress: vi.fn().mockResolvedValue(null),
    saveProgress: vi.fn().mockResolvedValue(),
  };
  const registry = { get: () => null, adapters: { get: () => null } };
  const contentCatalog = new RegistryContentCatalogGateway({ registry });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const recordPlaybackProgress = new RecordPlaybackProgress({
    contentCatalog,
    mediaProgressMemory,
    userVideoProgressStore: store,
    nowTimestamp: () => '2026-09-15 12:00:00',
    logger,
  });
  app.use('/api/v1/play', createPlayRouter({ recordPlaybackProgress, logger }));
  return app;
};

describe('POST /play/log — media shorter than the browsing floor', () => {
  it('accepts a 9-second lesson watched to the end', async () => {
    const store = {
      record: vi.fn().mockReturnValue({ percent: 100, completedAt: '2026-09-15T12:00:00Z', engaged: true }),
    };
    const res = await request(makeRouter(store))
      .post('/api/v1/play/log')
      .send({
        type: 'plex', assetId: 'plex:694748', percent: 100, seconds: 9,
        duration: 9, userId: 'learner-1', engaged: true,
      });

    expect(res.status).toBe(200);
    expect(store.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'learner-1', plexId: 'plex:694748', engaged: true }),
    );
  });

  it('still rejects a few seconds of scrubbing through a long item', async () => {
    const store = { record: vi.fn() };
    const res = await request(makeRouter(store))
      .post('/api/v1/play/log')
      .send({ type: 'plex', assetId: 'plex:694742', percent: 1, seconds: 3, duration: 523 });

    expect(res.status).toBe(400);
    expect(store.record).not.toHaveBeenCalled();
  });
});
