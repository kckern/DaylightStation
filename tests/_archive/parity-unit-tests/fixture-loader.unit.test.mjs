// tests/unit/parity/fixture-loader.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { loadFixtures, groupByType } from '@testlib/fixture-loader.mjs';

describe('fixture-loader', () => {
  describe('loadFixtures', () => {
    it('loads fixtures from lists.yml', async () => {
      const fixtures = await loadFixtures();

      expect(Array.isArray(fixtures)).toBe(true);
      expect(fixtures.length).toBeGreaterThan(0);

      // Each fixture should have required fields
      const fixture = fixtures[0];
      expect(fixture).toHaveProperty('type');
      expect(fixture).toHaveProperty('value');
      expect(fixture).toHaveProperty('label');
      expect(fixture).toHaveProperty('uid');
    });

    it('excludes app inputs', async () => {
      const fixtures = await loadFixtures();
      const appFixtures = fixtures.filter(f => f.type === 'app');
      expect(appFixtures.length).toBe(0);
    });

    it('filters by type', async () => {
      const fixtures = await loadFixtures({ types: ['plex'] });
      expect(fixtures.every(f => f.type === 'plex')).toBe(true);
    });
  });

  describe('groupByType', () => {
    it('groups fixtures by type', async () => {
      const fixtures = await loadFixtures();
      const grouped = groupByType(fixtures);

      expect(grouped).toHaveProperty('plex');
      expect(Array.isArray(grouped.plex)).toBe(true);
    });
  });
});
