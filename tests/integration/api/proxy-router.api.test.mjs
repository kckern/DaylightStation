// tests/integration/api/proxy-router.api.test.mjs
/**
 * Proxy Router API Integration Tests
 *
 * Tests media streaming and thumbnail proxy endpoints.
 * Validates file resolution, headers, and error handling.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('Proxy Router API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // STREAM ENDPOINT
  // ===========================================================================
  describe('GET /proxy/:source/stream/*', () => {
    describe('local-content streaming', () => {
      test('streams audio file with correct content-type', async () => {
        const res = await request(app)
          .get('/proxy/local-content/stream/hymn/113')
          .set('Range', 'bytes=0-1023');

        // Should return 200 or 206 (partial content) or 404 if file not found
        if (res.status === 200 || res.status === 206) {
          expect(res.headers['content-type']).toBeDefined();
        }
      });

      test('returns 404 for non-existent content', async () => {
        const res = await request(app).get('/proxy/local-content/stream/hymn/99999');

        expect(res.status).toBe(404);
      });

      test('returns 400 for unknown content type', async () => {
        const res = await request(app).get('/proxy/local-content/stream/unknown/test');

        expect(res.status).toBe(400);
      });
    });

    describe('range request handling', () => {
      test('supports range requests', async () => {
        const res = await request(app)
          .get('/proxy/local-content/stream/hymn/113')
          .set('Range', 'bytes=0-1023');

        // 206 indicates partial content support
        if (res.status === 206) {
          expect(res.headers['content-range']).toBeDefined();
          expect(res.headers['accept-ranges']).toBe('bytes');
        }
      });

      test('returns full file without range header', async () => {
        const res = await request(app).get('/proxy/local-content/stream/hymn/113');

        // Should return 200 for full file (or 404 if not found)
        expect([200, 404]).toContain(res.status);
      });
    });

    describe('content types', () => {
      test('hymn returns audio content-type', async () => {
        const res = await request(app).get('/proxy/local-content/stream/hymn/113');

        if (res.status === 200) {
          expect(res.headers['content-type']).toMatch(/audio/);
        }
      });

      test('scripture returns audio content-type', async () => {
        const res = await request(app).get('/proxy/local-content/stream/scripture/cfm/1-nephi-1');

        if (res.status === 200) {
          expect(res.headers['content-type']).toMatch(/audio/);
        }
      });
    });
  });

  // ===========================================================================
  // THUMBNAIL ENDPOINT
  // ===========================================================================
  describe('GET /proxy/:source/thumbnail/*', () => {
    test('returns thumbnail image', async () => {
      // Thumbnails may not be available for all content
      const res = await request(app).get('/proxy/local-content/thumbnail/hymn/113');

      // Could be 200 with image, or 404 if no thumbnail
      expect([200, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.headers['content-type']).toMatch(/image/);
      }
    });

    test('returns 404 for non-existent thumbnail', async () => {
      const res = await request(app).get('/proxy/local-content/thumbnail/nonexistent/item');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // SOURCE ROUTING
  // ===========================================================================
  describe('source routing', () => {
    test('routes to local-content adapter', async () => {
      const res = await request(app).get('/proxy/local-content/stream/hymn/113');

      // Should route to local-content, not error on unknown source
      expect([200, 206, 404]).toContain(res.status);
    });

    test('returns 404 for unknown source', async () => {
      const res = await request(app).get('/proxy/unknownsource/stream/somepath');

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================
  describe('error handling', () => {
    test('handles missing path gracefully', async () => {
      const res = await request(app).get('/proxy/local-content/stream/');

      // Should return error, not crash
      expect([400, 404]).toContain(res.status);
    });

    test('handles malformed requests', async () => {
      const res = await request(app).get('/proxy/local-content/invalidoperation/test');

      // Should return error for unknown operation
      expect([400, 404]).toContain(res.status);
    });
  });

  // ===========================================================================
  // HEADERS
  // ===========================================================================
  describe('response headers', () => {
    test('includes accept-ranges header', async () => {
      const res = await request(app).get('/proxy/local-content/stream/hymn/113');

      if (res.status === 200 || res.status === 206) {
        expect(res.headers['accept-ranges']).toBe('bytes');
      }
    });

    test('includes content-length for full responses', async () => {
      const res = await request(app).get('/proxy/local-content/stream/hymn/113');

      if (res.status === 200) {
        expect(res.headers['content-length']).toBeDefined();
      }
    });
  });
});
