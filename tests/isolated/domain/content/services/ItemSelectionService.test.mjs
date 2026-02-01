// tests/isolated/domain/content/services/ItemSelectionService.test.mjs
import { jest } from '@jest/globals';
import { ItemSelectionService } from '#domains/content/services/ItemSelectionService.mjs';

describe('ItemSelectionService', () => {
  describe('getStrategy', () => {
    test('returns watchlist strategy', () => {
      const strategy = ItemSelectionService.getStrategy('watchlist');
      expect(strategy).toEqual({
        filter: ['skipAfter', 'waitUntil', 'hold', 'watched', 'days'],
        sort: 'priority',
        pick: 'first'
      });
    });

    test('returns binge strategy', () => {
      const strategy = ItemSelectionService.getStrategy('binge');
      expect(strategy).toEqual({
        filter: ['watched'],
        sort: 'source_order',
        pick: 'all'
      });
    });

    test('returns album strategy', () => {
      const strategy = ItemSelectionService.getStrategy('album');
      expect(strategy).toEqual({
        filter: [],
        sort: 'track_order',
        pick: 'all'
      });
    });

    test('returns playlist strategy', () => {
      const strategy = ItemSelectionService.getStrategy('playlist');
      expect(strategy).toEqual({
        filter: [],
        sort: 'source_order',
        pick: 'all'
      });
    });

    test('returns discovery strategy', () => {
      const strategy = ItemSelectionService.getStrategy('discovery');
      expect(strategy).toEqual({
        filter: [],
        sort: 'random',
        pick: 'first'
      });
    });

    test('returns chronological strategy', () => {
      const strategy = ItemSelectionService.getStrategy('chronological');
      expect(strategy).toEqual({
        filter: [],
        sort: 'date_asc',
        pick: 'all'
      });
    });

    test('returns slideshow strategy', () => {
      const strategy = ItemSelectionService.getStrategy('slideshow');
      expect(strategy).toEqual({
        filter: [],
        sort: 'random',
        pick: 'all'
      });
    });

    test('throws for unknown strategy', () => {
      expect(() => ItemSelectionService.getStrategy('unknown'))
        .toThrow('Unknown strategy: unknown');
    });
  });

  describe('applyFilter', () => {
    const now = new Date('2026-01-15');

    test('applies skipAfter filter', () => {
      const items = [
        { id: '1', skipAfter: '2026-01-20' }, // valid
        { id: '2', skipAfter: '2026-01-10' }, // expired
        { id: '3' } // no skipAfter
      ];
      const result = ItemSelectionService.applyFilter(items, 'skipAfter', { now });
      expect(result.map(i => i.id)).toEqual(['1', '3']);
    });

    test('applies waitUntil filter', () => {
      const items = [
        { id: '1', waitUntil: '2026-01-14' }, // past
        { id: '2', waitUntil: '2026-01-17' }, // within 2 days
        { id: '3', waitUntil: '2026-01-25' }, // too far
        { id: '4' } // no waitUntil
      ];
      const result = ItemSelectionService.applyFilter(items, 'waitUntil', { now });
      expect(result.map(i => i.id)).toEqual(['1', '2', '4']);
    });

    test('applies hold filter', () => {
      const items = [
        { id: '1', hold: true },
        { id: '2', hold: false },
        { id: '3' }
      ];
      const result = ItemSelectionService.applyFilter(items, 'hold', { now });
      expect(result.map(i => i.id)).toEqual(['2', '3']);
    });

    test('applies watched filter', () => {
      const items = [
        { id: '1', percent: 95 },
        { id: '2', watched: true },
        { id: '3', percent: 50 },
        { id: '4' }
      ];
      const result = ItemSelectionService.applyFilter(items, 'watched', { now });
      expect(result.map(i => i.id)).toEqual(['3', '4']);
    });

    test('applies days filter', () => {
      // Jan 15 2026 is Thursday (day 4)
      const thursday = new Date(2026, 0, 15);
      const items = [
        { id: '1', days: [4] }, // Thursday only
        { id: '2', days: [1, 2, 3] }, // M-W
        { id: '3' } // no days
      ];
      const result = ItemSelectionService.applyFilter(items, 'days', { now: thursday });
      expect(result.map(i => i.id)).toEqual(['1', '3']);
    });

    test('throws for unknown filter', () => {
      expect(() => ItemSelectionService.applyFilter([], 'unknown', { now }))
        .toThrow('Unknown filter: unknown');
    });

    test('throws if now not provided for date-dependent filters', () => {
      expect(() => ItemSelectionService.applyFilter([], 'skipAfter', {}))
        .toThrow('now date required');
    });
  });

  describe('applyFilters (multiple)', () => {
    test('applies multiple filters in sequence', () => {
      const now = new Date('2026-01-15');
      const items = [
        { id: '1', hold: false, percent: 0 },
        { id: '2', hold: true, percent: 0 },
        { id: '3', hold: false, percent: 95 }
      ];
      const result = ItemSelectionService.applyFilters(items, ['hold', 'watched'], { now });
      expect(result.map(i => i.id)).toEqual(['1']);
    });

    test('returns all items when filter list is empty', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const result = ItemSelectionService.applyFilters(items, [], { now: new Date() });
      expect(result.length).toBe(2);
    });
  });

  describe('applySort', () => {
    test('sorts by priority', () => {
      const items = [
        { id: '1', priority: 'low' },
        { id: '2', priority: 'in_progress', percent: 50 },
        { id: '3', priority: 'high' }
      ];
      const result = ItemSelectionService.applySort(items, 'priority');
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('sorts by track_order', () => {
      const items = [
        { id: '1', discNumber: 1, trackNumber: 3 },
        { id: '2', discNumber: 1, trackNumber: 1 },
        { id: '3', discNumber: 2, trackNumber: 1 }
      ];
      const result = ItemSelectionService.applySort(items, 'track_order');
      expect(result.map(i => i.id)).toEqual(['2', '1', '3']);
    });

    test('sorts by source_order (preserves original)', () => {
      const items = [
        { id: '1' },
        { id: '2' },
        { id: '3' }
      ];
      const result = ItemSelectionService.applySort(items, 'source_order');
      expect(result.map(i => i.id)).toEqual(['1', '2', '3']);
    });

    test('sorts by date_asc', () => {
      const items = [
        { id: '1', date: '2026-03-01' },
        { id: '2', date: '2026-01-01' },
        { id: '3', date: '2026-02-01' }
      ];
      const result = ItemSelectionService.applySort(items, 'date_asc');
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('sorts by date_desc', () => {
      const items = [
        { id: '1', date: '2026-01-01' },
        { id: '2', date: '2026-03-01' },
        { id: '3', date: '2026-02-01' }
      ];
      const result = ItemSelectionService.applySort(items, 'date_desc');
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('sorts by random (shuffles items)', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
      const result = ItemSelectionService.applySort(items, 'random');
      expect(result.length).toBe(5);
      expect(new Set(result.map(i => i.id)).size).toBe(5); // all unique
    });

    test('sorts by title', () => {
      const items = [
        { id: '1', title: 'Zebra' },
        { id: '2', title: 'Apple' },
        { id: '3', title: 'Mango' }
      ];
      const result = ItemSelectionService.applySort(items, 'title');
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('throws for unknown sort', () => {
      expect(() => ItemSelectionService.applySort([], 'unknown'))
        .toThrow('Unknown sort: unknown');
    });

    test('uses itemIndex as fallback for track_order', () => {
      const items = [
        { id: '1', itemIndex: 3 },
        { id: '2', itemIndex: 1 },
        { id: '3', itemIndex: 2 }
      ];
      const result = ItemSelectionService.applySort(items, 'track_order');
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('uses takenAt as fallback for date sorts', () => {
      const items = [
        { id: '1', takenAt: '2026-03-01' },
        { id: '2', takenAt: '2026-01-01' }
      ];
      const result = ItemSelectionService.applySort(items, 'date_asc');
      expect(result.map(i => i.id)).toEqual(['2', '1']);
    });
  });

  describe('applyPick', () => {
    test('picks first item', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const result = ItemSelectionService.applyPick(items, 'first');
      expect(result).toEqual([{ id: '1' }]);
    });

    test('picks all items', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const result = ItemSelectionService.applyPick(items, 'all');
      expect(result.length).toBe(3);
    });

    test('picks random item', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const result = ItemSelectionService.applyPick(items, 'random');
      expect(result.length).toBe(1);
      expect(items.some(i => i.id === result[0].id)).toBe(true);
    });

    test('picks first N items with take:N', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
      const result = ItemSelectionService.applyPick(items, 'take:2');
      expect(result.map(i => i.id)).toEqual(['1', '2']);
    });

    test('handles take:N when N > items.length', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const result = ItemSelectionService.applyPick(items, 'take:5');
      expect(result.length).toBe(2);
    });

    test('returns empty array for empty input', () => {
      expect(ItemSelectionService.applyPick([], 'first')).toEqual([]);
      expect(ItemSelectionService.applyPick([], 'all')).toEqual([]);
      expect(ItemSelectionService.applyPick([], 'random')).toEqual([]);
    });

    test('throws for unknown pick', () => {
      expect(() => ItemSelectionService.applyPick([{ id: '1' }], 'unknown'))
        .toThrow('Unknown pick: unknown');
    });

    test('throws for invalid take:N format', () => {
      expect(() => ItemSelectionService.applyPick([{ id: '1' }], 'take:abc'))
        .toThrow('Invalid take format');
    });
  });

  describe('resolveStrategy', () => {
    describe('inference from context', () => {
      test('infers watchlist for folder container', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          containerType: 'folder'
        });
        expect(strategy.sort).toBe('priority');
      });

      test('infers album for album container', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          containerType: 'album'
        });
        expect(strategy.sort).toBe('track_order');
      });

      test('infers playlist for playlist container', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          containerType: 'playlist'
        });
        expect(strategy.sort).toBe('source_order');
      });

      test('infers chronological for person query', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          query: { person: 'John' }
        });
        expect(strategy.sort).toBe('date_asc');
      });

      test('infers chronological for time query', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          query: { time: '2025' }
        });
        expect(strategy.sort).toBe('date_asc');
      });

      test('infers discovery for text query', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          query: { text: 'vacation' }
        });
        expect(strategy.sort).toBe('random');
      });

      test('infers slideshow for display action', () => {
        const strategy = ItemSelectionService.resolveStrategy({
          action: 'display'
        });
        expect(strategy.sort).toBe('random');
        expect(strategy.pick).toBe('all');
      });
    });

    describe('override priority', () => {
      test('explicit strategy overrides inference', () => {
        const strategy = ItemSelectionService.resolveStrategy(
          { containerType: 'folder' },
          { strategy: 'binge' }
        );
        expect(strategy.sort).toBe('source_order');
      });

      test('explicit sort overrides strategy', () => {
        const strategy = ItemSelectionService.resolveStrategy(
          { containerType: 'folder' },
          { sort: 'random' }
        );
        expect(strategy.sort).toBe('random');
        expect(strategy.filter).toContain('watched'); // rest from watchlist
      });

      test('explicit pick overrides strategy', () => {
        const strategy = ItemSelectionService.resolveStrategy(
          { containerType: 'folder' },
          { pick: 'all' }
        );
        expect(strategy.pick).toBe('all');
      });

      test('filter: none disables filtering', () => {
        const strategy = ItemSelectionService.resolveStrategy(
          { containerType: 'folder' },
          { filter: 'none' }
        );
        expect(strategy.filter).toEqual([]);
      });
    });

    describe('defaults', () => {
      test('defaults to discovery when no signals', () => {
        const strategy = ItemSelectionService.resolveStrategy({});
        expect(strategy.sort).toBe('random');
      });
    });
  });

  describe('select', () => {
    const now = new Date('2026-01-15');

    test('applies full watchlist pipeline', () => {
      const items = [
        { id: '1', priority: 'low', hold: false, percent: 0 },
        { id: '2', priority: 'high', hold: false, percent: 0 },
        { id: '3', priority: 'medium', hold: true, percent: 0 }, // filtered
        { id: '4', priority: 'in_progress', hold: false, percent: 50 }
      ];
      const result = ItemSelectionService.select(items, {
        containerType: 'folder',
        now
      });
      // Filtered (hold), sorted by priority, pick first
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('4'); // in_progress first
    });

    test('applies album pipeline (no filter, track_order)', () => {
      const items = [
        { id: '1', trackNumber: 3 },
        { id: '2', trackNumber: 1 },
        { id: '3', trackNumber: 2 }
      ];
      const result = ItemSelectionService.select(items, {
        containerType: 'album',
        now
      });
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });

    test('respects override pick', () => {
      const items = [
        { id: '1', priority: 'high', hold: false, percent: 0 },
        { id: '2', priority: 'low', hold: false, percent: 0 }
      ];
      const result = ItemSelectionService.select(
        items,
        { containerType: 'folder', now },
        { pick: 'all' }
      );
      expect(result.length).toBe(2);
    });

    test('applies urgency promotion before sort', () => {
      const items = [
        { id: '1', priority: 'medium', skipAfter: '2026-01-20' }, // within 8 days -> urgent
        { id: '2', priority: 'high' }
      ];
      const result = ItemSelectionService.select(
        items,
        { containerType: 'folder', now },
        { pick: 'all' }
      );
      expect(result[0].id).toBe('1'); // promoted to urgent, before high
      expect(result[0].priority).toBe('urgent');
    });

    test('handles empty result after filtering', () => {
      const items = [
        { id: '1', hold: true }
      ];
      const result = ItemSelectionService.select(items, {
        containerType: 'folder',
        now
      });
      expect(result).toEqual([]);
    });

    test('throws if now not provided for watchlist strategy', () => {
      const items = [{ id: '1' }];
      expect(() => ItemSelectionService.select(items, { containerType: 'folder' }))
        .toThrow('now date required');
    });
  });
});
