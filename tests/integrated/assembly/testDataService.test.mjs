// tests/integration/api/testDataService.integration.test.mjs
/**
 * testDataService Integration Tests
 *
 * Validates that testDataService works with real API endpoints.
 * Loads test samples from the registry, calls actual APIs, and validates
 * responses using the expectation matchers.
 */

import { loadTestData, validateExpectations, clearCache } from '#testlib/testDataService.mjs';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3112';

/**
 * Fetch JSON from an API endpoint
 * @param {string} path - API path (e.g., '/api/v1/local-content/scripture/1-nephi-1')
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function fetchJSON(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  return {
    status: response.status,
    body: response.ok ? await response.json() : null
  };
}

/**
 * Check if Plex adapter is available
 * @returns {Promise<boolean>}
 */
async function isPlexAvailable() {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/info/plex/1`, { method: 'HEAD' });
    // 503 means adapter not configured, 404 means item not found (but adapter works)
    return res.status !== 503;
  } catch (e) {
    return false;
  }
}

describe('testDataService Integration', () => {
  beforeAll(() => {
    clearCache();
  });

  afterAll(() => {
    clearCache();
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

  // ===========================================================================
  // PLEX
  // ===========================================================================
  describe('plex domain', () => {
    let plexAvailable = false;

    beforeAll(async () => {
      plexAvailable = await isPlexAvailable();
      if (!plexAvailable) {
        console.log('Plex adapter not available, skipping Plex tests');
      }
    });

    it('loads plex sample and validates API response', async () => {
      if (!plexAvailable) {
        console.log('Skipping: Plex not available');
        return;
      }

      // Load test data from registry
      const data = await loadTestData({ plex: 1 });

      expect(data.plex).toBeDefined();
      expect(data.plex.length).toBeGreaterThan(0);

      const sample = data.plex[0];
      expect(sample.id).toBeDefined();
      expect(sample.expect).toBeDefined();

      // Call the API with the sample ID
      const apiPath = `/api/v1/info/plex/${sample.id}`;
      const { status, body } = await fetchJSON(apiPath);

      // Plex item might not exist (404) - that's acceptable
      if (status === 404) {
        console.log(`Plex item ${sample.id} not found, skipping validation`);
        return;
      }

      expect(status).toBe(200);
      expect(body).not.toBeNull();

      // Validate response against expectations
      const validation = validateExpectations(body, sample.expect);

      if (!validation.valid) {
        console.error('Plex validation errors:', validation.errors);
      }

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('plex sample has meaningful expectations', async () => {
      if (!plexAvailable) {
        console.log('Skipping: Plex not available');
        return;
      }

      const data = await loadTestData({ plex: 1 });
      const sample = data.plex[0];

      // Sample should have expectations defined
      expect(Object.keys(sample.expect).length).toBeGreaterThan(0);

      // For preferred samples, should have specific expectations
      expect(sample.expect.title).toBeDefined();
      // Note: type expectation is now present only for items with complete metadata
      expect(sample.expect.type).toBeDefined();
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
