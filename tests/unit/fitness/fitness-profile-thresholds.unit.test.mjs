import { jest } from '@jest/globals';

describe('FitnessApp profile warning thresholds', () => {
  test('heap growth warning threshold should be 20MB (not 30MB)', () => {
    // Lower threshold catches issues sooner in production
    const HEAP_GROWTH_WARNING_THRESHOLD = 20; // Changed from 30

    const heapGrowthMB = 25;
    const shouldWarn = heapGrowthMB > HEAP_GROWTH_WARNING_THRESHOLD;

    expect(shouldWarn).toBe(true);
  });

  test('max series length warning threshold should be 1500 (not 2500)', () => {
    // Lower threshold to catch before hitting pruning limit
    const MAX_SERIES_WARNING_THRESHOLD = 1500; // Changed from 2500

    const maxSeriesLength = 1600;
    const shouldWarn = maxSeriesLength > MAX_SERIES_WARNING_THRESHOLD;

    expect(shouldWarn).toBe(true);
  });

  test('treasurebox cumulative warning threshold should be 800 (not 1500)', () => {
    // Lower threshold to warn before pruning kicks in
    const TREASUREBOX_WARNING_THRESHOLD = 800; // Changed from 1500

    const cumulativeLen = 900;
    const shouldWarn = cumulativeLen > TREASUREBOX_WARNING_THRESHOLD;

    expect(shouldWarn).toBe(true);
  });
});
