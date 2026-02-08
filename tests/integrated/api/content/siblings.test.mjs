// tests/integration/api/siblings.test.mjs
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSiblingsRouter } from '#backend/src/4_api/v1/routers/siblings.mjs';
import { SiblingsService } from '#apps/content/services/SiblingsService.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures/media');

describe('Siblings API Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: fixturesPath }));

    const siblingsService = new SiblingsService({ registry });

    app = express();
    app.use(express.json());
    app.use('/api/v1/siblings', createSiblingsRouter({ siblingsService }));
  });

  test('GET /api/v1/siblings/files/:path returns siblings for files', async () => {
    const res = await request(app).get('/api/v1/siblings/files/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.parent?.id).toBe('files:audio');
  });

  test('GET /api/v1/siblings returns 404 for unknown source', async () => {
    const res = await request(app).get('/api/v1/siblings/unknown/item');

    expect(res.status).toBe(404);
  });
});
