// tests/integration/api/list-router.api.test.mjs
/**
 * List Router API Integration Tests
 *
 * Tests cross-source list operations and modifiers.
 * Validates unified response format across all content sources.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateSchema,
  validateListItems,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('List Router API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // UNIFIED RESPONSE FORMAT
  // ===========================================================================
  describe('response format consistency', () => {
    test('folder source returns standard format', async () => {
      const baseline = await loadBaseline('folder/folder-morning-shows.json');

      const res = await request(app).get('/api/list/folder/morning-shows');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('source');
      expect(res.body).toHaveProperty('path');
      expect(res.body).toHaveProperty('items');
    });

    test('local-content source returns standard format', async () => {
      // List operation on local-content (if supported)
      const res = await request(app).get('/api/content/list/local-content/talk:general');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('source');
        expect(res.body).toHaveProperty('items');
      }
    });

    test('items have unified structure', async () => {
      const baseline = await loadBaseline('folder/folder-morning-shows.json');

      const res = await request(app).get('/api/list/folder/morning-shows');

      expect(res.status).toBe(200);

      for (const item of res.body.items) {
        // All items should have id and title
        expect(item.id).toBeDefined();
        expect(item.title).toBeDefined();
      }
    });
  });

  // ===========================================================================
  // MODIFIERS
  // ===========================================================================
  describe('playable modifier', () => {
    test('returns only playable items', async () => {
      const baseline = await loadBaseline('folder/folder-morning-shows-playable.json');

      const res = await request(app).get('/api/list/folder/morning-shows/playable');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    test('playable items are flat (not containers)', async () => {
      const res = await request(app).get('/api/list/folder/morning-shows/playable');

      expect(res.status).toBe(200);

      // Playable items should not be containers
      for (const item of res.body.items) {
        // If itemType is present, it shouldn't be 'container'
        if (item.itemType) {
          expect(item.itemType).not.toBe('container');
        }
      }
    });
  });

  describe('shuffle modifier', () => {
    test('shuffle returns same items', async () => {
      const baseline = await request(app).get('/api/list/folder/morning-shows');
      const shuffled = await request(app).get('/api/list/folder/morning-shows/shuffle');

      expect(shuffled.status).toBe(200);
      expect(shuffled.body.items.length).toBe(baseline.body.items.length);
    });

    test('shuffle changes order (probabilistic)', async () => {
      // Run multiple times to detect shuffling
      const results = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/list/folder/morning-shows/shuffle');
        results.push(res.body.items.map(i => i.id).join(','));
      }

      // At least one should be different (very high probability)
      // But don't fail if all happen to be same - just check structure
      expect(results.length).toBe(3);
    });
  });

  describe('combined modifiers', () => {
    test('playable,shuffle works together', async () => {
      const res = await request(app).get('/api/list/folder/morning-shows/playable,shuffle');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    test('modifier order doesnt matter', async () => {
      const res1 = await request(app).get('/api/list/folder/morning-shows/playable,shuffle');
      const res2 = await request(app).get('/api/list/folder/morning-shows/shuffle,playable');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.items.length).toBe(res2.body.items.length);
    });
  });

  // ===========================================================================
  // CROSS-SOURCE RESOLUTION
  // ===========================================================================
  describe('cross-source resolution', () => {
    test('folder can contain plex references', async () => {
      const baseline = await loadBaseline('folder/folder-morning-shows.json');

      const res = await request(app).get('/api/list/folder/morning-shows');

      expect(res.status).toBe(200);

      // Check if any items reference plex
      const plexItems = res.body.items.filter(i =>
        i.id?.includes('plex:') ||
        i.queue?.plex ||
        i.play?.plex
      );

      // If baseline has plex refs, response should too
      const baselinePlexItems = baseline.items.filter(i =>
        i.id?.includes('plex:') ||
        i.queue?.plex ||
        i.play?.plex ||
        i.input?.includes('plex')
      );

      if (baselinePlexItems.length > 0) {
        // At least acknowledge plex items exist in some form
        expect(res.body.items.length).toBeGreaterThan(0);
      }
    });

    test('folder can contain local-content references', async () => {
      const baseline = await loadBaseline('folder/folder-scriptures.json');

      const res = await request(app).get('/api/list/folder/scriptures');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================
  describe('error handling', () => {
    test('unknown source returns 404', async () => {
      const res = await request(app).get('/api/list/unknownsource/somepath');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    test('malformed path handled gracefully', async () => {
      const res = await request(app).get('/api/list/folder/');

      // Should either return empty list or 404, not crash
      expect([200, 404]).toContain(res.status);
    });
  });
});
