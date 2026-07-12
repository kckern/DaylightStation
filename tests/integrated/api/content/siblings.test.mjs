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

// Minimal adapter that exercises the ancestors passthrough path. Returns a
// well-formed root-first ancestor chain for one id, and none for another.
const mockBreadcrumbAdapter = {
  source: 'mock',
  prefixes: [{ prefix: 'mock' }],
  async getItem() { return null; },
  async getList() { return []; },
  async resolvePlayables() { return []; },
  async resolveSiblings(compoundId) {
    if (compoundId === 'mock:with-anc') {
      return {
        parent: { id: 'mock:season', title: 'Season 8', source: 'mock' },
        items: [
          { id: 'mock:e1', title: 'Episode 1' },
          { id: 'mock:with-anc', title: 'Episode 2' }
        ],
        ancestors: [
          { id: 'mock:col', title: 'Old Testament', source: 'mock', localId: 'col', type: 'collection' },
          { id: 'mock:show', title: 'The Prophets', source: 'mock', localId: 'show', type: 'show' },
          { id: 'mock:season', title: 'Season 8', source: 'mock', localId: 'season', type: 'season' }
        ]
      };
    }
    return {
      parent: { id: 'mock:parent', title: 'Parent', source: 'mock' },
      items: [{ id: 'mock:no-anc', title: 'Only Child' }]
    };
  }
};

describe('Siblings API Router', () => {
  let app;

  beforeAll(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: fixturesPath }));
    registry.register(mockBreadcrumbAdapter);

    const siblingsService = new SiblingsService({ registry });

    // Resolver stub: no aliasing — fall back to the parsed source/localId
    // (mirrors production wiring, which always passes a contentIdResolver).
    const contentIdResolver = { resolve: () => null };

    app = express();
    app.use(express.json());
    app.use('/api/v1/siblings', createSiblingsRouter({ siblingsService, contentIdResolver }));
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

  test('includes ancestors when the adapter returns a chain', async () => {
    const res = await request(app).get('/api/v1/siblings/mock/with-anc');

    expect(res.status).toBe(200);
    expect(res.body.ancestors).toEqual([
      { id: 'mock:col', title: 'Old Testament', source: 'mock', localId: 'col', type: 'collection' },
      { id: 'mock:show', title: 'The Prophets', source: 'mock', localId: 'show', type: 'show' },
      { id: 'mock:season', title: 'Season 8', source: 'mock', localId: 'season', type: 'season' }
    ]);
  });

  test('omits ancestors when the adapter does not return a chain', async () => {
    const res = await request(app).get('/api/v1/siblings/mock/no-anc');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).not.toHaveProperty('ancestors');
  });
});
