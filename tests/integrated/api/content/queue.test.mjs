// tests/integration/api/queue.test.mjs
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createQueueRouter } from '#backend/src/4_api/v1/routers/queue.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Queue API Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: fixturesPath }));

    app = express();
    app.use(express.json());
    app.use('/api/v1/queue', createQueueRouter({ registry }));
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
});
