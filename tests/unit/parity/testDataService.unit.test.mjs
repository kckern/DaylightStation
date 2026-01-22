// tests/unit/parity/testDataService.unit.test.mjs
/**
 * Unit tests for testDataService.
 *
 * These tests use the real data mount to verify the service works correctly
 * with actual test data registry and discovered files.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';

// Import will fail until service is implemented (TDD red phase)
let loadTestData, getTestSample, clearCache, validateExpectations;

try {
  const module = await import('../../lib/testDataService.mjs');
  loadTestData = module.loadTestData;
  getTestSample = module.getTestSample;
  clearCache = module.clearCache;
  validateExpectations = module.validateExpectations;
} catch (err) {
  // Module not implemented yet - tests will be skipped
  console.warn('testDataService not implemented yet:', err.message);
}

// Skip all tests if module not yet implemented
const describeIf = (condition) => condition ? describe : describe.skip;
const isImplemented = typeof loadTestData === 'function';

describeIf(isImplemented)('testDataService', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure isolation
    if (clearCache) clearCache();
  });

  describe('loadTestData', () => {
    it('loads test data for a single domain with count', async () => {
      const result = await loadTestData({ scripture: 1 });

      expect(result).toHaveProperty('scripture');
      expect(result.scripture).toHaveLength(1);
      expect(result.scripture[0]).toHaveProperty('id');
      expect(result.scripture[0]).toHaveProperty('expect');
    });

    it('loads test data for multiple domains', async () => {
      const result = await loadTestData({ scripture: 1, hymn: 1 });

      expect(result).toHaveProperty('scripture');
      expect(result).toHaveProperty('hymn');
      expect(result.scripture).toHaveLength(1);
      expect(result.hymn).toHaveLength(1);
    });

    it('accepts string array for specific IDs', async () => {
      const result = await loadTestData({ list: ['watchlist'] });

      expect(result.list).toHaveLength(1);
      expect(result.list[0].id).toBe('watchlist');
    });

    it('returns samples with merged expectations from default_expect', async () => {
      const result = await loadTestData({ hymn: 1 });

      // The expect should include default_expect merged with specific expect
      expect(result.hymn[0].expect).toHaveProperty('title');
    });

    it('returns empty array for unknown domain', async () => {
      const result = await loadTestData({ nonexistent_domain_xyz: 1 });

      expect(result.nonexistent_domain_xyz).toEqual([]);
    });

    it('handles requesting more samples than preferred available', async () => {
      // Request many samples - should fall back to discovery
      const consoleSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args) => consoleSpy.push(args);

      const result = await loadTestData({ hymn: 5 });

      console.warn = originalWarn;

      // Should have samples (either from preferred or discovery)
      expect(result.hymn.length).toBeGreaterThan(0);
    });

    it('caches results for same spec', async () => {
      // First call
      const result1 = await loadTestData({ scripture: 1 });

      // Second call with same spec should return cached result
      const result2 = await loadTestData({ scripture: 1 });

      // Both should have same data
      expect(result1.scripture[0].id).toBe(result2.scripture[0].id);
    });

    it('handles empty spec object', async () => {
      const result = await loadTestData({});

      expect(result).toEqual({});
    });
  });

  describe('getTestSample', () => {
    it('returns a single test sample for domain', async () => {
      const result = await getTestSample('hymn');

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('expect');
    });

    it('returns specific ID when provided', async () => {
      const result = await getTestSample('scripture', { id: '1-nephi-1' });

      expect(result.id).toBe('1-nephi-1');
    });

    it('falls back to first preferred when specific ID not found', async () => {
      const consoleSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args) => consoleSpy.push(args);

      const result = await getTestSample('scripture', { id: 'nonexistent-chapter-xyz' });

      console.warn = originalWarn;

      // Should have gotten a fallback sample
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('expect');
      // Should have warned
      expect(consoleSpy.length).toBeGreaterThan(0);
    });

    it('returns null for unknown domain', async () => {
      const result = await getTestSample('unknown_domain_xyz');

      expect(result).toBeNull();
    });

    it('handles domain with only plex_api discovery (no path)', async () => {
      // plex domain uses discover_via: plex_api, not discover_path
      const result = await getTestSample('plex');

      // Should get preferred samples
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('expect');
    });
  });

  describe('clearCache', () => {
    it('clears cached results', async () => {
      // Load something to populate cache
      await loadTestData({ scripture: 1 });

      // Clear cache
      clearCache();

      // Load again - should work (testing that clear doesn't break anything)
      const result = await loadTestData({ scripture: 1 });
      expect(result.scripture).toHaveLength(1);
    });

    it('is idempotent (can be called multiple times)', () => {
      clearCache();
      clearCache();
      clearCache();
      // No error thrown
    });
  });

  describe('validateExpectations re-export', () => {
    it('exports validateExpectations from testDataMatchers', () => {
      expect(typeof validateExpectations).toBe('function');
    });

    it('validateExpectations works correctly', () => {
      const actual = { name: 'test', count: 5 };
      const expectations = { name: 'string', count: '>0' };

      const result = validateExpectations(actual, expectations);

      expect(result.valid).toBe(true);
    });

    it('validateExpectations reports errors correctly', () => {
      const actual = { name: 'test', count: -1 };
      const expectations = { name: 'string', count: '>0' };

      const result = validateExpectations(actual, expectations);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('count');
    });
  });

  describe('integration with real data', () => {
    it('scripture domain has expected structure', async () => {
      const sample = await getTestSample('scripture');

      expect(sample.id).toBeDefined();
      expect(sample.expect).toHaveProperty('reference');
    });

    it('hymn domain has expected structure', async () => {
      const sample = await getTestSample('hymn');

      expect(sample.id).toBeDefined();
      expect(sample.expect).toHaveProperty('title');
    });

    it('plex domain has expected structure', async () => {
      const sample = await getTestSample('plex');

      expect(sample.id).toBeDefined();
      expect(sample.expect).toHaveProperty('title');
      expect(sample.expect).toHaveProperty('type');
    });

    it('list domain has expected structure', async () => {
      const sample = await getTestSample('list');

      expect(sample.id).toBeDefined();
      expect(sample.expect).toHaveProperty('items');
    });
  });

  describe('edge cases', () => {
    it('handles count of 0', async () => {
      const result = await loadTestData({ scripture: 0 });

      expect(result.scripture).toEqual([]);
    });

    it('handles negative count as 0', async () => {
      const result = await loadTestData({ scripture: -1 });

      expect(result.scripture).toEqual([]);
    });

    it('handles array with duplicate IDs', async () => {
      const result = await loadTestData({ scripture: ['1-nephi-1', '1-nephi-1'] });

      // Should still work (might dedupe or return duplicates depending on impl)
      expect(result.scripture.length).toBeGreaterThan(0);
    });
  });
});

// If module not implemented, show a clear message
if (!isImplemented) {
  describe('testDataService (NOT YET IMPLEMENTED)', () => {
    it('needs implementation - this is the TDD red phase', () => {
      throw new Error('testDataService.mjs needs to be implemented');
    });
  });
}
