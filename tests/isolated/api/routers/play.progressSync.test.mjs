// tests/isolated/api/routers/play.progressSync.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#api/v1/routers/play.mjs';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function createStubRegistry() {
  const absAdapter = {
    source: 'abs',
    getStoragePath: jest.fn(async () => 'abs'),
    getItem: jest.fn(async (localId) => ({
      id: `abs:${localId}`,
      mediaUrl: `/api/v1/proxy/abs/stream/${localId}`,
      mediaType: 'audio',
      title: 'Test Audiobook',
      duration: 19766,
      resumable: true,
      thumbnail: null,
      metadata: {}
    }))
  };
  return {
    get: jest.fn((source) => source === 'abs' ? absAdapter : null),
    _absAdapter: absAdapter
  };
}

function createStubContentIdResolver(registry) {
  return {
    resolve: jest.fn((compoundId) => {
      const colonIdx = compoundId.indexOf(':');
      if (colonIdx < 0) return null;
      const source = compoundId.slice(0, colonIdx);
      const localId = compoundId.slice(colonIdx + 1);
      const adapter = registry.get(source);
      return adapter ? { source, localId, adapter } : null;
    })
  };
}

function createStubMediaProgressMemory() {
  return {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {})
  };
}

function createStubProgressSyncService() {
  return {
    reconcileOnPlay: jest.fn(async () => null),
    onProgressUpdate: jest.fn()
  };
}

function buildApp(config) {
  const app = express();
  app.use(express.json());
  app.use('/play', createPlayRouter(config));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Play router — ProgressSyncService integration', () => {
  let registry, contentIdResolver, mediaProgressMemory, progressSyncService, progressSyncSources, logger;

  beforeEach(() => {
    registry = createStubRegistry();
    contentIdResolver = createStubContentIdResolver(registry);
    mediaProgressMemory = createStubMediaProgressMemory();
    progressSyncService = createStubProgressSyncService();
    progressSyncSources = new Set(['abs']);
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  // =========================================================================
  // GET /play/abs:itemId — play start
  // =========================================================================

  describe('GET /play/abs:itemId — play start', () => {
    it('calls progressSyncService.reconcileOnPlay for abs items', async () => {
      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService, progressSyncSources, logger });

      await request(app).get('/play/abs:abc123');

      expect(progressSyncService.reconcileOnPlay).toHaveBeenCalledWith(
        'abs:abc123',  // compoundId
        'abs',         // storagePath
        'abc123'       // localId
      );
    });

    it('falls back to mediaProgressMemory when progressSyncService is null', async () => {
      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService: null, logger });

      await request(app).get('/play/abs:abc123');

      expect(mediaProgressMemory.get).toHaveBeenCalledWith('abs:abc123', 'abs');
    });

    it('uses sync service result for resume_position', async () => {
      progressSyncService.reconcileOnPlay.mockResolvedValue({
        itemId: 'abs:abc123',
        playhead: 5000,
        duration: 19766
      });

      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService, progressSyncSources, logger });

      const res = await request(app).get('/play/abs:abc123');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBe(5000);
    });
  });

  // =========================================================================
  // POST /play/log — progress update
  // =========================================================================

  describe('POST /play/log — progress update', () => {
    it('calls progressSyncService.onProgressUpdate for abs items', async () => {
      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService, progressSyncSources, logger });

      await request(app)
        .post('/play/log')
        .send({
          type: 'abs',
          assetId: 'abs:abc123',
          percent: 25,
          seconds: 5000,
          title: 'Test Audiobook',
          watched_duration: 60
        });

      expect(progressSyncService.onProgressUpdate).toHaveBeenCalledWith(
        'abs:abc123',  // compoundId
        'abc123',      // localId
        expect.objectContaining({
          playhead: 5000,
          duration: expect.any(Number),
          percent: expect.any(Number),
          watchTime: 60
        })
      );
    });

    it('does not call sync for non-abs items', async () => {
      // Create a plex stub for the registry
      const plexAdapter = {
        source: 'plex',
        getStoragePath: jest.fn(async () => 'plex'),
        getItem: jest.fn(async () => ({
          id: 'plex:99999',
          mediaUrl: '/api/v1/proxy/plex/stream/99999',
          mediaType: 'video',
          title: 'Test Movie',
          duration: 7200,
          metadata: {}
        }))
      };
      registry.get.mockImplementation((source) => {
        if (source === 'abs') return registry._absAdapter;
        if (source === 'plex') return plexAdapter;
        return null;
      });

      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService, progressSyncSources, logger });

      await request(app)
        .post('/play/log')
        .send({
          type: 'plex',
          assetId: 'plex:99999',
          percent: 50,
          seconds: 3600,
          title: 'Test Movie'
        });

      expect(progressSyncService.onProgressUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /play/abs:itemId?bookmark=true — bookmark restore
  // =========================================================================

  describe('GET /play/abs:itemId?bookmark=true — bookmark restore', () => {
    it('uses bookmark playhead as resume_position', async () => {
      progressSyncService.reconcileOnPlay.mockResolvedValue({
        itemId: 'abs:abc123',
        playhead: 5000,
        duration: 19766,
        bookmark: { playhead: 1000, reason: 'session-start', createdAt: new Date().toISOString() }
      });

      const app = buildApp({ registry, mediaProgressMemory, contentIdResolver, progressSyncService, progressSyncSources, logger });

      const res = await request(app).get('/play/abs:abc123?bookmark=true');

      expect(res.status).toBe(200);
      // The bookmark playhead (1000) should override the regular playhead (5000)
      expect(res.body.resume_position).toBe(1000);
    });
  });
});
