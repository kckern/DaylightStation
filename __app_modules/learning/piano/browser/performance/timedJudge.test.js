import { describe, expect, it } from 'vitest';
import {
  advanceAssessment,
  compileAssessmentExpectation,
  createAssessmentAttempt,
  finalizeAssessmentAttempt,
  observeAssessment,
  startAssessmentAttempt,
} from './assessmentAttempt.js';
import { judgeTimedOnset, timedReachMs, timedWindowMs } from './timedJudge.js';
import { assessmentVerdicts, verdictSummary, timedRunSummary, timedVerdicts } from './timedVerdicts.js';

// G major up, eight eighths at 60 bpm (quarter) = 500 ms apart.
const G_MAJOR = [67, 69, 71, 72, 74, 76, 78, 79];
const FRACTION_POLICY = { windowFraction: 0.4, windowMinMs: 80, windowMaxMs: 400 };
const REQUIREMENT = { rubric: { criteria: { completeness: 1, cleanliness: 1, placement: 0.8 } } };

const scale = (pitches = G_MAJOR) => compileAssessmentExpectation({
  source: { kind: 'exercise', id: 'test-scale' },
  events: pitches.map((midi, index) => ({ id: `e${index}`, onsetQuarter: index * 0.5, durationQuarters: 0.5, notes: [{ midi, part: 'rh' }] })),
  tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
});

const start = (policy = FRACTION_POLICY, pitches) => startAssessmentAttempt(createAssessmentAttempt({
  expectation: scale(pitches), matcher: 'timed', mode: 'cued', requirement: REQUIREMENT, policy,
}), { time: 0 });

// Tick the clock up to each onset's time, then observe it (as the runtime does).
function play(attempt, onsets) {
  const emitted = [];
  let current = attempt;
  for (const { midi, time } of onsets) {
    const advanced = advanceAssessment(current, time);
    emitted.push(...advanced.events);
    const observed = observeAssessment(advanced.attempt, { midi, time });
    emitted.push(...(observed.events || [observed.event]));
    current = observed.attempt;
  }
  return { attempt: current, emitted };
}

const run = (lagMs, pitches = G_MAJOR) => pitches.map((midi, index) => ({ midi, time: index * 500 + lagMs }));

describe('assessment verdict projection', () => {
  it('keeps durable pitch feedback and foreign wrong pitches for untimed runs', () => {
    const snapshot = {
      matcher: 'cursor',
      expectation: { events: [
        { id: 'a', notes: [{ id: 'a-60', midi: 60 }] },
        { id: 'b', notes: [{ id: 'b-62', midi: 62 }] },
      ] },
      hits: { 'a-60': { time: 10 } },
      wrong: [{ eventId: 'a', midi: 61, time: 5 }],
      misses: ['b-62'], lapsed: [],
    };
    const verdicts = assessmentVerdicts(snapshot);
    expect(verdicts.get(0).get(60)).toEqual({ state: 'hit' });
    expect(verdicts.get(0).get(61)).toEqual({ state: 'wrong', midi: 61 });
    expect(verdicts.get(1).get(62)).toEqual({ state: 'miss' });
    expect(verdictSummary(snapshot)).toEqual({ right: 1, wrong: 1, missed: 1, early: 0, late: 0, wrongPitches: [61] });
  });
});

describe('timedWindowMs / timedReachMs', () => {
  it('derives the window from the gap to the nearest non-empty neighbour', () => {
    const attempt = start();
    expect(timedWindowMs(attempt, 0)).toBe(200);
    expect(timedReachMs(attempt, 0)).toBe(500);
  });

  it('clamps to the window bounds and uses windowMaxMs for a single-event ask', () => {
    const wide = startAssessmentAttempt(createAssessmentAttempt({
      expectation: compileAssessmentExpectation({
        source: { kind: 'exercise', id: 'wide' },
        events: [{ id: 'a', onsetQuarter: 0, notes: [{ midi: 60 }] }, { id: 'b', onsetQuarter: 4, notes: [{ midi: 62 }] }],
        tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
      }),
      matcher: 'timed', mode: 'cued', policy: FRACTION_POLICY,
    }), { time: 0 });
    expect(timedWindowMs(wide, 0)).toBe(400);
    const single = startAssessmentAttempt(createAssessmentAttempt({
      expectation: compileAssessmentExpectation({ source: { kind: 'exercise', id: 'one' }, events: [{ id: 'a', notes: [{ midi: 60 }] }], tempoMap: [{ onsetQuarter: 0, bpm: 60 }] }),
      matcher: 'timed', mode: 'cued', policy: FRACTION_POLICY,
    }), { time: 0 });
    expect(timedWindowMs(single, 0)).toBe(400);
  });

  it('ignores empty (rest) events when measuring the gap', () => {
    const attempt = startAssessmentAttempt(createAssessmentAttempt({
      expectation: compileAssessmentExpectation({
        source: { kind: 'exercise', id: 'rests' },
        events: [
          { id: 'a', onsetQuarter: 0, notes: [{ midi: 60 }] },
          { id: 'rest', onsetQuarter: 0.25, notes: [] },
          { id: 'b', onsetQuarter: 1, notes: [{ midi: 62 }] },
        ],
        tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
      }),
      matcher: 'timed', mode: 'cued', policy: FRACTION_POLICY,
    }), { time: 0 });
    expect(timedWindowMs(attempt, 0)).toBe(400);
    expect(timedReachMs(attempt, 0)).toBe(1000);
  });

  it('keeps the fixed matchWindowMs when windowFraction is absent', () => {
    expect(timedWindowMs(start({}), 3)).toBe(220);
  });
});

describe('judgeTimedOnset (fraction policy)', () => {
  it('records a steady 450 ms lag as late on each own beat, never wrong', () => {
    const { attempt, emitted } = play(start(), run(450));
    expect(attempt.status).toBe('completed');
    expect(attempt.wrong).toEqual([]);
    expect(Object.values(attempt.hits).map((hit) => hit.offbeat)).toEqual(Array(8).fill('late'));
    expect(emitted.filter((event) => event.type === 'offbeat')).toHaveLength(8);
    expect(emitted.find((event) => event.type === 'offbeat')).toEqual({ type: 'offbeat', eventId: 'e0', noteIds: ['e0-rh-67-1'], driftMs: 450, side: 'late' });
    expect(emitted.filter((event) => event.type === 'lapse')).toHaveLength(8);

    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria.completeness).toBe(1);
    expect(result.criteria.cleanliness).toBe(1);
    // The first off-beat note is forgiven to half credit; the other seven earn 0.
    expect(result.criteria.placement).toBeCloseTo(0.5 / 8);
    expect(result.verdict.passed).toBe(false);
    expect(result.verdict.failed_criteria).toEqual(['placement']);
    expect(result.diagnostics).toMatchObject({ offbeat_notes: 8, late_notes: 8, early_notes: 0, median_drift_ms: 450, response_median_ms: 450, wrong_notes: 0 });

    expect(timedRunSummary(result, attempt)).toEqual({ kind: 'timing', offbeat: 8, late: 8, early: 0, medianDriftMs: 450 });
    const verdicts = timedVerdicts(attempt);
    expect(verdicts.size).toBe(8);
    expect(verdicts.get(3).get(72)).toEqual({ state: 'late', driftMs: 450 });
  });

  it('scores an on-beat run as eight hits and passes', () => {
    const { attempt, emitted } = play(start(), run(30));
    expect(Object.values(attempt.hits).every((hit) => !hit.offbeat)).toBe(true);
    expect(emitted.filter((event) => event.type === 'onset_complete')).toHaveLength(8);
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria).toEqual({ completeness: 1, cleanliness: 1, placement: 1 });
    expect(result.verdict.passed).toBe(true);
    expect(result.diagnostics).toMatchObject({ offbeat_notes: 0, median_drift_ms: 30 });
    expect(timedRunSummary(result, attempt).kind).toBe('passed');
    expect(timedVerdicts(attempt).get(0).get(67)).toEqual({ state: 'hit', driftMs: 30 });
  });

  it('scales placement linearly from 0.4 × window to the window edge', () => {
    const at = (lag) => finalizeAssessmentAttempt(play(start(), run(lag)).attempt).result.criteria.placement;
    expect(at(80)).toBe(1);
    expect(at(140)).toBeCloseTo(0.5);
    expect(at(200)).toBe(0);
  });

  it('widens full credit to the policy\'s own share, and still reaches 0 at the window edge', () => {
    const at = (lag, share) => finalizeAssessmentAttempt(play(start({ ...FRACTION_POLICY, placementFullCreditShare: share }), run(lag)).attempt).result.criteria.placement;
    // 200 ms window: full credit to ±120 ms at 0.6, linear to 0 at ±200 ms.
    expect(at(120, 0.6)).toBe(1);
    expect(at(140, 0.6)).toBeCloseTo(0.75);
    expect(at(160, 0.6)).toBeCloseTo(0.5);
    expect(at(200, 0.6)).toBe(0);
    // A share that is not a fraction of the window is ignored: the 0.4 curve.
    for (const bad of [0, 1, -0.2, 'wide', null]) expect(at(140, bad)).toBeCloseTo(0.5);
  });

  it('charges one wrong pitch to its own beat without shifting later notes', () => {
    const onsets = run(0);
    onsets[3] = { midi: 73, time: 1500 };
    let { attempt } = play(start(), onsets);
    attempt = advanceAssessment(attempt, 5000).attempt;
    expect(attempt.wrong).toEqual([{ midi: 73, time: 1500, spanId: null, eventId: 'e3', driftMs: 0 }]);
    expect(attempt.misses).toEqual(['e3-rh-72-1']);
    expect(Object.keys(attempt.hits)).toHaveLength(7);
    expect(Object.values(attempt.hits).every((hit) => hit.driftMs === 0 && !hit.offbeat)).toBe(true);
    const result = finalizeAssessmentAttempt(attempt).result;
    expect(result.criteria.completeness).toBe(7 / 8);
    expect(timedRunSummary(result, attempt).kind).toBe('notes');
    const verdicts = timedVerdicts(attempt);
    expect(verdicts.get(3).get(72)).toEqual({ state: 'miss' });
    expect(verdicts.get(3).get(73)).toEqual({ state: 'wrong', midi: 73, driftMs: 0 });
    expect(verdicts.get(4).get(74)).toEqual({ state: 'hit', driftMs: 0 });
  });

  it('lapses a note when its window closes and still lets it be claimed late', () => {
    let attempt = start();
    let step = advanceAssessment(attempt, 250);
    expect(step.events).toEqual([{ type: 'lapse', eventId: 'e0', noteId: 'e0-rh-67-1' }]);
    attempt = step.attempt;
    expect(attempt.lapsed).toEqual(['e0-rh-67-1']);
    expect(timedVerdicts(attempt).get(0).get(67)).toEqual({ state: 'lapsed' });
    expect(advanceAssessment(attempt, 260).events).toEqual([]);
    const observed = observeAssessment(attempt, { midi: 67, time: 300 });
    expect(observed.event).toMatchObject({ type: 'offbeat', side: 'late', driftMs: 300 });
    expect(observed.attempt.hits['e0-rh-67-1']).toEqual({ time: 300, driftMs: 300, windowMs: 200, offbeat: 'late' });
    expect(timedVerdicts(observed.attempt).get(0).get(67)).toEqual({ state: 'late', driftMs: 300 });
  });

  it('records an early right pitch on its own beat', () => {
    const attempt = start();
    const observed = observeAssessment(advanceAssessment(attempt, 700).attempt, { midi: 69, time: 250 });
    expect(observed.event).toMatchObject({ type: 'offbeat', eventId: 'e1', side: 'early', driftMs: -250 });
  });

  it('finally misses a note once its reach has passed, and only then', () => {
    let attempt = start();
    attempt = advanceAssessment(attempt, 500).attempt;
    expect(attempt.misses).toEqual([]);
    const step = advanceAssessment(attempt, 501);
    expect(step.events).toEqual([{ type: 'miss', eventId: 'e0', noteId: 'e0-rh-67-1' }]);
    const late = observeAssessment(step.attempt, { midi: 67, time: 520 });
    expect(late.event.type).toBe('wrong');
  });

  it('completes only when every note is claimed or finally missed', () => {
    let attempt = start(FRACTION_POLICY, [67, 69]);
    attempt = observeAssessment(attempt, { midi: 67, time: 0 }).attempt;
    attempt = advanceAssessment(attempt, 800).attempt;
    expect(attempt.lapsed).toEqual(['e1-rh-69-1']);
    expect(attempt.status).toBe('running');
    const done = advanceAssessment(attempt, 1001);
    expect(done.attempt.status).toBe('completed');
    expect(done.events.at(-1)).toEqual({ type: 'attempt_complete' });
  });

  it('returns the judge verdict shapes', () => {
    const attempt = start();
    expect(judgeTimedOnset(attempt, { midi: 67, time: 10 })).toEqual({ verdict: 'hit', eventId: 'e0', noteIds: ['e0-rh-67-1'], driftMs: 10, windowMs: 200 });
    expect(judgeTimedOnset(attempt, { midi: 69, time: 900 })).toEqual({ verdict: 'late', eventId: 'e1', noteIds: ['e1-rh-69-1'], driftMs: 400, windowMs: 200 });
    expect(judgeTimedOnset(attempt, { midi: 60, time: 1240 })).toEqual({ verdict: 'wrong', eventId: 'e2', midi: 60, driftMs: 240 });
  });
});

describe('judgeTimedOnset (fixed policy)', () => {
  it('keeps the historical cascade: a 450 ms lag is wrong on the next event', () => {
    const { attempt } = play(start({}), run(450));
    expect(attempt.wrong.map((wrong) => wrong.eventId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    expect(attempt.hits).toEqual({});
    expect(attempt.misses).toHaveLength(8);
    expect(attempt.lapsed).toEqual([]);
    expect(judgeTimedOnset(start({}), { midi: 69, time: 900 })).toEqual({ verdict: 'wrong', eventId: 'e2', midi: 69, driftMs: -100 });
  });

  it('stores hits without fraction-mode fields and adds no offbeat diagnostics', () => {
    const { attempt } = play(start({}), run(10));
    expect(attempt.hits['e0-rh-67-1']).toEqual({ time: 10, driftMs: 10 });
    expect(finalizeAssessmentAttempt(attempt).result.diagnostics).not.toHaveProperty('offbeat_notes');
  });
});

// Whole notes at 60 bpm: the gap is 4000 ms, so 0.4 × gap (1600 ms) never
// binds and the window is the (tempo-scaled) cap.
const wholeNotes = (count, policy) => startAssessmentAttempt(createAssessmentAttempt({
  expectation: compileAssessmentExpectation({
    source: { kind: 'exercise', id: 'whole' },
    events: Array.from({ length: count }, (_, index) => ({ id: `w${index}`, onsetQuarter: index * 4, durationQuarters: 4, notes: [{ midi: 60 + index }] })),
    tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
  }),
  matcher: 'timed', mode: 'cued', requirement: REQUIREMENT, policy,
}), { time: 0 });

describe('the window cap grows as the tempo slows', () => {
  it('keeps windowMaxMs at full tempo, or with no tempoPercent', () => {
    expect(timedWindowMs(wholeNotes(2, FRACTION_POLICY), 0)).toBe(400);
    expect(timedWindowMs(wholeNotes(2, { ...FRACTION_POLICY, tempoPercent: 100 }), 0)).toBe(400);
    expect(timedWindowMs(wholeNotes(2, { ...FRACTION_POLICY, tempoPercent: 120 }), 0)).toBe(400);
  });

  it('scales the cap by 100 / tempoPercent below full tempo', () => {
    expect(timedWindowMs(wholeNotes(2, { ...FRACTION_POLICY, tempoPercent: 60 }), 0)).toBeCloseTo(666.667, 2);
    expect(timedWindowMs(wholeNotes(2, { ...FRACTION_POLICY, tempoPercent: 40 }), 0)).toBe(1000);
  });

  it('still applies the fraction of the gap under the scaled cap', () => {
    // Eighths at 60 bpm: gap 500 ms → 200 ms, whatever the cap.
    expect(timedWindowMs(start({ ...FRACTION_POLICY, tempoPercent: 40 }), 0)).toBe(200);
  });

  it('leaves the fixed policy alone', () => {
    expect(timedWindowMs(start({ tempoPercent: 40 }), 3)).toBe(220);
  });
});

describe('one off-beat note per take is forgiven', () => {
  it('gives the first off-beat claim 0.5 and the second 0', () => {
    const onsets = run(0);
    onsets[2] = { midi: 71, time: 1000 + 300 };
    const one = finalizeAssessmentAttempt(play(start(), onsets).attempt).result;
    expect(one.diagnostics.offbeat_notes).toBe(1);
    expect(one.criteria.placement).toBeCloseTo(7.5 / 8);
    onsets[5] = { midi: 76, time: 2500 + 300 };
    const two = finalizeAssessmentAttempt(play(start(), onsets).attempt).result;
    expect(two.diagnostics.offbeat_notes).toBe(2);
    expect(two.criteria.placement).toBeCloseTo(7.5 / 8 - 1 / 8);
  });

  it('forgives the first off-beat note in score order, not in play order', () => {
    // Event 5 is played early (claimed before event 2 is played late); the
    // forgiven note is still event 2's, so a span over e0-e3 sees the 0.5.
    const onsets = run(0);
    onsets[2] = { midi: 71, time: 1000 + 300 };
    onsets[5] = { midi: 76, time: 2500 - 300 };
    const { attempt } = play(start(), onsets.sort((a, b) => a.time - b.time));
    const hits = attempt.hits;
    expect(hits['e2-rh-71-1'].offbeat).toBe('late');
    expect(hits['e5-rh-76-1'].offbeat).toBe('early');
    expect(finalizeAssessmentAttempt(attempt).result.criteria.placement).toBeCloseTo(6.5 / 8);
  });

  it('does not change the fixed policy', () => {
    const { attempt } = play(start({}), run(10));
    expect(finalizeAssessmentAttempt(attempt).result.criteria.placement).toBe(1);
  });
});

describe('the failing 60% take from 2026-11-19, reconstructed', () => {
  // 15 notes, all found, one off the beat. The rest drift up to ±300 ms, which the
  // old 400 ms cap (full credit only inside ±160 ms) scored at about 0.61.
  const DRIFTS = [20, -40, 280, -280, 300, 30, -300, 0, 260, -290, 300, -30, 280, -300];
  const take = (tempoPercent) => {
    const onsets = Array.from({ length: 15 }, (_, index) => ({ midi: 60 + index, time: index * 4000 }));
    DRIFTS.forEach((drift, index) => { onsets[index < 7 ? index : index + 1].time += drift; });
    onsets[7].time += 1200; // the one off-beat note: past even the widened window
    const policy = tempoPercent == null ? FRACTION_POLICY : { ...FRACTION_POLICY, tempoPercent };
    return finalizeAssessmentAttempt(play(wholeNotes(15, policy), onsets).attempt).result;
  };

  it('fails on timing under the old 400 ms cap, even with the forgiven note', () => {
    const old = take(null);
    expect(old.diagnostics.offbeat_notes).toBe(1);
    expect(old.criteria.placement).toBeLessThan(0.8);
  });

  it('passes at 60% with the grown window and the forgiven note', () => {
    const result = take(60);
    expect(result.criteria.completeness).toBe(1);
    expect(result.diagnostics.offbeat_notes).toBe(1);
    expect(result.criteria.placement).toBeGreaterThanOrEqual(0.8);
    expect(result.verdict.passed).toBe(true);
  });

  it('passes with every other note within ±160 ms, even at full tempo', () => {
    const onsets = Array.from({ length: 15 }, (_, index) => ({ midi: 60 + index, time: index * 4000 + (index % 2 ? -150 : 150) }));
    onsets[7].time = 7 * 4000 + 1200;
    const result = finalizeAssessmentAttempt(play(wholeNotes(15, FRACTION_POLICY), onsets).attempt).result;
    expect(result.diagnostics.offbeat_notes).toBe(1);
    expect(result.criteria.placement).toBeCloseTo(14.5 / 15);
    expect(result.verdict.passed).toBe(true);
  });
});
