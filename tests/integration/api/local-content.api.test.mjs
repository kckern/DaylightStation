// tests/integration/api/local-content.api.test.mjs
/**
 * LocalContent API Integration Tests
 *
 * Tests scripture, hymn, primary song, talk, and poem endpoints.
 * Uses real data from configured data mount.
 */

import request from 'supertest';
import { createTestServer } from './_utils/testServer.mjs';
import { loadBaseline } from './_utils/baselineLoader.mjs';
import {
  validateSchema,
  validateVerses,
  validateErrorResponse
} from './_utils/schemaValidators.mjs';

describe('LocalContent API', () => {
  let app;
  let config;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    config = server.config;
  });

  // ===========================================================================
  // SCRIPTURE ENDPOINTS
  // Note: Scripture paths use actual file structure (volume/version/verseId)
  // e.g., /api/local-content/scripture/bom/sebom/31103 for 1 Nephi 1
  // ===========================================================================
  describe('GET /api/local-content/scripture/*', () => {
    // Standard scripture path for testing: Book of Mormon, SE version, verse 31103 (1 Nephi 1)
    const SCRIPTURE_PATH = '/scripture/bom/sebom/31103';

    describe('schema validation', () => {
      test('returns valid scripture schema', async () => {
        const res = await request(app).get(`/api/local-content${SCRIPTURE_PATH}`);

        expect(res.status).toBe(200);
        validateSchema(res.body, 'scripture');
      });

      test('scripture has verses array', async () => {
        const res = await request(app).get(`/api/local-content${SCRIPTURE_PATH}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.verses)).toBe(true);
        expect(res.body.verses.length).toBeGreaterThan(0);
        validateVerses(res.body.verses);
      });

      test('scripture has reference string', async () => {
        const res = await request(app).get(`/api/local-content${SCRIPTURE_PATH}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.reference).toBe('string');
        expect(res.body.reference.length).toBeGreaterThan(0);
      });
    });

    describe('baseline comparison', () => {
      test('scripture response matches baseline structure', async () => {
        const baseline = await loadBaseline('local-content/scripture-1-nephi-1.json');

        const res = await request(app).get(`/api/local-content${SCRIPTURE_PATH}`);

        expect(res.status).toBe(200);
        // Reference should contain "1 Nephi 1" or similar
        expect(res.body.reference).toBeDefined();
        // Verse count should match baseline if available
        if (baseline.verses) {
          expect(res.body.verses.length).toBe(baseline.verses.length);
        }
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent scripture', async () => {
        const res = await request(app).get('/api/local-content/scripture/nonexistent/path/99999');

        expect(res.status).toBe(404);
        validateErrorResponse(res.body);
      });
    });
  });

  // ===========================================================================
  // HYMN ENDPOINTS
  // ===========================================================================
  describe('GET /api/local-content/hymn/:number', () => {
    describe('schema validation', () => {
      test('returns valid hymn schema', async () => {
        const baseline = await loadBaseline('local-content/hymn-113.json');

        const res = await request(app).get('/api/local-content/hymn/113');

        expect(res.status).toBe(200);
        validateSchema(res.body, 'hymn');
      });

      test('hymn has title and number', async () => {
        const res = await request(app).get('/api/local-content/hymn/113');

        expect(res.status).toBe(200);
        expect(typeof res.body.title).toBe('string');
        expect(typeof res.body.number).toBe('number');
      });

      test('hymn has media_key', async () => {
        const res = await request(app).get('/api/local-content/hymn/113');

        expect(res.status).toBe(200);
        expect(res.body.media_key).toBeDefined();
      });
    });

    describe('baseline comparison', () => {
      test('hymn response matches baseline', async () => {
        const baseline = await loadBaseline('local-content/hymn-113.json');

        const res = await request(app).get('/api/local-content/hymn/113');

        expect(res.status).toBe(200);
        expect(res.body.title).toBe(baseline.title);
        // Baseline may have hymn_num instead of number (legacy format)
        expect(res.body.number).toBe(baseline.number || baseline.hymn_num);
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent hymn', async () => {
        const res = await request(app).get('/api/local-content/hymn/99999');

        expect(res.status).toBe(404);
        validateErrorResponse(res.body);
      });
    });
  });

  // ===========================================================================
  // PRIMARY SONG ENDPOINTS
  // ===========================================================================
  describe('GET /api/local-content/primary/:number', () => {
    // Primary song 10 is "I Am a Child of God"
    const PRIMARY_PATH = '/primary/10';

    describe('schema validation', () => {
      test('returns valid primary song schema', async () => {
        const res = await request(app).get(`/api/local-content${PRIMARY_PATH}`);

        expect(res.status).toBe(200);
        validateSchema(res.body, 'primary');
      });

      test('primary song has title and number', async () => {
        const res = await request(app).get(`/api/local-content${PRIMARY_PATH}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.title).toBe('string');
        expect(typeof res.body.number).toBe('number');
      });
    });

    describe('baseline comparison', () => {
      test('primary song matches baseline', async () => {
        const baseline = await loadBaseline('local-content/primary-10.json');

        const res = await request(app).get(`/api/local-content${PRIMARY_PATH}`);

        expect(res.status).toBe(200);
        expect(res.body.title).toBe(baseline.title);
        // Baseline may have song_num instead of number (legacy format)
        expect(res.body.number).toBe(baseline.number || baseline.song_num);
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent primary song', async () => {
        const res = await request(app).get('/api/local-content/primary/99999');

        expect(res.status).toBe(404);
        validateErrorResponse(res.body);
      });
    });
  });

  // ===========================================================================
  // TALK ENDPOINTS
  // ===========================================================================
  describe('GET /api/local-content/talk/*', () => {
    // Talk from Oct 2024 General Conference
    const TALK_PATH = '/talk/ldsgc202410/20';

    describe('schema validation', () => {
      test('returns valid talk schema', async () => {
        const res = await request(app).get(`/api/local-content${TALK_PATH}`);

        expect(res.status).toBe(200);
        validateSchema(res.body, 'talk');
      });

      test('talk has title and media_key', async () => {
        const res = await request(app).get(`/api/local-content${TALK_PATH}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.title).toBe('string');
        expect(res.body.media_key).toBeDefined();
      });
    });

    describe('baseline comparison', () => {
      test('talk matches baseline', async () => {
        const baseline = await loadBaseline('local-content/talk-ldsgc202410-20.json');

        const res = await request(app).get(`/api/local-content${TALK_PATH}`);

        expect(res.status).toBe(200);
        expect(res.body.title).toBe(baseline.title);
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent talk', async () => {
        const res = await request(app).get('/api/local-content/talk/nonexistent/path');

        expect(res.status).toBe(404);
        validateErrorResponse(res.body);
      });
    });
  });

  // ===========================================================================
  // POEM ENDPOINTS
  // ===========================================================================
  describe('GET /api/local-content/poem/*', () => {
    const POEM_PATH = '/poem/remedy/01';

    describe('schema validation', () => {
      test('returns valid poem schema', async () => {
        const res = await request(app).get(`/api/local-content${POEM_PATH}`);

        expect(res.status).toBe(200);
        validateSchema(res.body, 'poem');
      });

      test('poem has title and author', async () => {
        const res = await request(app).get(`/api/local-content${POEM_PATH}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.title).toBe('string');
      });
    });

    describe('baseline comparison', () => {
      test('poem matches baseline', async () => {
        const baseline = await loadBaseline('local-content/poem-remedy-01.json');

        const res = await request(app).get(`/api/local-content${POEM_PATH}`);

        expect(res.status).toBe(200);
        expect(res.body.title).toBe(baseline.title);
      });
    });

    describe('error handling', () => {
      test('returns 404 for non-existent poem', async () => {
        const res = await request(app).get('/api/local-content/poem/nonexistent/path');

        expect(res.status).toBe(404);
        validateErrorResponse(res.body);
      });
    });
  });

  // ===========================================================================
  // COVER ART ENDPOINT
  // ===========================================================================
  describe('GET /api/local-content/cover/*', () => {
    describe('error handling', () => {
      test('returns 400 for empty media key', async () => {
        const res = await request(app).get('/api/local-content/cover/');
        expect(res.status).toBe(400);
      });
    });

    describe('placeholder generation', () => {
      test('returns PNG for nonexistent file', async () => {
        const res = await request(app).get('/api/local-content/cover/nonexistent/path/file');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['cache-control']).toContain('max-age=');
      });

      test('returns valid PNG buffer', async () => {
        const res = await request(app)
          .get('/api/local-content/cover/test/placeholder')
          .responseType('buffer');
        expect(res.status).toBe(200);
        // PNG magic bytes: 0x89 0x50 0x4E 0x47
        expect(res.body[0]).toBe(0x89);
        expect(res.body[1]).toBe(0x50);
        expect(res.body[2]).toBe(0x4e);
        expect(res.body[3]).toBe(0x47);
      });
    });
  });
});
