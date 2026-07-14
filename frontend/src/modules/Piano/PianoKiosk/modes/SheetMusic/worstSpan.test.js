import { describe, it, expect } from 'vitest';
import { worstSpan } from './worstSpan.js';

// Build a grades map keyed by measure index from a compact spec.
const g = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { grade: v }]));

describe('worstSpan', () => {
  it('null when everything is green or ungraded', () => {
    expect(worstSpan(g({ 0: 'green', 1: 'green' }))).toBeNull();
    expect(worstSpan({})).toBeNull();
  });

  it('picks the heaviest contiguous non-green run (red=2, yellow=1)', () => {
    expect(worstSpan(g({ 0: 'green', 1: 'yellow', 2: 'red', 3: 'red', 4: 'green', 5: 'yellow' })))
      .toEqual({ inMeasure: 1, outMeasure: 3 });
  });

  it('a lone red beats two scattered yellows', () => {
    expect(worstSpan(g({ 0: 'yellow', 1: 'green', 2: 'red', 3: 'green', 4: 'yellow' })))
      .toEqual({ inMeasure: 2, outMeasure: 2 });
  });

  it('ties on weight go to the earlier span', () => {
    expect(worstSpan(g({ 0: 'red', 1: 'green', 2: 'red' })))
      .toEqual({ inMeasure: 0, outMeasure: 0 });
  });

  it('a run is broken by a gap in measure indices, not just by a green', () => {
    // measures 2 and 4 are both red but not adjacent → two separate lone-red spans.
    expect(worstSpan(g({ 2: 'red', 4: 'red' })))
      .toEqual({ inMeasure: 2, outMeasure: 2 });
  });
});
