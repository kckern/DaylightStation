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
});
