import { describe, expect, it } from 'vitest';
import {
  advanceAssessmentAttempt,
  compileAssessmentExpectation,
  compileScoreExpectation,
  createAssessmentAttempt,
  finalizeAssessmentAttempt,
  observeAssessment,
  prepareExerciseAssessment,
  startAssessmentAttempt,
} from './assessmentAttempt.js';

const expectation = (events, extra = {}) => compileAssessmentExpectation({
  source: { kind: 'chart', id: 'test' }, events, ...extra,
});

describe('canonical compilation', () => {
  it('maps score staves, filters active parts, preserves rests and ties', () => {
    const compiled = compileScoreExpectation({
      source: { id: 'piece' }, activeParts: ['lh'], fallbackBpm: 90,
      notes: [
        { midi: 60, staff: 0, onsetQuarter: 0, durationQuarters: 1, measureIndex: 2 },
        { midi: 48, staff: 1, onsetQuarter: 0, durationQuarters: 1, measureIndex: 2 },
        { midi: 48, staff: 1, onsetQuarter: 1, durationQuarters: 1, measureIndex: 2, tie: 'stop' },
        { rest: true, staff: 1, onsetQuarter: 2, durationQuarters: 1, measureIndex: 2 },
      ],
    });
    expect(compiled.events).toHaveLength(2);
    expect(compiled.events[0].notes.map((note) => note.part)).toEqual(['lh']);
    expect(compiled.events[1].notes).toEqual([]);
    expect(compiled.events[0].spanId).toBe('measure:2');
  });

  it('uses authored exercise rhythm and refuses unknown cued values', () => {
    const instance = { id: 'scale', ordering: 'strict', tempo: { start_bpm: 120 }, events: [
      { value: 'quarter', notes: [{ midi: 60, hand: 'right' }] },
      { value: '8th', notes: [{ midi: 62, hand: 'right' }] },
    ] };
    expect(prepareExerciseAssessment({ instance, mode: 'cued' }).expectation.events.map((event) => event.onsetQuarter)).toEqual([0, 1]);
    expect(() => prepareExerciseAssessment({ instance: { ...instance, events: [{ value: 'quaver-ish', notes: [{ midi: 60 }] }] }, mode: 'cued' })).toThrow(/Unrecognized/);
  });
});

describe('immutable lifecycle', () => {
  it('accumulates an onset chord in either order and one attack satisfies a cross-part unison', () => {
    const source = expectation([{ id: 'one', onsetQuarter: 0, spanId: 'm:1', notes: [
      { midi: 60, part: 'rh' }, { midi: 48, part: 'lh' }, { midi: 60, part: 'lh' },
    ] }]);
    const started = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'cursor' }), { time: 10 });
    const first = observeAssessment(started, { midi: 48, time: 20 }).attempt;
    expect(started.hits).toEqual({});
    const second = observeAssessment(first, { midi: 60, time: 30 }).attempt;
    expect(second.status).toBe('completed');
    expect(Object.keys(second.hits)).toHaveLength(3);
  });

  it('skips rests, records wrong and ignored input, and is terminal-idempotent', () => {
    const source = expectation([
      { onsetQuarter: 0, notes: [] },
      { onsetQuarter: 1, notes: [{ midi: 60, part: 'rh' }] },
    ]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0, clock: 'perf' });
    attempt = observeAssessment(attempt, { midi: 90, time: 10, clock: 'perf' }).attempt;
    expect(attempt.ignored[0].reason).toBe('implausible_pitch');
    attempt = observeAssessment(attempt, { midi: 61, time: 20, clock: 'perf' }).attempt;
    expect(attempt.wrong).toHaveLength(1);
    attempt = observeAssessment(attempt, { midi: 60, time: 30, clock: 'perf' }).attempt;
    const finalized = finalizeAssessmentAttempt(attempt);
    expect(finalizeAssessmentAttempt(finalized)).toBe(finalized);
    expect(observeAssessment(finalized, { midi: 60, time: 40 }).event.reason).toBe('not_running');
  });

  it('matches timed logical notes, advances omissions, and includes placement only when timed', () => {
    const source = expectation([
      { id: 'a', onsetQuarter: 0, notes: [{ midi: 60, part: 'rh' }, { midi: 64, part: 'rh' }] },
      { id: 'b', onsetQuarter: 1, notes: [{ midi: 67, part: 'lh' }] },
    ], { tempoMap: [{ onsetQuarter: 0, bpm: 60 }] });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'cued' }), { time: 1000, leadInMs: 2000 });
    attempt = observeAssessment(attempt, { midi: 64, time: 3000 }).attempt;
    attempt = observeAssessment(attempt, { midi: 60, time: 3050 }).attempt;
    attempt = advanceAssessmentAttempt(attempt, 4500).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria.placement).toBeGreaterThan(0.49);
    expect(result.diagnostics.missed_notes).toBe(1);

    let free = startAssessmentAttempt(createAssessmentAttempt({ expectation: expectation([{ notes: [{ midi: 60, part: 'rh' }] }]) }), { time: 0 });
    free = observeAssessment(free, 60).attempt;
    expect(finalizeAssessmentAttempt(free).result.criteria).not.toHaveProperty('placement');
  });

  it('weights active parts equally despite unequal note density and persists custom weights', () => {
    const source = expectation([{ notes: [
      { midi: 60, part: 'rh' }, { midi: 64, part: 'rh' }, { midi: 67, part: 'rh' }, { midi: 48, part: 'lh' },
    ] }]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, grading: { part_weights: { rh: 1, lh: 3 } } }), { time: 0 });
    attempt = observeAssessment(attempt, 60).attempt;
    attempt = observeAssessment(attempt, 64).attempt;
    attempt = observeAssessment(attempt, 67).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.parts.rh.criteria.completeness).toBe(1);
    expect(result.parts.lh.criteria.completeness).toBe(0);
    expect(result.criteria.completeness).toBe(0.25);
    expect(result.rubric.part_weights).toEqual({ rh: 0.25, lh: 0.75 });
  });

  it('rejects invalid mode and rubric combinations during preparation', () => {
    const source = expectation([{ notes: [{ midi: 60 }] }]);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'free' })).toThrow(/requires cued/);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'cursor', requirement: { rubric: { criteria: { placement: 0.8 } } } })).toThrow(/Placement/);
  });
});
