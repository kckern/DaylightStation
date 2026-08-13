import { describe, expect, it } from 'vitest';
import {
  advanceAssessment,
  applyAssessmentHeld,
  applyAssessmentPress,
  classifyHeldNotes,
  classifyCursorStep,
  createAssessmentSession,
  evaluateAssessment,
  findWorstAssessmentSpan,
  finalizeAssessment,
  gradeAssessmentSpan,
  tallyAssessmentGrades,
} from './assessmentSession.js';

const held = (...notes) => new Map(notes.map((note, index) => [note, { timestamp: 100 + index * 20 }]));

describe('assessmentSession', () => {
  it('parameterizes exact-midi and pitch-class held matching', () => {
    expect(classifyHeldNotes(held(60, 64, 67, 72), { pitches: [60, 64, 67] }, { allowExtras: true })).toBe('correct');
    expect(classifyHeldNotes(held(64, 67, 72), {
      root: 0, pitchClasses: new Set([0, 4, 7]),
    }, { equivalence: 'pitch-class', bassMustBeRoot: true })).toBe('wrong');
    expect(classifyHeldNotes(held(60, 64, 67), {
      root: 0, pitchClasses: new Set([0, 4, 7]),
    }, { equivalence: 'pitch-class', bassMustBeRoot: true })).toBe('correct');
  });

  it('counts one held-set mistake per key gesture and produces criteria', () => {
    let session = createAssessmentSession({
      matcher: 'held', expectation: { pitches: [60] }, policy: { allowExtras: false },
    });
    session = applyAssessmentHeld(session, held(61), 100).session;
    session = applyAssessmentHeld(session, held(61, 62), 120).session;
    expect(session.run.wrongNotes).toBe(1);
    session = applyAssessmentHeld(session, new Map(), 130).session;
    session = applyAssessmentHeld(session, held(60), 140).session;
    const result = finalizeAssessment(session);
    expect(result.criteria).toMatchObject({ completeness: 1, cleanliness: 0.5 });
  });

  it('runs ordered cursor matching and grades the completed observation', () => {
    let session = createAssessmentSession({
      matcher: 'cursor', expectation: { spans: [{ id: 'a', expectedMidi: [60, 62] }] },
    });
    session = applyAssessmentPress(session, 61).session;
    session = applyAssessmentPress(session, 60).session;
    session = applyAssessmentPress(session, 62).session;
    const result = finalizeAssessment(session);
    expect(result.criteria).toMatchObject({ completeness: 1, cleanliness: 2 / 3 });
  });

  it('supports order-free chord steps and ignores implausibly distant input', () => {
    let result = classifyCursorStep(new Set([60, 64]), new Set(), 64);
    expect(result).toMatchObject({ status: 'hit', complete: false });
    result = classifyCursorStep(new Set([60, 64]), result.struck, 60);
    expect(result).toMatchObject({ status: 'complete', complete: true });
    expect(classifyCursorStep(new Set([60]), new Set(), 61).status).toBe('wrong');
    expect(classifyCursorStep(new Set([60]), new Set(), 90).status).toBe('ignored');
  });

  it('runs timed matching, span grading, criteria, and a pace gate', () => {
    let session = createAssessmentSession({
      matcher: 'timed',
      expectation: { targets: [
        { id: 1, pitches: [60], targetTimeMs: 1000, measureIndex: 0 },
        { id: 2, pitches: [62], targetTimeMs: 1500, measureIndex: 0 },
      ] },
      policy: { perfectWindowMs: 90, goodWindowMs: 220, matchWindowMs: 220, missWindowMs: 420 },
      requirement: {
        rubric: { id: 'test-v1', version: '1', criteria: { completeness: 1, cleanliness: 1, placement: 0.8 } },
        gates: { pace: { target_bpm: 80 } },
      },
    });
    session = applyAssessmentPress(session, 60, 1020, { measureIndex: 0 }).session;
    session = applyAssessmentPress(session, 61, 1200, { measureIndex: 0 }).session;
    session = applyAssessmentPress(session, 62, 1520, { measureIndex: 0 }).session;
    session = advanceAssessment(session, 2000).session;
    const span = gradeAssessmentSpan(session, 0);
    expect(span).toMatchObject({ expectedCount: 2, matchedCount: 2, wrongCount: 1 });
    const result = finalizeAssessment(session, { achievedBpm: 80 });
    expect(result.criteria.completeness).toBe(1);
    expect(result.criteria.cleanliness).toBeCloseTo(2 / 3);
    expect(result.gates.pace.passed).toBe(true);
    expect(result.verdict.passed).toBe(false);
  });

  it('applies one shared rubric evaluator to a surface-specific score projection', () => {
    const result = evaluateAssessment({
      criteria: { completeness: 1, cleanliness: 0.8 },
      score: 0.75,
      requirement: { rubric: { id: 'projection-v1', version: '2', criteria: { cleanliness: 0.7 } } },
    });
    expect(result).toMatchObject({ score: 0.75, rubric: { id: 'projection-v1', version: '2' }, verdict: { passed: true } });
  });

  it('keeps span aggregation behind the public assessment facade', () => {
    const grades = {
      0: { grade: 'green' },
      1: { grade: 'red' },
      2: { grade: 'yellow' },
    };
    expect(tallyAssessmentGrades(grades)).toMatchObject({ green: 1, yellow: 1, red: 1 });
    expect(findWorstAssessmentSpan(grades)).toEqual({ inMeasure: 1, outMeasure: 2 });
  });
});
