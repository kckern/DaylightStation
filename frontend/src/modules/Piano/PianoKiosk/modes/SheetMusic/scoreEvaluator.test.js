import { describe, it, expect } from 'vitest';
import { gradePerformanceMeasure } from './scoreEvaluator.js';

const cfg = { timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } };

describe('gradePerformanceMeasure', () => {
  const target = (pitches, drifts = [], state = drifts.length === pitches.length ? 'hit' : 'missed') => ({
    pitches, drifts, state,
  });

  it('counts repeated attacks independently', () => {
    const g = gradePerformanceMeasure({
      targets: [target([60], [5]), target([60], [], 'missed')],
      unmatched: [],
    }, cfg);
    expect(g).toMatchObject({ expectedCount: 2, matchedCount: 1, noteScore: 0.5 });
  });

  it('penalizes unmatched notes', () => {
    const clean = gradePerformanceMeasure({ targets: [target([60], [0])], unmatched: [] }, cfg);
    const wrong = gradePerformanceMeasure({
      targets: [target([60], [0])],
      unmatched: [{ pitch: 61 }],
    }, cfg);
    expect(clean.noteScore).toBe(1);
    expect(wrong).toMatchObject({ wrongCount: 1, noteScore: 0.5 });
  });

  it('uses every chord pitch and its exact signed drift', () => {
    const g = gradePerformanceMeasure({ targets: [target([60, 64], [-20, 240])], unmatched: [] }, cfg);
    expect(g).toMatchObject({ expectedCount: 2, matchedCount: 2, noteScore: 1 });
    expect(g.timingScore).toBeLessThan(1);
  });

  it('marks an untouched expected measure silent and red', () => {
    const g = gradePerformanceMeasure({ targets: [target([60], [], 'missed')], unmatched: [] }, cfg);
    expect(g).toMatchObject({ grade: 'red', silent: true, rest: false, noteScore: 0 });
  });

  it('treats an untouched rest measure as green, but not a wrong note in a rest', () => {
    expect(gradePerformanceMeasure({ targets: [], unmatched: [] }, cfg))
      .toMatchObject({ grade: 'green', silent: false, rest: true });
    expect(gradePerformanceMeasure({ targets: [], unmatched: [{ pitch: 61 }] }, cfg))
      .toMatchObject({ grade: 'red', silent: false, rest: true, wrongCount: 1 });
  });
});
