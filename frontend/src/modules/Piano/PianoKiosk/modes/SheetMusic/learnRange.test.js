import { describe, it, expect } from 'vitest';
import { pickLearnRange } from './learnRange.js';

// 8 measures, 1 step each; measures 0-1 are rest-only (no notes), the rest have RH notes.
const measures = Array.from({ length: 8 }, (_, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i }));
const steps = measures.map((m) => ({ notes: m.index < 2 ? [] : [{ midi: 60 + m.index, staff: 0 }] }));
const RH = { 0: true, 1: false };

describe('pickLearnRange', () => {
  it('frontier: first window where any measure is short of the pass threshold', () => {
    const passes = [3, 3, 3, 3, 2, 3, 3, 3]; // measure 4 not learned
    const r = pickLearnRange({ sections: [], measures, steps, activeParts: RH, passesByMeasure: passes });
    expect(r).toEqual({ inMeasure: 4, outMeasure: 7, reason: 'frontier' });
  });
  it('fully-learned history falls through to sections', () => {
    const passes = Array(8).fill(3);
    const r = pickLearnRange({ sections: [{ label: 'A', startMeasure: 3, endMeasure: 5 }], measures, steps, activeParts: RH, passesByMeasure: passes });
    expect(r).toEqual({ inMeasure: 2, outMeasure: 4, reason: 'section' });
  });
  it('no history, no sections: density floor skips the rest-heavy intro', () => {
    const r = pickLearnRange({ sections: [], measures, steps, activeParts: RH, passesByMeasure: null });
    expect(r.inMeasure).toBe(2);
    expect(r.reason).toBe('density');
  });
  it('all-rest piece falls back to the whole piece', () => {
    const restSteps = measures.map(() => ({ notes: [] }));
    const r = pickLearnRange({ sections: [], measures, steps: restSteps, activeParts: RH, passesByMeasure: null });
    expect(r).toEqual({ inMeasure: 0, outMeasure: 7, reason: 'whole' });
  });
});
