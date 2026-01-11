// tests/integration/api/content.test.mjs
import express from 'express';
import request from 'supertest';
import { createContentRouter } from '../../../backend/src/api/routers/content.mjs';
import { ContentSourceRegistry } from '../../../backend/src/domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Content API Router', () => {
  let app;
  let registry;

  beforeAll(() => {
    registry = new ContentSourceRegistry();
    registry.register(new FilesystemAdapter({ mediaBasePath: fixturesPath }));

    app = express();
    app.use('/api/content', createContentRouter(registry));
  });

  test('GET /api/content/list/filesystem/:path returns directory listing', async () => {
    const res = await request(app).get('/api/content/list/filesystem/audio');

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('GET /api/content/item/filesystem/:path returns item info', async () => {
    const res = await request(app).get('/api/content/item/filesystem/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('filesystem:audio/test.mp3');
    expect(res.body.source).toBe('filesystem');
  });

  test('GET /api/content/item returns 404 for missing', async () => {
    const res = await request(app).get('/api/content/item/filesystem/nonexistent.mp3');

    expect(res.status).toBe(404);
  });

  test('GET /api/content/list returns 404 for unknown source', async () => {
    const res = await request(app).get('/api/content/list/unknown/somepath');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });

  test('GET /api/content/playables/filesystem/:path returns playable items', async () => {
    const res = await request(app).get('/api/content/playables/filesystem/audio');

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
