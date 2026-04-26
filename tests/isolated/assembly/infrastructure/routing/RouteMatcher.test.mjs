// tests/unit/infrastructure/routing/RouteMatcher.test.mjs
import { describe, it, expect } from 'vitest';
import { buildRoutingTable, matchRoute } from '#backend/src/0_system/routing/RouteMatcher.mjs';

describe('RouteMatcher', () => {
  describe('buildRoutingTable', () => {
    it('builds table from config routing section', () => {
      // Production buildRoutingTable now only carries { path, target }; the
      // shim metadata was removed (see RouteMatcher.mjs:8-18). Object-form
      // entries still extract the target — the rest of the rule is ignored.
      const routing = {
        '/api/finance': 'new',
        '/api/content': { target: 'new', shim: 'content-v1' },
      };

      const table = buildRoutingTable(routing);

      expect(table).toHaveLength(2);
      // Sorted by path length descending: /api/content (12) before /api/finance (12),
      // tie broken by insertion order — exact ordering is unimportant; we just
      // check both entries are present with their target.
      const byPath = Object.fromEntries(table.map(t => [t.path, t]));
      expect(byPath['/api/finance'].target).toBe('new');
      expect(byPath['/api/content'].target).toBe('new');
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

    it('matches object-form routing rules (ignoring removed shim field)', () => {
      // Production no longer surfaces a shim field on the match result;
      // assert the matched target instead.
      const table = buildRoutingTable({
        '/api/finance': { target: 'new', shim: 'finance-v1' },
      });

      const result = matchRoute('/api/finance/data', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });
  });
});
