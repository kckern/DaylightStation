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
});
