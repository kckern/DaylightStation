import { describe, it, expect } from 'vitest';
import { flattenCumulativeRegressions } from './cumulativeGuard.js';

describe('flattenCumulativeRegressions', () => {
  it('flattens a dip and reports it', () => {
    const series = { 'user:a:rings_total': [0, 88, 1, 2, 90], 'user:a:heart_rate': [90, 80, 70, 60, 50] };
    const found = flattenCumulativeRegressions(series);
    expect(series['user:a:rings_total']).toEqual([0, 88, 88, 88, 90]);
    expect(series['user:a:heart_rate']).toEqual([90, 80, 70, 60, 50]);
    expect(found).toEqual([{ key: 'user:a:rings_total', tick: 2, drop: 87 }]);
  });

  it('ignores nulls and clean series', () => {
    const series = { 'user:a:heart_beats': [null, 1, null, 3], 'global:rings_total': [0, 1, 2] };
    expect(flattenCumulativeRegressions(series)).toEqual([]);
  });
});
