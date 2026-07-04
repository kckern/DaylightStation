import { describe, it, expect } from 'vitest';
import { gradeMeasure } from './scoreEvaluator.js';

const cfg = { timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } };

describe('gradeMeasure', () => {
  it('all notes on time → green, noteScore 1', () => {
    const g = gradeMeasure({ expected: [60, 64], hits: [{ note: 60, driftMs: 10 }, { note: 64, driftMs: -20 }] }, cfg);
    expect(g.grade).toBe('green');
    expect(g.noteScore).toBe(1);
    expect(g.timingScore).toBeGreaterThan(0.9);
  });
  it('missed a note → noteScore 0.5, grade drops', () => {
    const g = gradeMeasure({ expected: [60, 64], hits: [{ note: 60, driftMs: 5 }] }, cfg);
    expect(g.noteScore).toBe(0.5);
    expect(['yellow', 'red']).toContain(g.grade);
  });
  it('right notes but very late → timing pulls the grade down', () => {
    const g = gradeMeasure({ expected: [60], hits: [{ note: 60, driftMs: 400 }] }, cfg);
    expect(g.noteScore).toBe(1);
    expect(g.timingScore).toBeLessThan(0.5);
  });
  it('empty measure → red + silent flag', () => {
    const g = gradeMeasure({ expected: [60], hits: [] }, cfg);
    expect(g.grade).toBe('red');
    expect(g.silent).toBe(true);
    expect(g.noteScore).toBe(0);
  });
  it('a measure with no expected notes (rest bar) → green, not silent', () => {
    const g = gradeMeasure({ expected: [], hits: [] }, cfg);
    expect(g.grade).toBe('green');
    expect(g.silent).toBe(false);
  });
});
