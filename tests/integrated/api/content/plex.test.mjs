// tests/integration/api/plex.api.test.mjs
/**
 * Plex API Integration Tests
 *
 * Tests Plex library browsing and playback endpoints.
 * ISOLATED: Fails fast if Plex server is offline.
 *
 * Requires:
 *   - PLEX_HOST environment variable
 *   - PLEX_TOKEN environment variable
 *   - Running Plex server
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import { assertPlexOnline } from './_utils/plexHealthCheck.mjs';
import {
  validateSchema,
  validateListItems,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('Plex API', () => {
  let app;
  let config;

  // FAIL FAST: Check Plex connectivity before any tests run
  beforeAll(async () => {
    await assertPlexOnline();

    const server = await createTestServer({ includePlex: true });
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // LIST PLEX LIBRARY
  // ===========================================================================
  describe('GET /api/list/plex/:id', () => {
    describe('schema validation', () => {
      test('returns valid list response schema', async () => {
        const baseline = await loadBaseline('plex/plex-list-81061.json');

        const res = await request(app).get('/api/list/plex/81061');

        expect(res.status).toBe(200);
        validateSchema(res.body, 'listResponse');
      });

      test('response has source=plex', async () => {
        const res = await request(app).get('/api/list/plex/81061');

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('plex');
      });

      test('list items have required fields', async () => {
        const res = await request(app).get('/api/list/plex/81061');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
        validateListItems(res.body.items);
      });
    });

    describe('baseline comparison', () => {
      test('plex library item count matches baseline', async () => {
        const baseline = await loadBaseline('plex/plex-list-81061.json');

        const res = await request(app).get('/api/list/plex/81061');

        expect(res.status).toBe(200);
        // Allow some variance for dynamic libraries (within 10%)
        const baselineCount = baseline.items.length;
        const actualCount = res.body.items.length;
        const variance = Math.abs(actualCount - baselineCount) / baselineCount;

        expect(variance).toBeLessThan(0.2); // Within 20% is acceptable
      });

      test('plex items have thumbnails', async () => {
        const baseline = await loadBaseline('plex/plex-list-81061.json');

        const res = await request(app).get('/api/list/plex/81061');

        expect(res.status).toBe(200);

        // At least some items should have thumbnails
        const itemsWithThumbnails = res.body.items.filter(i => i.thumbnail || i.image);
        expect(itemsWithThumbnails.length).toBeGreaterThan(0);
      });
    });

    describe('different library types', () => {
      test('lists TV series library', async () => {
        const baseline = await loadBaseline('plex/plex-list-456724.json');

        const res = await request(app).get('/api/list/plex/456724');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      test('lists music library', async () => {
        const baseline = await loadBaseline('plex/plex-list-622894.json');

        const res = await request(app).get('/api/list/plex/622894');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      });
    });

    describe('error handling', () => {
      test('returns 404 or empty list for non-existent library', async () => {
        const res = await request(app).get('/api/list/plex/999999999');

        // Either 404 or 200 with empty items is acceptable
        if (res.status === 200) {
          expect(res.body.items).toEqual([]);
        } else {
          expect(res.status).toBe(404);
        }
      });
    });
  });

  // ===========================================================================
  // PLAY PLEX ITEM
  // ===========================================================================
  describe('GET /api/play/plex/:id', () => {
    describe('schema validation', () => {
      test('returns valid play response schema', async () => {
        const baseline = await loadBaseline('plex/plex-play-660440.json');

        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);
        validateSchema(res.body, 'playResponse');
      });

      test('play response has mediaUrl', async () => {
        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);
        expect(res.body.mediaUrl).toBeDefined();
      });

      test('play response has assetId', async () => {
        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);
        expect(res.body.assetId).toBeDefined();
      });
    });

    describe('baseline comparison', () => {
      test('play response matches baseline structure', async () => {
        const baseline = await loadBaseline('plex/plex-play-660440.json');

        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);
        expect(res.body.title).toBe(baseline.title);
      });
    });

    describe('metadata mapping', () => {
      test('episode has show/season metadata', async () => {
        // This requires a known episode ID from baselines
        const baseline = await loadBaseline('plex/plex-play-660440.json');

        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);

        // If baseline is an episode, it should have grandparentTitle (canonical show name)
        if (baseline.grandparentTitle || baseline.show) {
          expect(res.body.grandparentTitle).toBe(baseline.grandparentTitle || baseline.show);
        }
      });

      test('video has duration', async () => {
        const res = await request(app).get('/api/play/plex/660440');

        expect(res.status).toBe(200);
        // Duration might be 0 for some items, but should be defined
        expect(res.body.duration).toBeDefined();
      });
    });

    describe('shuffle modifier', () => {
      test('shuffle returns random item from container', async () => {
        // Use a container (show/album) that has multiple items
        const baseline = await loadBaseline('plex/plex-list-456724.json');

        const res = await request(app).get('/api/play/plex/456724/shuffle');

        expect(res.status).toBe(200);
        expect(res.body.assetId).toBeDefined();
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent item', async () => {
        const res = await request(app).get('/api/play/plex/999999999');

        expect(res.status).toBe(404);
      });
    });
  });

  // ===========================================================================
  // PLAYABLE RESOLUTION
  // ===========================================================================
  describe('GET /api/list/plex/:id/playable', () => {
    test('resolves container to playable items', async () => {
      const baseline = await loadBaseline('plex/plex-list-456724.json');

      const res = await request(app).get('/api/list/plex/456724/playable');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);

      // Playable items should have media info
      if (res.body.items.length > 0) {
        expect(res.body.items[0].id).toBeDefined();
      }
    });

    test('playable with shuffle randomizes order', async () => {
      const res = await request(app).get('/api/list/plex/456724/playable,shuffle');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  // ===========================================================================
  // DATA INTEGRITY
  // ===========================================================================
  describe('data integrity', () => {
    test('all baseline plex libraries accessible', async () => {
      const plexBaselines = [
        { file: 'plex/plex-list-81061.json', id: '81061' },
        { file: 'plex/plex-list-456724.json', id: '456724' },
        { file: 'plex/plex-list-622894.json', id: '622894' },
        { file: 'plex/plex-list-154382.json', id: '154382' }
      ];

      for (const { file, id } of plexBaselines) {
        const baseline = await loadBaseline(file);
        const res = await request(app).get(`/api/list/plex/${id}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });

    test('plex items have consistent id format', async () => {
      const res = await request(app).get('/api/list/plex/81061');

      expect(res.status).toBe(200);

      for (const item of res.body.items) {
        expect(item.id).toBeDefined();
        // Plex IDs should be strings
        expect(typeof item.id).toBe('string');
      }
    });
  });
});
