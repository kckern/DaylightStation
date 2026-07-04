import { describe, it, expect } from 'vitest';
import { buildMeasures } from './osmdRender.js';

// `number` is the printed measure NUMBER (1-based here), distinct from the 0-based
// `measure` INDEX, so section rehearsal marks can map their numbers to indices.
const STEPS = [
  { onsetQuarter: 0, measure: 0, number: 1, notes: [] },
  { onsetQuarter: 1, measure: 0, number: 1, notes: [] },
  { onsetQuarter: 2, measure: 1, number: 2, notes: [] },
];

describe('buildMeasures', () => {
  it('groups steps into measures with number + first/last step indices', () => {
    expect(buildMeasures(STEPS)).toEqual([
      { index: 0, number: 1, firstStep: 0, lastStep: 1 },
      { index: 1, number: 2, firstStep: 2, lastStep: 2 },
    ]);
  });
  it('falls back to index+1 when a step carries no printed number', () => {
    expect(buildMeasures([{ measure: 4, notes: [] }])).toEqual([
      { index: 4, number: 5, firstStep: 0, lastStep: 0 },
    ]);
  });
  it('returns [] for empty input', () => {
    expect(buildMeasures([])).toEqual([]);
  });
});
