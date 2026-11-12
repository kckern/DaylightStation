import { describe, it, expect } from 'vitest';
import { mean, pct, percentile, round, stddev, summarize } from './stats.js';

describe('stats', () => {
  it('interpolates percentiles between ranks', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([40, 10, 30, 20], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 95)).toBeCloseTo(10.5);
    expect(percentile([], 50)).toBeNull();
  });

  it('uses the sample standard deviation', () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stddev([5])).toBeNull();
    expect(mean([])).toBeNull();
  });

  it('summarizes, ignoring non-finite values', () => {
    expect(summarize([10, null, 20, NaN, 30])).toEqual({ n: 3, mean: 20, sd: 10, min: 10, max: 30, p50: 20, p95: 29 });
    expect(summarize([]).n).toBe(0);
    expect(summarize([]).p95).toBeNull();
  });

  it('rounds and guards', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(null)).toBeNull();
    expect(round(Infinity)).toBeNull();
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 0)).toBeNull();
  });
});
