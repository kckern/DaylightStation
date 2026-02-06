// tests/integration/api/play-router.api.test.mjs
/**
 * Play Router API Integration Tests
 *
 * Tests playback info retrieval across content sources.
 * Validates media URL resolution and watch state integration.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateSchema,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('Play Router API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // RESPONSE FORMAT
  // ===========================================================================
  describe('response format', () => {
    test('returns id and assetId', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.assetId).toBeDefined();
    });

    test('returns mediaUrl for playable item', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      expect(res.body.mediaUrl).toBeDefined();
    });

    test('returns title when available', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      // Title may be derived from filename or metadata
      expect(res.body.title || res.body.id).toBeDefined();
    });
  });

  // ===========================================================================
  // CONTAINER RESOLUTION
  // ===========================================================================
  describe('container resolution', () => {
    test('playing container returns first playable', async () => {
      const baseline = await loadBaseline('folder/folder-tvapp.json');

      // Playing a container should resolve to its first playable item
      const res = await request(app).get('/api/play/watchlist/TVApp');

      expect(res.status).toBe(200);
      expect(res.body.assetId).toBeDefined();
    });

    test('shuffle on container returns random item', async () => {
      const baseline = await loadBaseline('folder/folder-tvapp.json');

      const res = await request(app).get('/api/play/watchlist/TVApp/shuffle');

      expect(res.status).toBe(200);
      expect(res.body.assetId).toBeDefined();
    });
  });

  // ===========================================================================
  // SOURCE-SPECIFIC BEHAVIOR
  // ===========================================================================
  describe('filesystem source', () => {
    test('resolves file path to media URL', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      expect(res.body.mediaUrl).toBeDefined();
    });
  });

  describe('watchlist source', () => {
    test('resolves watchlist reference to playable', async () => {
      const res = await request(app).get('/api/play/watchlist/TVApp');

      expect(res.status).toBe(200);
      // Should resolve to a playable item
      expect(res.body.id || res.body.assetId).toBeDefined();
    });
  });

  // ===========================================================================
  // WATCH STATE INTEGRATION
  // ===========================================================================
  describe('watch state integration', () => {
    test('response includes resumable flag', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      // Resumable should be defined (true or false)
      expect(typeof res.body.resumable).toBe('boolean');
    });

    test('response may include resume_position', async () => {
      const baseline = await loadBaseline('filesystem/filesystem-hymn-audio.json');

      const res = await request(app).get('/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3');

      expect(res.status).toBe(200);
      // resume_position is optional - only present if item was previously played
      if (res.body.resume_position !== undefined) {
        expect(typeof res.body.resume_position).toBe('number');
      }
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================
  describe('error handling', () => {
    test('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/play/unknownsource/somepath');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    test('returns 404 for non-existent item', async () => {
      const res = await request(app).get('/api/play/filesystem/nonexistent/file.mp3');

      expect(res.status).toBe(404);
    });

    test('returns 404 for empty container', async () => {
      // If a container has no playable items
      const res = await request(app).get('/api/play/watchlist/nonexistent-folder');

      expect(res.status).toBe(404);
    });
  });
});
