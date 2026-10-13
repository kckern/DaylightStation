import { describe, expect, it } from 'vitest';
import { resolveExerciseRunAccess } from './authorization.js';
import { runPassed, wrongEventState } from './ExerciseRun.jsx';

describe('ExerciseRun authorization', () => {
  it('allows guest practice but never downgrades a guest challenge into practice', () => {
    expect(resolveExerciseRunAccess('practice', 'guest')).toEqual({
      challenge: false, persistent: false, allowed: true,
    });
    expect(resolveExerciseRunAccess('challenge', 'guest')).toEqual({
      challenge: true, persistent: false, allowed: false,
    });
  });

  it('allows a persistent player to run either purpose', () => {
    expect(resolveExerciseRunAccess('practice', 'learner4')).toEqual({
      challenge: false, persistent: true, allowed: true,
    });
    expect(resolveExerciseRunAccess('challenge', 'learner4')).toEqual({
      challenge: true, persistent: true, allowed: true,
    });
  });
});

describe('ExerciseRun wrong-note state', () => {
  // `lastWrong` is `null | { midi, eventId }` — never a bare boolean. Every
  // matcher already emits both fields (assessmentAttempt.js wrong events), and
  // the played pitch is what the keyboard footer highlights.
  it('keeps the played midi and the event it was played against', () => {
    expect(wrongEventState({ type: 'wrong', midi: 61, eventId: 'first' }))
      .toEqual({ midi: 61, eventId: 'first' });
  });

  it('clears on any non-wrong event, and on no event at all', () => {
    expect(wrongEventState({ type: 'hit', eventId: 'first' })).toBeNull();
    expect(wrongEventState({ type: 'onset_complete', eventId: 'first' })).toBeNull();
    expect(wrongEventState(undefined)).toBeNull();
  });
});

describe('ExerciseRun pass decision', () => {
  // A non-floor rung carries a passScore and NO rubric, so the engine's
  // verdict is unconditionally true — this is the exact shape the gate sends.
  const rungResult = (score) => ({ score, verdict: { passed: true, failed_criteria: [], failed_gates: [] } });

  it('judges a non-floor rung on its passScore, not the engine verdict', () => {
    expect(runPassed(rungResult(0.7), { challenge: true, passScore: 0.8 })).toBe(false);
    expect(runPassed(rungResult(0.8), { challenge: true, passScore: 0.8 })).toBe(true);
    expect(runPassed(rungResult(0), { challenge: true, passScore: 0.8 })).toBe(false);
  });

  it('leaves the floor to the engine verdict — passScore null is not a score of zero', () => {
    // `Number(null)` is 0 and IS finite. If that reached the numeric branch the
    // floor would become `score >= 0` and stop testing anything at all.
    expect(runPassed({ score: 0.4, verdict: { passed: true } }, { challenge: true, passScore: null })).toBe(true);
    expect(runPassed({ score: 0.4, verdict: { passed: false } }, { challenge: true, passScore: null })).toBe(false);
  });

  it('ignores a passScore outside a challenge, and has no opinion without a result', () => {
    expect(runPassed({ score: 0.1, verdict: { passed: true } }, { challenge: false, passScore: 0.8 })).toBe(true);
    expect(runPassed(null, { challenge: true, passScore: 0.8 })).toBe(false);
  });
});
