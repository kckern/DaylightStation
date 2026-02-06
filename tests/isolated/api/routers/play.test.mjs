// tests/unit/api/routers/play.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#backend/src/4_api/v1/routers/play.mjs';

describe('Play API Router', () => {
  let app;
  let mockRegistry;
  let mockWatchStore;
  let mockMediaAdapter;
  let mockPlexAdapter;

  beforeEach(() => {
    mockMediaAdapter = {
      name: 'files',
      getItem: jest.fn().mockResolvedValue({
        id: 'files:audio/test.mp3',
        title: 'Test Song',
        mediaType: 'audio',
        mediaUrl: '/proxy/media/stream/audio/test.mp3',
        duration: 180,
        resumable: false
      }),
      getStoragePath: jest.fn().mockReturnValue('files'),
      resolvePlayables: jest.fn()
    };

    mockPlexAdapter = {
      name: 'plex',
      getItem: jest.fn().mockResolvedValue({
        id: 'plex:12345',
        title: 'Test Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true
      }),
      getStoragePath: jest.fn().mockReturnValue('plex'),
      resolvePlayables: jest.fn()
    };

    mockRegistry = {
      get: jest.fn((name) => {
        if (name === 'files') return mockMediaAdapter;
        if (name === 'plex') return mockPlexAdapter;
        return null;
      })
    };

    mockWatchStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    };

    app = express();
    app.use('/api/play', createPlayRouter({ registry: mockRegistry, watchStore: mockWatchStore }));
  });

  describe('GET /api/play/:source/*', () => {
    it('returns playable item from files', async () => {
      const res = await request(app).get('/api/play/files/audio/test.mp3');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('files:audio/test.mp3');
      expect(res.body.mediaUrl).toBe('/proxy/media/stream/audio/test.mp3');
      expect(res.body.mediaType).toBe('audio');
    });

    it('returns playable item from plex', async () => {
      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('plex:12345');
      expect(res.body.mediaUrl).toBe('/proxy/plex/stream/12345');
      expect(res.body.mediaType).toBe('video');
    });

    it('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/play/unknown/12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Unknown source');
    });

    it('returns 404 for missing item', async () => {
      mockMediaAdapter.getItem.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/play/files/nonexistent.mp3');

      expect(res.status).toBe(404);
    });

    it('includes resume position when item is in progress', async () => {
      mockWatchStore.get.mockResolvedValueOnce({
        itemId: 'plex:12345',
        playhead: 3600,
        duration: 7200,
        isInProgress: () => true,
        isWatched: () => false
      });

      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.resume_position).toBe(3600);
    });

    it('includes plex field for plex items', async () => {
      const res = await request(app).get('/api/play/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.plex).toBe('12345');
    });
  });

  describe('GET /api/play/:source/*/shuffle', () => {
    it('handles shuffle modifier in path', async () => {
      mockMediaAdapter.resolvePlayables.mockResolvedValue([
        { id: 'files:audio/song1.mp3', title: 'Song 1', mediaUrl: '/proxy/media/stream/audio/song1.mp3', mediaType: 'audio' },
        { id: 'files:audio/song2.mp3', title: 'Song 2', mediaUrl: '/proxy/media/stream/audio/song2.mp3', mediaType: 'audio' }
      ]);

      const res = await request(app).get('/api/play/files/audio/shuffle');

      expect(res.status).toBe(200);
      expect(mockMediaAdapter.resolvePlayables).toHaveBeenCalled();
    });

    it('returns 404 when shuffle finds no playables', async () => {
      mockMediaAdapter.resolvePlayables.mockResolvedValue([]);

      const res = await request(app).get('/api/play/files/audio/shuffle');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No playable items found');
    });
  });
});
