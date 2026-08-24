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

  it('deep-freezes canonical expectations and preserves explicit authored offsets', () => {
    const compiled = prepareExerciseAssessment({
      mode: 'cued',
      instance: { id: 'syncopation', ordering: 'strict', tempo: { start_bpm: 90 }, events: [
        { onsetQuarter: 0.5, value: 'eighth', notes: [{ midi: 60 }] },
        { onsetQuarter: 1.5, value: 'quarter', notes: [{ midi: 62 }] },
      ] },
    }).expectation;
    expect(compiled.events.map((event) => event.onsetQuarter)).toEqual([0.5, 1.5]);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.source)).toBe(true);
    expect(Object.isFrozen(compiled.events)).toBe(true);
    expect(Object.isFrozen(compiled.events[0].notes[0])).toBe(true);
  });

  it('selects exercise matchers from mode and ordering without inventing hand data', () => {
    const chord = { id: 'triad', ordering: 'any', tempo: { start_bpm: 84 }, events: [
      { value: 'half', notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }] },
    ] };
    const free = prepareExerciseAssessment({ instance: chord, mode: 'free' });
    const metronome = prepareExerciseAssessment({ instance: chord, mode: 'metronome' });
    const cued = prepareExerciseAssessment({ instance: chord, mode: 'cued' });
    expect(free.matcher).toBe('held');
    expect(metronome.matcher).toBe('held');
    expect(cued.matcher).toBe('timed');
    expect(metronome.requirement.rubric.criteria).toEqual({ completeness: 1, cleanliness: 1 });
    expect(metronome.requirement).not.toHaveProperty('gates');
    expect(cued.requirement.rubric.criteria.placement).toBe(0.8);
    expect(cued.requirement.gates.pace.target_bpm).toBe(84);
    expect(cued.expectation.events[0].notes.every((note) => note.part === 'unassigned')).toBe(true);
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
    expect(observeAssessment(finalized, { midi: 60, time: 40 }).event.reason).toBe('terminated');
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

  it('attributes wrong notes by nearest register but keeps equal-distance ties out of part diagnostics', () => {
    const source = expectation([{ spanId: 'm:1', notes: [{ midi: 60, part: 'rh' }, { midi: 48, part: 'lh' }] }]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0 });
    attempt = observeAssessment(attempt, 50).attempt;
    attempt = observeAssessment(attempt, 54).attempt;
    attempt = observeAssessment(attempt, 48).attempt;
    attempt = observeAssessment(attempt, 60).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.parts.lh.diagnostics.wrong_notes).toBe(1);
    expect(result.parts.rh.diagnostics.wrong_notes).toBe(0);
    expect(result.diagnostics.wrong_notes).toBe(2);
    expect(result.criteria.cleanliness).toBeLessThan(1);
  });

  it('retains attributed and ambiguous wrong-note evidence inside each span', () => {
    const source = expectation([{ id: 'onset', spanId: 'measure:3', notes: [
      { midi: 60, part: 'rh' }, { midi: 48, part: 'lh' },
    ] }]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0 });
    attempt = observeAssessment(attempt, 50).attempt;
    attempt = observeAssessment(attempt, 54).attempt;
    attempt = observeAssessment(attempt, 48).attempt;
    attempt = observeAssessment(attempt, 60).attempt;
    const span = finalizeAssessmentAttempt(attempt).result.spans['measure:3'];
    expect(span.parts.lh.diagnostics.wrong_notes).toBe(1);
    expect(span.parts.rh.diagnostics.wrong_notes).toBe(0);
    expect(span.diagnostics.wrong_notes).toBe(2);
    expect(span.criteria.cleanliness).toBeLessThan(1);
  });

  it('rejects invalid mode and rubric combinations during preparation', () => {
    const source = expectation([{ notes: [{ midi: 60 }] }]);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'free' })).toThrow(/requires cued/);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'cursor', requirement: { rubric: { criteria: { placement: 0.8 } } } })).toThrow(/Placement/);
  });
});
