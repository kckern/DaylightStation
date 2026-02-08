// tests/integration/api/content.test.mjs
import express from 'express';
import request from 'supertest';
import { createContentRouter } from '#backend/src/4_api/v1/routers/content.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { YamlWatchStateDatastore } from '#adapters/persistence/yaml/YamlWatchStateDatastore.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');
const watchStatePath = path.resolve(__dirname, '../../_fixtures/watch-state');

describe('Content API Router', () => {
  let app;
  let registry;
  let watchStore;

  beforeAll(() => {
    registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: fixturesPath }));
    watchStore = new YamlWatchStateDatastore({ basePath: watchStatePath });

    app = express();
    app.use(express.json());
    app.use('/api/content', createContentRouter(registry, watchStore));
  });

  test('GET /api/content/list/files/:path returns directory listing', async () => {
    const res = await request(app).get('/api/content/list/files/audio');

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('GET /api/content/item/files/:path returns item info', async () => {
    const res = await request(app).get('/api/content/item/files/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('files:audio/test.mp3');
    expect(res.body.source).toBe('files');
  });

  test('GET /api/content/item returns 404 for missing', async () => {
    const res = await request(app).get('/api/content/item/files/nonexistent.mp3');

    expect(res.status).toBe(404);
  });

  test('GET /api/content/list returns 404 for unknown source', async () => {
    const res = await request(app).get('/api/content/list/unknown/somepath');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });

  test('GET /api/content/playables/files/:path redirects to queue', async () => {
    const res = await request(app).get('/api/content/playables/files/audio');

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe('/api/v1/queue/files/audio');
    expect(res.headers.deprecation).toBe('true');
  });

  test('POST /api/content/progress/:source/* updates watch state', async () => {
    const res = await request(app)
      .post('/api/content/progress/files/audio/test.mp3')
      .send({ seconds: 90, duration: 180 });

    expect(res.status).toBe(200);
    expect(res.body.itemId).toBe('files:audio/test.mp3');
    expect(res.body.playhead).toBe(90);
    expect(res.body.duration).toBe(180);
    expect(res.body.percent).toBe(50);
    expect(res.body.watched).toBe(false);
  });

  test('POST /api/content/progress returns 400 for missing params', async () => {
    const res = await request(app)
      .post('/api/content/progress/files/audio/test.mp3')
      .send({ seconds: 90 }); // missing duration

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('seconds and duration are required');
  });

  test('POST /api/content/progress returns 404 for unknown source', async () => {
    const res = await request(app)
      .post('/api/content/progress/unknown/somepath')
      .send({ seconds: 90, duration: 180 });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });
});
