// tests/isolated/api/routers/play-log-broadcast.test.mjs
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#api/v1/routers/play.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('/play/log broadcasts playback.log event', () => {
  test('emits playback.log event on successful log POST', async () => {
    const mockEventBus = {
      publish: vi.fn()
    };
    const mockAdapter = {
      getStoragePath: vi.fn().mockResolvedValue('plex/library'),
      getItem: vi.fn().mockResolvedValue({ metadata: { title: 'Jupiter', duration: 3127000 } })
    };
    const mockRegistry = {
      get: vi.fn().mockReturnValue(mockAdapter),
      adapters: new Map()
    };
    const mockMediaProgress = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined)
    };
    const logger = makeLogger();
    const app = express();
    app.use(express.json());
    app.use(createPlayRouter({
      registry: mockRegistry,
      mediaProgressMemory: mockMediaProgress,
      playResponseService: { toPlayResponse: () => ({}), getWatchState: () => null },
      contentIdResolver: { resolve: () => null },
      progressSyncSources: new Set(),
      eventBus: mockEventBus,
      logger
    }));

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:251914', percent: 2, seconds: 63, title: 'Jupiter' })
      .expect(200);

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      'playback.log',
      expect.objectContaining({
        contentId: 'plex:251914',
        type: 'plex',
        assetId: 'plex:251914',
        percent: 2,
        playhead: 63
      })
    );
    expect(logger.warn).not.toHaveBeenCalledWith('play.log.broadcast_failed', expect.anything());
  });

  test('does not throw when eventBus is not provided', async () => {
    const mockAdapter = { getStoragePath: vi.fn().mockResolvedValue('plex') };
    const logger = makeLogger();
    const app = express();
    app.use(express.json());
    app.use(createPlayRouter({
      registry: { get: () => mockAdapter, adapters: new Map() },
      mediaProgressMemory: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
      playResponseService: { toPlayResponse: () => ({}), getWatchState: () => null },
      contentIdResolver: { resolve: () => null },
      progressSyncSources: new Set(),
      logger
      // eventBus intentionally omitted
    }));

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:251914', percent: 2, seconds: 63 })
      .expect(200);

    expect(logger.warn).not.toHaveBeenCalledWith('play.log.broadcast_failed', expect.anything());
  });
});
