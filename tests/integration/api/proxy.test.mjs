// tests/integration/api/proxy.test.mjs
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from '../../../backend/src/api/routers/proxy.mjs';
import { ContentSourceRegistry } from '../../../backend/src/domains/content/services/ContentSourceRegistry.mjs';
import { FilesystemAdapter } from '../../../backend/src/adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Proxy Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FilesystemAdapter({ mediaBasePath: fixturesPath }));

    app = express();
    app.use('/proxy', createProxyRouter({ registry }));
  });

  test('GET /proxy/filesystem/stream/* streams file', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
  });

  test('GET /proxy/filesystem/stream/* handles range requests', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/audio/test.mp3')
      .set('Range', 'bytes=0-10');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-10\//);
  });

  test('GET /proxy/filesystem/stream/* returns 404 for missing file', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/nonexistent.mp3');

    expect(res.status).toBe(404);
  });

  test('GET /proxy/filesystem/stream/* streams video file', async () => {
    const res = await request(app)
      .get('/proxy/filesystem/stream/video/test.mp4');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  test('GET /proxy/plex/stream/:ratingKey returns 404 when plex not configured', async () => {
    const res = await request(app)
      .get('/proxy/plex/stream/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Plex adapter not configured');
  });
});
