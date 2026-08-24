import { describe, expect, it } from 'vitest';
import {
  advanceAssessment,
  closeAssessmentSpan,
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
        { midi: 48, staff: 1, onsetQuarter: 0, durationQuarters: 1, measureIndex: 2, tie: 'start' },
        { midi: 48, staff: 1, onsetQuarter: 1, durationQuarters: 1, measureIndex: 2, tie: 'stop' },
        { rest: true, staff: 1, onsetQuarter: 2, durationQuarters: 1, measureIndex: 2 },
      ],
    });
    expect(compiled.events).toHaveLength(2);
    expect(compiled.events[0].notes.map((note) => note.part)).toEqual(['lh']);
    expect(compiled.events[0].notes[0].durationQuarters).toBe(2);
    expect(compiled.events[0].durationQuarters).toBe(2);
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
    expect(() => prepareExerciseAssessment({
      instance: { id: 'untimed-sequence', tempo: { start_bpm: 90 }, events: [{ notes: [{ midi: 60 }] }, { notes: [{ midi: 62 }] }] },
      mode: 'cued',
    })).toThrow(/Unrecognized/);
    expect(prepareExerciseAssessment({
      instance: { id: 'single-chord', ordering: 'any', tempo: { start_bpm: 90 }, events: [{ notes: [{ midi: 60 }, { midi: 64 }] }] },
      mode: 'cued',
    }).expectation.events[0]).toMatchObject({ onsetQuarter: 0, durationQuarters: 0 });
    const legacyCued = prepareExerciseAssessment({
      instance: { id: 'legacy-chord', ordering: 'any', events: [{ notes: [{ midi: 60 }, { midi: 64 }] }] },
      mode: 'cued',
    });
    expect(legacyCued.expectation.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 90 }]);
    expect(legacyCued.requirement.gates.pace.target_bpm).toBe(90);
    expect(prepareExerciseAssessment({
      instance: { id: 'triplets', tempo: { start_bpm: 90 }, events: [
        { value: 'triplet-8th', notes: [{ midi: 60 }] },
        { value: 'triplet-8th', notes: [{ midi: 62 }] },
      ] },
      mode: 'cued',
    }).expectation.events[1].onsetQuarter).toBeCloseTo(1 / 3);
  });

  it('deep-freezes canonical expectations and preserves explicit authored offsets', () => {
    const compiled = prepareExerciseAssessment({
      mode: 'cued',
      instance: { id: 'syncopation', ordering: 'strict', tempo: { start_bpm: 90 }, events: [
        { onsetQuarter: 0.5, value: 'eighth', renderer: { mutable: true }, notes: [{ midi: 60, element: { mutable: true } }] },
        { onsetQuarter: 1.5, value: 'quarter', notes: [{ midi: 62 }] },
      ] },
    }).expectation;
    expect(compiled.events.map((event) => event.onsetQuarter)).toEqual([0.5, 1.5]);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.source)).toBe(true);
    expect(Object.isFrozen(compiled.events)).toBe(true);
    expect(Object.isFrozen(compiled.events[0].notes[0])).toBe(true);
    expect(compiled.events[0]).not.toHaveProperty('renderer');
    expect(compiled.events[0].notes[0]).not.toHaveProperty('element');
  });

  it('rejects ambiguous identities and malformed canonical values at compilation', () => {
    expect(() => expectation([
      { id: 'same', notes: [{ midi: 60 }] },
      { id: 'same', onsetQuarter: 1, notes: [{ midi: 62 }] },
    ])).toThrow(/Duplicate assessment event id/);
    expect(() => expectation([{ id: 'event', notes: [
      { id: 'same-note', midi: 60, part: 'rh' },
      { id: 'same-note', midi: 64, part: 'rh' },
    ] }])).toThrow(/Duplicate assessment note id/);
    expect(() => expectation([{ onsetQuarter: -1, notes: [] }])).toThrow(/onsetQuarter/);
    expect(() => expectation([{ notes: [{ midi: 128 }] }])).toThrow(/Invalid MIDI/);
    expect(() => compileAssessmentExpectation({ source: { kind: 'command', id: 'not-musical' }, events: [] })).toThrow(/source kind/);
  });

  it('assigns stable identities to additional score staves and preserves tempo changes', () => {
    const compiled = compileScoreExpectation({
      source: { id: 'three-staff-score', revision: 'rev-2' },
      tempoMap: [{ onsetQuarter: 0, bpm: 72 }, { onsetQuarter: 8, bpm: 96 }],
      notes: [
        { midi: 60, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 48, staff: 1, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 36, staff: 2, onsetQuarter: 0, durationQuarters: 1 },
      ],
    });
    expect(compiled.source).toEqual({ kind: 'score', id: 'three-staff-score', revision: 'rev-2' });
    expect(compiled.events[0].notes.map((note) => note.part)).toEqual(['rh', 'lh', 'staff-2']);
    expect(compiled.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 72 }, { onsetQuarter: 8, bpm: 96 }]);
  });

  it('preserves a later first tempo marking and requires a real onset-zero tempo for cued use', () => {
    const compiled = expectation([{ onsetQuarter: 4, notes: [{ midi: 60 }] }], {
      tempoMap: [{ onsetQuarter: 4, bpm: 96 }],
    });
    expect(compiled.tempoMap).toEqual([{ onsetQuarter: 4, bpm: 96 }]);
    expect(() => createAssessmentAttempt({ expectation: compiled, matcher: 'timed', mode: 'cued' })).toThrow(/onset zero/);

    const withFallback = compileScoreExpectation({
      fallbackBpm: 72,
      tempoMap: [{ onsetQuarter: 4, bpm: 96 }],
      notes: [{ onsetQuarter: 4, durationQuarters: 1, midi: 60 }],
    });
    expect(withFallback.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 72 }, { onsetQuarter: 4, bpm: 96 }]);
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
  it('enforces strict event order while keeping notes within an onset order-free', () => {
    const source = expectation([
      { id: 'first', notes: [{ midi: 60, part: 'rh' }, { midi: 64, part: 'rh' }] },
      { id: 'second', onsetQuarter: 1, notes: [{ midi: 67, part: 'rh' }] },
    ]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'cursor' }), { time: 0 });
    const early = observeAssessment(attempt, { midi: 67, time: 10 });
    expect(early.event).toMatchObject({ type: 'wrong', eventId: 'first' });
    expect(early.attempt.cursor).toBe(0);
    attempt = observeAssessment(early.attempt, { midi: 64, time: 20 }).attempt;
    attempt = observeAssessment(attempt, { midi: 60, time: 30 }).attempt;
    expect(attempt.cursor).toBe(1);
    attempt = observeAssessment(attempt, { midi: 67, time: 50 }).attempt;
    expect(attempt.status).toBe('completed');
    expect(finalizeAssessmentAttempt(attempt).result.diagnostics.response_median_ms).toBe(20);
  });

  it('reports pre-start, wrong-clock, and post-terminal input without grading it', () => {
    const prepared = createAssessmentAttempt({
      expectation: expectation([{ notes: [{ midi: 60, part: 'rh' }] }]),
      clock: 'performance',
    });
    const before = observeAssessment(prepared, { midi: 60, time: 1, clock: 'performance' });
    expect(before.event).toEqual({ type: 'ignored', reason: 'before_start' });
    let attempt = startAssessmentAttempt(before.attempt, { time: 10, clock: 'performance' });
    const foreign = observeAssessment(attempt, { midi: 60, time: 20, clock: 'wall' });
    expect(foreign.event).toEqual({ type: 'ignored', reason: 'wrong_clock' });
    expect(foreign.attempt.musicalInput).toBe(false);
    const unclaimed = observeAssessment(foreign.attempt, { midi: 60, time: 25 });
    expect(unclaimed.event).toEqual({ type: 'ignored', reason: 'missing_clock' });
    expect(unclaimed.attempt.musicalInput).toBe(false);
    attempt = observeAssessment(unclaimed.attempt, { midi: 60, time: 30, clock: 'performance' }).attempt;
    const stale = observeAssessment(attempt, { midi: 61, time: 40, clock: 'performance' });
    expect(stale.event).toEqual({ type: 'ignored', reason: 'terminated' });
    expect(stale.attempt).toBe(attempt);
    expect(stale.attempt.wrong).toEqual([]);
  });

  it('does not manufacture a completed result for an attempt that never started', () => {
    const prepared = createAssessmentAttempt({ expectation: expectation([{ notes: [{ midi: 60 }] }]) });
    expect(() => finalizeAssessmentAttempt(prepared)).toThrow(/must be started/);
    expect(finalizeAssessmentAttempt(prepared, { status: 'aborted' }).result).toEqual({
      status: 'aborted',
      diagnostics: { expected_notes: 1, matched_notes: 0, wrong_notes: 0, missed_notes: 1 },
    });
  });

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

  it('retains rest-only spans in portable evidence', () => {
    const source = expectation([
      { id: 'rest', onsetQuarter: 0, spanId: 'measure:1', notes: [] },
      { id: 'note', onsetQuarter: 1, spanId: 'measure:2', notes: [{ midi: 60, part: 'rh' }] },
    ]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0 });
    attempt = observeAssessment(attempt, { midi: 60, time: 10 }).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.spans['measure:1']).toMatchObject({
      criteria: { completeness: 1, cleanliness: 1 },
      diagnostics: { expected_notes: 0, matched_notes: 0, wrong_notes: 0, missed_notes: 0 },
    });
  });

  it('matches timed logical notes, advances omissions, and includes placement only when timed', () => {
    const source = expectation([
      { id: 'a', onsetQuarter: 0, notes: [{ midi: 60, part: 'rh' }, { midi: 64, part: 'rh' }] },
      { id: 'b', onsetQuarter: 1, notes: [{ midi: 67, part: 'lh' }] },
    ], { tempoMap: [{ onsetQuarter: 0, bpm: 60 }] });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'cued' }), { time: 1000, leadInMs: 2000 });
    attempt = observeAssessment(attempt, { midi: 64, time: 3000 }).attempt;
    attempt = observeAssessment(attempt, { midi: 60, time: 3050 }).attempt;
    attempt = advanceAssessment(attempt, 4500).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria.placement).toBeGreaterThan(0.49);
    expect(result.diagnostics.missed_notes).toBe(1);

    let free = startAssessmentAttempt(createAssessmentAttempt({ expectation: expectation([{ notes: [{ midi: 60, part: 'rh' }] }]) }), { time: 0 });
    free = observeAssessment(free, 60).attempt;
    expect(finalizeAssessmentAttempt(free).result.criteria).not.toHaveProperty('placement');
  });

  it('uses the authored tempo interval when a timed range starts after a tempo change', () => {
    const source = expectation([
      { id: 'focus', onsetQuarter: 8, notes: [{ midi: 60, part: 'rh' }] },
    ], { tempoMap: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 4, bpm: 120 }] });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'cued' }), {
      time: 1000, originQuarter: 4, clock: 'focus',
    });
    attempt = observeAssessment(attempt, { midi: 60, time: 3000, clock: 'focus' }).attempt;
    expect(attempt.status).toBe('completed');
    expect(attempt.hits['focus-rh-60-1'].driftMs).toBe(0);
  });

  it('persists the effective cued tempo as re-evaluable pace-gate evidence', () => {
    const source = expectation([{ id: 'paced', onsetQuarter: 8, notes: [{ midi: 60, part: 'rh' }] }], {
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 4, bpm: 90 }],
    });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({
      expectation: source,
      matcher: 'timed',
      mode: 'cued',
      requirement: {
        rubric: { criteria: { completeness: 1, cleanliness: 1, placement: 0.8 } },
        gates: { pace: { target_bpm: 90 } },
      },
    }), { time: 0, originQuarter: 4 });
    attempt = observeAssessment(attempt, { midi: 60, time: 2666.6666666666665 }).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.gates).toEqual({ pace: { passed: true, actual: 90, target: 90 } });
    expect(result.verdict.failed_gates).toEqual([]);
  });

  it('matches the nearest pending logical target when a pitch repeats', () => {
    const source = expectation([
      { id: 'early', onsetQuarter: 0, notes: [{ midi: 60, part: 'rh' }] },
      { id: 'near', onsetQuarter: 1, notes: [{ midi: 60, part: 'rh' }] },
    ], { tempoMap: [{ onsetQuarter: 0, bpm: 60 }] });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({
      expectation: source,
      matcher: 'timed',
      mode: 'cued',
    }), { time: 0 });
    attempt = observeAssessment(attempt, { midi: 60, time: 950 }).attempt;
    expect(attempt.hits['near-rh-60-1']).toMatchObject({ driftMs: -50 });
    expect(attempt.hits).not.toHaveProperty('early-rh-60-1');
  });

  it('closes spans with omission evidence and an immediately usable span result', () => {
    const source = expectation([
      { id: 'm1', spanId: 'measure:1', notes: [{ midi: 60, part: 'rh' }] },
      { id: 'm2', onsetQuarter: 1, spanId: 'measure:2', notes: [{ midi: 62, part: 'rh' }] },
    ]);
    const started = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0 });
    const closed = closeAssessmentSpan(started, 'measure:1', 500);
    expect(closed.attempt.closedSpans).toEqual(['measure:1']);
    expect(closed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'miss', eventId: 'm1' }),
      expect.objectContaining({ type: 'span_complete', spanId: 'measure:1' }),
    ]));
    expect(closed.events.at(-1).result).toMatchObject({
      criteria: { completeness: 0, cleanliness: 0 },
      diagnostics: { expected_notes: 1, matched_notes: 0, missed_notes: 1 },
    });
  });

  it('completes rest-only material immediately and scores it as satisfied', () => {
    const source = expectation([{ id: 'rest', onsetQuarter: 0, durationQuarters: 4, notes: [] }]);
    const started = startAssessmentAttempt(createAssessmentAttempt({ expectation: source }), { time: 0 });
    expect(started.status).toBe('completed');
    expect(finalizeAssessmentAttempt(started).result).toMatchObject({
      score: 1, criteria: { completeness: 1, cleanliness: 1 }, diagnostics: { expected_notes: 0 },
    });
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

  it('scores and persists requirement rubric weights unless grading overrides them', () => {
    const source = expectation([{ notes: [{ midi: 60, part: 'rh' }, { midi: 64, part: 'rh' }] }]);
    let attempt = startAssessmentAttempt(createAssessmentAttempt({
      expectation: source,
      requirement: { rubric: { weights: { completeness: 0, cleanliness: 1 } } },
    }), { time: 0 });
    attempt = observeAssessment(attempt, 60).attempt;
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria).toEqual({ completeness: 0.5, cleanliness: 1 });
    expect(result.score).toBe(1);
    expect(result.rubric.weights).toEqual({ completeness: 0, cleanliness: 1 });

    const overridden = finalizeAssessmentAttempt({ ...attempt, result: undefined, grading: { weights: { completeness: 1, cleanliness: 0 } } }).result;
    expect(overridden.score).toBe(0.5);
    expect(overridden.rubric.weights).toEqual({ completeness: 1, cleanliness: 0 });
  });

  it('keeps the immutable expectation count in interrupted diagnostics after timed misses', () => {
    const source = expectation([{ id: 'note', notes: [{ midi: 60, part: 'rh' }] }], {
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
    });
    let attempt = startAssessmentAttempt(createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'cued' }), { time: 0 });
    attempt = advanceAssessment(attempt, 1000).attempt;
    expect(finalizeAssessmentAttempt(attempt, { status: 'timeout' }).result.diagnostics).toEqual({
      expected_notes: 1, matched_notes: 0, wrong_notes: 0, missed_notes: 1,
    });
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
    const instance = { id: 'mode-check', ordering: 'strict', events: [{ value: 'quarter', notes: [{ midi: 60 }] }] };
    expect(() => prepareExerciseAssessment({ instance, mode: 'free', requirement: { mode: 'cued' } })).toThrow(/does not match requirement mode/);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'timed', mode: 'free' })).toThrow(/requires cued/);
    expect(() => createAssessmentAttempt({ expectation: source, matcher: 'cursor', requirement: { rubric: { criteria: { placement: 0.8 } } } })).toThrow(/Placement/);
    expect(() => createAssessmentAttempt({ expectation: source, requirement: { rubric: { weights: { placement: 1 } } } })).toThrow(/Placement/);
    expect(() => createAssessmentAttempt({ expectation: source, requirement: { rubric: { weights: { completeness: 0, cleanliness: 0 } } } })).toThrow(/positive/);
    expect(() => createAssessmentAttempt({ expectation: source, grading: { part_weights: { unassigned: 0 } } })).toThrow(/positive active part/);
  });
});
