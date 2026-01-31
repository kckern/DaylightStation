// tests/unit/infrastructure/routing/RouteMatcher.test.mjs
import { describe, it, expect } from '@jest/globals';
import { buildRoutingTable, matchRoute } from '#backend/src/0_system/routing/RouteMatcher.mjs';

describe('RouteMatcher', () => {
  describe('buildRoutingTable', () => {
    it('builds table from config routing section', () => {
      const routing = {
        '/api/finance': 'new',
        '/api/content': { target: 'new', shim: 'content-v1' },
      };

      const table = buildRoutingTable(routing);

      expect(table).toHaveLength(2);
      expect(table[0].path).toBe('/api/finance');
      expect(table[0].target).toBe('new');
      expect(table[0].shim).toBeNull();
      expect(table[1].path).toBe('/api/content');
      expect(table[1].target).toBe('new');
      expect(table[1].shim).toBe('content-v1');
    });

    it('sorts by path length descending (longest prefix first)', () => {
      const routing = {
        '/api': 'legacy',
        '/api/finance/data': 'new',
        '/api/finance': 'new',
      };

      const table = buildRoutingTable(routing);

      expect(table[0].path).toBe('/api/finance/data');
      expect(table[1].path).toBe('/api/finance');
      expect(table[2].path).toBe('/api');
    });
  });

  describe('matchRoute', () => {
    it('matches exact path', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('matches path prefix', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance/data/budget', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('uses longest prefix match', () => {
      const table = buildRoutingTable({
        '/api': 'legacy',
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance/data', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('returns default when no match', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/health', table, 'legacy');

      expect(result.target).toBe('legacy');
      expect(result.matched).toBeNull();
    });

    it('includes shim name when matched route has shim', () => {
      const table = buildRoutingTable({
        '/api/finance': { target: 'new', shim: 'finance-v1' },
      });

      const result = matchRoute('/api/finance/data', table, 'legacy');

      expect(result.shim).toBe('finance-v1');
    });
  });
});
