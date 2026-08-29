// tests/integration/api/testDataService.integration.test.mjs
/**
 * testDataService Integration Tests
 *
 * Validates that testDataService works with the real local-content API router.
 * Checked-in content and registry fixtures keep this integrated test hermetic.
 */

import { jest } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import request from 'supertest';

jest.unstable_mockModule('music-metadata', () => ({ parseFile: jest.fn() }));

import {
  loadTestData,
  validateExpectations,
  clearCache,
  useTestDataRegistry,
} from '#testlib/testDataService.mjs';
const fixturesPath = path.resolve(process.cwd(), 'tests/_fixtures');
const testRegistry = {
  scripture: {
    default_expect: { reference: '/1 Nephi 1/i', verses: 'array' },
    preferred: [{ id: 'cfm/test-chapter' }],
  },
  hymn: {
    default_expect: { title: "Our Savior's Love", number: '>=1' },
    preferred: [{ id: '113' }],
  },
  plex: {
    default_expect: { title: 'string', type: 'movie|episode|track' },
    preferred: [{ id: 'fixture-plex-item' }],
  },
};

let app;

/**
 * Fetch JSON from an API endpoint
 * @param {string} path - API path (e.g., '/api/v1/local-content/scripture/1-nephi-1')
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function fetchJSON(path) {
  const response = await request(app).get(path);
  return {
    status: response.status,
    body: response.status >= 200 && response.status < 300 ? response.body : null,
  };
}

describe('testDataService Integration', () => {
  beforeAll(async () => {
    useTestDataRegistry(testRegistry);

    // Jest's VM-module linker cannot safely resolve this graph concurrently.
    const { createApiRouters } = await import('#composition/modules/contentApi.mjs');
    const { ContentSourceRegistry } = await import('#adapters/content/ContentSourceRegistry.mjs');
    const { LocalContentAdapter } = await import('#adapters/content/local-content/LocalContentAdapter.mjs');
    const { ScriptureResolver } = await import('#adapters/content/readalong/resolvers/scripture.mjs');
    const { YamlMediaProgressMemory } = await import('#adapters/persistence/yaml/YamlMediaProgressMemory.mjs');

    const mediaProgressMemory = new YamlMediaProgressMemory({
      basePath: path.join(fixturesPath, 'watch-state'),
    });
    const contentRegistry = new ContentSourceRegistry();
    contentRegistry.register(new LocalContentAdapter({
      dataPath: path.join(fixturesPath, 'local-content'),
      mediaPath: path.join(fixturesPath, 'media'),
      mediaProgressMemory,
      contentRegistry,
      scriptureResolver: ScriptureResolver,
    }), { category: 'local', provider: 'local-content' });

    const { routers } = createApiRouters({
      registry: contentRegistry,
      mediaProgressMemory,
      menuMemoryRepository: { load: () => ({}), save: () => undefined },
      dataPath: path.join(fixturesPath, 'local-content'),
      mediaBasePath: path.join(fixturesPath, 'media'),
      configService: { getAppConfig: () => ({}) },
    });

    app = express();
    app.use('/api/v1/local-content', routers.localContent);
  });

  afterAll(() => {
    useTestDataRegistry(null);
  });

  // ===========================================================================
  // SCRIPTURE
  // ===========================================================================
  describe('scripture domain', () => {
    it('loads scripture sample and validates API response', async () => {
      // Load test data from registry
      const data = await loadTestData({ scripture: 1 });

      expect(data.scripture).toBeDefined();
      expect(data.scripture.length).toBeGreaterThan(0);

      const sample = data.scripture[0];
      expect(sample.id).toBeDefined();
      expect(sample.expect).toBeDefined();

      // Call the API with the sample ID
      const apiPath = `/api/v1/local-content/scripture/${sample.id}`;
      const { status, body } = await fetchJSON(apiPath);

      expect(status).toBe(200);
      expect(body).not.toBeNull();

      // Validate response against expectations
      const validation = validateExpectations(body, sample.expect);

      if (!validation.valid) {
        console.error('Scripture validation errors:', validation.errors);
      }

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('scripture sample has meaningful expectations', async () => {
      const data = await loadTestData({ scripture: 1 });
      const sample = data.scripture[0];

      // Sample should have expectations defined
      expect(Object.keys(sample.expect).length).toBeGreaterThan(0);

      // For preferred samples, should have specific expectations
      expect(sample.expect.reference).toBeDefined();
    });
  });

  // ===========================================================================
  // HYMN
  // ===========================================================================
  describe('hymn domain', () => {
    it('loads hymn sample and validates API response', async () => {
      // Load test data from registry
      const data = await loadTestData({ hymn: 1 });

      expect(data.hymn).toBeDefined();
      expect(data.hymn.length).toBeGreaterThan(0);

      const sample = data.hymn[0];
      expect(sample.id).toBeDefined();
      expect(sample.expect).toBeDefined();

      // Call the API with the sample ID
      const apiPath = `/api/v1/local-content/hymn/${sample.id}`;
      const { status, body } = await fetchJSON(apiPath);

      expect(status).toBe(200);
      expect(body).not.toBeNull();

      // Validate response against expectations
      const validation = validateExpectations(body, sample.expect);

      if (!validation.valid) {
        console.error('Hymn validation errors:', validation.errors);
      }

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('hymn sample has meaningful expectations', async () => {
      const data = await loadTestData({ hymn: 1 });
      const sample = data.hymn[0];

      // Sample should have expectations defined
      expect(Object.keys(sample.expect).length).toBeGreaterThan(0);

      // For preferred samples, should have specific expectations
      expect(sample.expect.title).toBeDefined();
    });
  });

  // Plex itself is an external integration; adapter loading is covered by the
  // adapter-discovery suite. Here we deterministically preserve the registry
  // selection and matcher contract that previously depended on a live server.
  describe('plex registry domain', () => {
    it('loads a Plex sample and validates its response contract', async () => {
      const data = await loadTestData({ plex: 1 });

      expect(data.plex).toHaveLength(1);
      expect(data.plex[0].id).toBe('fixture-plex-item');
      const validation = validateExpectations(
        { title: 'Fixture Movie', type: 'movie' },
        data.plex[0].expect,
      );
      expect(validation).toEqual({ valid: true, errors: [] });
    });

    it('retains meaningful Plex expectations', async () => {
      const [{ expect: sampleExpect }] = (await loadTestData({ plex: 1 })).plex;
      expect(sampleExpect.title).toBeDefined();
      expect(sampleExpect.type).toBeDefined();
    });
  });

  // ===========================================================================
  // MULTI-DOMAIN LOADING
  // ===========================================================================
  describe('multi-domain loading', () => {
    it('loads multiple domains in single call', async () => {
      const data = await loadTestData({
        scripture: 1,
        hymn: 1
      });

      expect(data.scripture).toBeDefined();
      expect(data.hymn).toBeDefined();
      expect(data.scripture.length).toBeGreaterThan(0);
      expect(data.hymn.length).toBeGreaterThan(0);
    });

    it('caches results for identical specs', async () => {
      clearCache();

      const data1 = await loadTestData({ scripture: 1 });
      const data2 = await loadTestData({ scripture: 1 });

      // Should be same object reference due to caching
      expect(data1).toBe(data2);
    });
  });

  // ===========================================================================
  // VALIDATION MATCHERS
  // ===========================================================================
  describe('expectation validation', () => {
    it('validates regex expectations', async () => {
      const data = await loadTestData({ scripture: 1 });
      const sample = data.scripture[0];

      const apiPath = `/api/v1/local-content/scripture/${sample.id}`;
      const { body } = await fetchJSON(apiPath);

      // The scripture registry has: reference: /1 Nephi 1/i
      // This should match case-insensitively
      expect(body.reference).toMatch(/1 Nephi 1/i);
    });

    it('validates type expectations', async () => {
      const data = await loadTestData({ scripture: 1 });
      const sample = data.scripture[0];

      const apiPath = `/api/v1/local-content/scripture/${sample.id}`;
      const { body } = await fetchJSON(apiPath);

      // The scripture registry has: verses: array
      expect(Array.isArray(body.verses)).toBe(true);
    });

    it('validates numeric comparison expectations', async () => {
      const data = await loadTestData({ hymn: 1 });
      const sample = data.hymn[0];

      const apiPath = `/api/v1/local-content/hymn/${sample.id}`;
      const { body } = await fetchJSON(apiPath);

      // The hymn registry has: number: ">=1"
      expect(body.number).toBeGreaterThanOrEqual(1);
    });
  });
});
