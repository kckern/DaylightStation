// tests/isolated/application/feed/ScrollConfigLoader.test.mjs
import { jest } from '@jest/globals';
import { ScrollConfigLoader } from '#apps/feed/services/ScrollConfigLoader.mjs';

describe('ScrollConfigLoader', () => {
  let loader;
  let mockDataService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(null),
      },
    };
    loader = new ScrollConfigLoader({ dataService: mockDataService });
  });

  describe('load()', () => {
    test('returns defaults when no config/feed exists', () => {
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(15);
      expect(config.wire_decay_batches).toBe(10);
      expect(config.spacing).toEqual({
        max_consecutive: 1,
        max_consecutive_subsource: 2,
      });
      expect(config.tiers.wire.sources).toEqual({});
      expect(config.tiers.library.sources).toEqual({});
      expect(mockDataService.user.read).toHaveBeenCalledWith('config/feed', 'kckern');
    });

    test('merges user overrides with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        scroll: {
          batch_size: 20,
          spacing: { max_consecutive: 3 },
          tiers: {
            wire: {
              sources: { reddit: { max_per_batch: 5 } },
            },
          },
        },
      });
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(20);
      expect(config.spacing.max_consecutive).toBe(3);
      expect(config.spacing.max_consecutive_subsource).toBe(2); // default preserved
      expect(config.tiers.wire.sources.reddit.max_per_batch).toBe(5);
    });

    test('merges spacing subsource override with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        scroll: {
          spacing: { max_consecutive_subsource: 5 },
        },
      });
      const config = loader.load('kckern');
      expect(config.spacing.max_consecutive).toBe(1);            // default preserved
      expect(config.spacing.max_consecutive_subsource).toBe(5);  // overridden
    });

    test('does not mutate defaults across calls', () => {
      mockDataService.user.read.mockReturnValue({ scroll: { batch_size: 99 } });
      loader.load('alice');
      mockDataService.user.read.mockReturnValue(null);
      const config = loader.load('bob');
      expect(config.batch_size).toBe(15); // not 99
    });
  });

  describe('getPaddingSources', () => {
    test('returns empty set when no padding sources configured', () => {
      const config = {
        tiers: {
          wire: { sources: { reddit: { max_per_batch: 10 } } },
          library: { sources: { komga: { max_per_batch: 5 } } },
        },
      };
      const result = ScrollConfigLoader.getPaddingSources(config);
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test('returns sources with padding: true', () => {
      const config = {
        tiers: {
          library: { sources: { komga: { max_per_batch: 5, padding: true } } },
          scrapbook: { sources: { photos: { max_per_batch: 4, padding: true }, journal: { max_per_batch: 1 } } },
        },
      };
      const result = ScrollConfigLoader.getPaddingSources(config);
      expect(result).toEqual(new Set(['komga', 'photos']));
    });

    test('handles missing tiers gracefully', () => {
      const result = ScrollConfigLoader.getPaddingSources({});
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test('ignores padding: false', () => {
      const config = {
        tiers: {
          library: { sources: { komga: { max_per_batch: 5, padding: false } } },
        },
      };
      const result = ScrollConfigLoader.getPaddingSources(config);
      expect(result.size).toBe(0);
    });
  });
});
