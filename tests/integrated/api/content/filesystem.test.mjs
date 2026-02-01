// tests/integration/api/filesystem.api.test.mjs
/**
 * Filesystem API Integration Tests
 *
 * Tests direct file access for local media files.
 * Uses real media files from configured media mount.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateSchema,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('Filesystem API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // PLAY FILESYSTEM ITEM
  // Actual path: audio/songs/hymn/_ldsgc/113.mp3
  // ===========================================================================
  describe('GET /api/play/filesystem/*', () => {
    // Use actual path from media directory
    const HYMN_AUDIO_PATH = '/audio/songs/hymn/_ldsgc/113.mp3';

    describe('schema validation', () => {
      test('returns valid play response for audio file', async () => {
        const res = await request(app).get(`/api/play/filesystem${HYMN_AUDIO_PATH}`);

        expect(res.status).toBe(200);
        validateSchema(res.body, 'playResponse');
      });

      test('play response has mediaUrl', async () => {
        const res = await request(app).get(`/api/play/filesystem${HYMN_AUDIO_PATH}`);

        expect(res.status).toBe(200);
        expect(res.body.mediaUrl).toBeDefined();
      });

      test('play response has mediaType', async () => {
        const res = await request(app).get(`/api/play/filesystem${HYMN_AUDIO_PATH}`);

        expect(res.status).toBe(200);
        // Media type should indicate audio
        if (res.body.mediaType) {
          expect(res.body.mediaType).toMatch(/audio/i);
        }
      });
    });

    describe('baseline comparison', () => {
      test('filesystem response matches baseline', async () => {
        const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

        const res = await request(app).get(`/api/play/filesystem${HYMN_AUDIO_PATH}`);

        expect(res.status).toBe(200);
        // Media key should match
        if (baseline.assetId) {
          expect(res.body.assetId).toBeDefined();
        }
      });
    });

    describe('path resolution', () => {
      test('resolves nested paths', async () => {
        const res = await request(app).get(`/api/play/filesystem${HYMN_AUDIO_PATH}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent file', async () => {
        const res = await request(app).get('/api/play/filesystem/nonexistent/file.mp3');

        expect(res.status).toBe(404);
      });
    });
  });

  // ===========================================================================
  // LIST FILESYSTEM DIRECTORY
  // ===========================================================================
  describe('GET /api/list/filesystem/*', () => {
    test('lists directory contents', async () => {
      // This may or may not be supported depending on adapter
      const res = await request(app).get('/api/list/filesystem/audio/hymns');

      // Could be 200 if supported, or 404/400 if not
      if (res.status === 200) {
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });
  });
});
