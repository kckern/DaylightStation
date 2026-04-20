import { describe, it, expect } from 'vitest';
import { downsample } from '#apps/home-automation/services/TimeSeriesDownsampler.mjs';

describe('TimeSeriesDownsampler.downsample', () => {
  it('returns the series unchanged when shorter than target', () => {
    const series = [{ t: 't1', v: 1 }, { t: 't2', v: 2 }];
    expect(downsample(series, 10)).toEqual(series);
  });
  it('downsamples long series to target size by bucketed average', () => {
    const series = Array.from({ length: 1000 }, (_, i) => ({ t: `t${i}`, v: i }));
    const out = downsample(series, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].v).toBeGreaterThanOrEqual(0);
    expect(out.at(-1).v).toBeLessThanOrEqual(999);
  });
  it('handles non-numeric values by keeping first of each bucket', () => {
    const series = [
      { t: 't1', v: 'auto' }, { t: 't2', v: 'auto' },
      { t: 't3', v: 'heat' }, { t: 't4', v: 'heat' },
    ];
    const out = downsample(series, 2);
    expect(out).toHaveLength(2);
    expect(out[0].v).toBe('auto');
    expect(out[1].v).toBe('heat');
  });
  it('returns [] for empty input', () => {
    expect(downsample([], 10)).toEqual([]);
  });
});
