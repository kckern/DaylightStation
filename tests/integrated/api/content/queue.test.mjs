// tests/integration/api/queue.test.mjs
import { describe, test, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createQueueRouter, toQueueItem } from '#backend/src/4_api/v1/routers/queue.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { ContentIdResolver } from '#apps/content/ContentIdResolver.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { QueueService } from '#domains/content/services/QueueService.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Queue API Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: fixturesPath }));
    const contentIdResolver = new ContentIdResolver(registry);

    app = express();
    app.use(express.json());
    const queueService = new QueueService({ mediaProgressMemory: null });
    app.use('/api/v1/queue', createQueueRouter({ contentIdResolver, queueService }));
  });

  test('GET /api/v1/queue/files/:path returns queue items', async () => {
    const res = await request(app).get('/api/v1/queue/files/audio');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('totalDuration');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(res.body.count);
    if (res.body.items.length > 0) {
      expect(res.body.items[0]).toHaveProperty('mediaUrl');
    }
  });

  test('GET /api/v1/queue/files/:path applies limit', async () => {
    const res = await request(app).get('/api/v1/queue/files/audio?limit=1');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items.length).toBe(1);
  });

  test('GET /api/v1/queue returns 404 for unknown source', async () => {
    const res = await request(app).get('/api/v1/queue/unknown/something');

    expect(res.status).toBe(404);
  });

  test('queue items include contentId and format fields', async () => {
    const res = await request(app).get('/api/v1/queue/files/audio');

    expect(res.status).toBe(200);
    if (res.body.items.length > 0) {
      const item = res.body.items[0];
      expect(item).toHaveProperty('contentId');
      expect(item).toHaveProperty('format');
      expect(item).toHaveProperty('image');
      expect(item).toHaveProperty('active');
    }
  });

  test('GET /api/v1/queue/:source resolves compound IDs in source segment', async () => {
    // Compound ID in source position: files:audio
    const res = await request(app).get('/api/v1/queue/files:audio');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('source', 'files');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('toQueueItem includes contentId, format, image, and active fields', () => {
    const mockItem = {
      id: 'files:audio/test.mp3',
      title: 'Test Song',
      source: 'files',
      mediaUrl: '/api/v1/proxy/media/stream/test.mp3',
      mediaType: 'audio',
      thumbnail: '/api/v1/local-content/cover/test.mp3',
      duration: 120,
      resumable: false,
      resumePosition: null,
      watchProgress: null,
      metadata: {
        format: 'audio/mpeg',
        artist: 'Test Artist',
        albumArtist: 'Test Album Artist',
        album: 'Test Album',
        parentTitle: 'Audio',
        grandparentTitle: 'Media',
      }
    };

    const result = toQueueItem(mockItem);

    expect(result).toHaveProperty('contentId');
    expect(result.contentId).toBe('files:audio/test.mp3');
    expect(result).toHaveProperty('format');
    expect(result.format).toBe('audio/mpeg');
    expect(result).toHaveProperty('image');
    expect(result.image).toBe('/api/v1/local-content/cover/test.mp3');
    expect(result).toHaveProperty('active');
    expect(result.active).toBe(true);
    expect(result).toHaveProperty('artist');
    expect(result.artist).toBe('Test Artist');
    expect(result).toHaveProperty('albumArtist');
    expect(result.albumArtist).toBe('Test Album Artist');
    expect(result).toHaveProperty('album');
    expect(result.album).toBe('Test Album');
  });
});
