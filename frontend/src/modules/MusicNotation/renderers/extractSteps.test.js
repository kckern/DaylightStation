import { describe, it, expect } from 'vitest';
import { buildSteps } from './osmdRender.js';

// onsetRecords: what the OSMD walk collects per note, pre-grouping
const RECS = [
  { onsetQuarter: 0, midi: 60, staff: 0, x: 10, top: 5,  bottom: 20, width: 8 },
  { onsetQuarter: 0, midi: 48, staff: 1, x: 10, top: 40, bottom: 55, width: 8 },
  { onsetQuarter: 1, midi: 64, staff: 0, x: 30, top: 4,  bottom: 19, width: 8 },
];

describe('buildSteps', () => {
  it('groups onset records into steps by onsetQuarter, keeping all staves', () => {
    const steps = buildSteps(RECS);
    expect(steps).toHaveLength(2);
    expect(steps[0].onsetQuarter).toBe(0);
    expect(steps[0].notes.map((n) => n.midi).sort()).toEqual([48, 60]);
    expect(steps[0].notes.find((n) => n.midi === 48)).toMatchObject({ staff: 1, top: 40 });
    expect(steps[1].notes).toHaveLength(1);
  });

  it('sorts steps by onsetQuarter', () => {
    const steps = buildSteps([RECS[2], RECS[0]]);
    expect(steps.map((s) => s.onsetQuarter)).toEqual([0, 1]);
  });
});
