import { describe, it, expect } from 'vitest';
import { gradePerformanceMeasure, POLICY_VERSION } from './scoreEvaluator.js';

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

describe('polish grades through the shared performance service', () => {
  const measure = (targets, unmatched = []) => ({ targets, unmatched });
  const onTime = (pitches) => ({ pitches, drifts: pitches.map(() => 0) });

  it('stamps the grading policy, so old records stay distinguishable', () => {
    const result = gradePerformanceMeasure(measure([onTime([60, 64])]));
    expect(result.policyVersion).toBe(POLICY_VERSION);
  });

  it('penalises a note never struck, which a drill cannot produce', () => {
    // Two notes expected, one played on time, none wrong: the missing note has
    // to cost something even though nothing incorrect happened.
    const played = gradePerformanceMeasure(measure([{ pitches: [60, 64], drifts: [0] }]));
    const complete = gradePerformanceMeasure(measure([onTime([60, 64])]));
    expect(played.combined).toBeLessThan(complete.combined);
    expect(played.noteScore).toBeLessThan(1);
  });

  it('reports continuity, a dimension the old evaluator never produced', () => {
    expect(gradePerformanceMeasure(measure([onTime([60])])).continuity).toBe(1);
    expect(gradePerformanceMeasure(measure([onTime([60])], [61])).continuity).toBeLessThan(1);
  });

  it('treats drift inside the tolerance as on time, and far drift as late', () => {
    const tight = gradePerformanceMeasure(measure([{ pitches: [60], drifts: [40] }]));
    const loose = gradePerformanceMeasure(measure([{ pitches: [60], drifts: [400] }]));
    expect(tight.timingScore).toBe(1);
    expect(loose.timingScore).toBe(0);
    expect(tight.combined).toBeGreaterThan(loose.combined);
  });

  it('still passes a bar of rests kept silent', () => {
    const silentRest = gradePerformanceMeasure(measure([]));
    expect(silentRest.rest).toBe(true);
    expect(silentRest.grade).toBe('green');
    expect(gradePerformanceMeasure(measure([], [60])).grade).toBe('red');
  });
});
