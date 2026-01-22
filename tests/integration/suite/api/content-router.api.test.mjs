// tests/integration/api/content-router.api.test.mjs
/**
 * Content Router API Integration Tests
 *
 * Tests generic content operations: list, item, playables, progress.
 * This is the lower-level API used by list and play routers.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateSchema,
  validateListItems,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('Content Router API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // LIST OPERATION
  // ===========================================================================
  describe('GET /api/content/list/:source/*', () => {
    test('lists items from local-content source', async () => {
      const res = await request(app).get('/api/content/list/local-content/talk:general');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('source');
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });

    test('list response has source field', async () => {
      const res = await request(app).get('/api/content/list/local-content/talk:general');

      if (res.status === 200) {
        expect(res.body.source).toBe('local-content');
      }
    });

    test('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/content/list/unknownsource/path');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // ITEM OPERATION
  // ===========================================================================
  describe('GET /api/content/item/:source/*', () => {
    test('gets single item from local-content', async () => {
      const res = await request(app).get('/api/content/item/local-content/hymn:113');

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
    });

    test('item has expected properties', async () => {
      const res = await request(app).get('/api/content/item/local-content/hymn:113');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('title');
    });

    test('returns 404 for non-existent item', async () => {
      const res = await request(app).get('/api/content/item/local-content/hymn:99999');

      expect(res.status).toBe(404);
    });

    test('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/content/item/unknownsource/someid');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // PLAYABLES OPERATION
  // ===========================================================================
  describe('GET /api/content/playables/:source/*', () => {
    test('resolves container to playables', async () => {
      const res = await request(app).get('/api/content/playables/local-content/talk:general');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });

    test('playables response has source', async () => {
      const res = await request(app).get('/api/content/playables/local-content/talk:general');

      if (res.status === 200) {
        expect(res.body.source).toBe('local-content');
      }
    });
  });

  // ===========================================================================
  // PROGRESS OPERATION
  // ===========================================================================
  describe('POST /api/content/progress/:source/*', () => {
    test('saves watch progress', async () => {
      const res = await request(app)
        .post('/api/content/progress/local-content/hymn:113')
        .send({
          seconds: 30,
          duration: 180
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('itemId');
      expect(res.body).toHaveProperty('playhead');
    });

    test('progress response includes percent', async () => {
      const res = await request(app)
        .post('/api/content/progress/local-content/hymn:113')
        .send({
          seconds: 90,
          duration: 180
        });

      expect(res.status).toBe(200);
      expect(res.body.percent).toBeDefined();
      expect(res.body.percent).toBeCloseTo(50, 0);
    });

    test('progress response includes watched flag', async () => {
      // Set progress to near end
      const res = await request(app)
        .post('/api/content/progress/local-content/hymn:113')
        .send({
          seconds: 175,
          duration: 180
        });

      expect(res.status).toBe(200);
      expect(typeof res.body.watched).toBe('boolean');
    });

    test('requires seconds and duration', async () => {
      const res = await request(app)
        .post('/api/content/progress/local-content/hymn:113')
        .send({});

      expect(res.status).toBe(400);
    });

    test('returns 404 for unknown source', async () => {
      const res = await request(app)
        .post('/api/content/progress/unknownsource/item')
        .send({
          seconds: 30,
          duration: 180
        });

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // SCHEMA VALIDATION
  // ===========================================================================
  describe('schema validation', () => {
    test('progress response matches schema', async () => {
      const res = await request(app)
        .post('/api/content/progress/local-content/hymn:113')
        .send({
          seconds: 60,
          duration: 180
        });

      expect(res.status).toBe(200);
      validateSchema(res.body, 'progressResponse');
    });
  });
});
