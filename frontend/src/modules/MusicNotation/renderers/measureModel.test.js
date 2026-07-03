import { describe, it, expect } from 'vitest';
import { buildMeasures } from './osmdRender.js';

const STEPS = [
  { onsetQuarter: 0, measure: 0, notes: [] },
  { onsetQuarter: 1, measure: 0, notes: [] },
  { onsetQuarter: 2, measure: 1, notes: [] },
];

describe('buildMeasures', () => {
  it('groups steps into measures with first/last step indices', () => {
    expect(buildMeasures(STEPS)).toEqual([
      { index: 0, firstStep: 0, lastStep: 1 },
      { index: 1, firstStep: 2, lastStep: 2 },
    ]);
  });
  it('returns [] for empty input', () => {
    expect(buildMeasures([])).toEqual([]);
  });
});
