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
    test('returns defaults when no scroll.yml exists', () => {
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(15);
      expect(config.algorithm.grounding_ratio).toBe(5);
      expect(config.algorithm.decay_rate).toBe(0.85);
      expect(config.algorithm.min_ratio).toBe(2);
      expect(config.spacing.max_consecutive).toBe(1);
      expect(config.sources).toEqual({});
      expect(mockDataService.user.read).toHaveBeenCalledWith('config/scroll', 'kckern');
    });

    test('merges user overrides with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        batch_size: 20,
        algorithm: { grounding_ratio: 8 },
        sources: {
          reddit: { max_per_batch: 5, min_spacing: 2 },
        },
      });
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(20);
      expect(config.algorithm.grounding_ratio).toBe(8);
      expect(config.algorithm.decay_rate).toBe(0.85); // default preserved
      expect(config.algorithm.min_ratio).toBe(2);      // default preserved
      expect(config.sources.reddit.max_per_batch).toBe(5);
    });

    test('merges focus_mode with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        focus_mode: { grounding_ratio: 10 },
      });
      const config = loader.load('kckern');
      expect(config.focus_mode.grounding_ratio).toBe(10);
      expect(config.focus_mode.decay_rate).toBe(0.9);  // default
      expect(config.focus_mode.min_ratio).toBe(3);      // default
    });

    test('does not mutate defaults across calls', () => {
      mockDataService.user.read.mockReturnValue({ batch_size: 99 });
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
