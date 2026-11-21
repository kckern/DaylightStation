import { describe, expect, it } from 'vitest';
import { applyCoachEvent, createCoachPlan, projectCoach } from './learnCoach.mjs';

// A four-bar passage played with both hands, the shape of the passage a learner
// kept stalling on in its last bar (2026-11-20): the run reaches the final chord,
// finds none of its left-hand note, and the stall timer ends the take.
const DAY = '2026-11-20';
const segments = [
  { id: 'tail', inMeasure: 5, outMeasure: 8, playableParts: ['rh', 'lh'] },
  { id: 'next', inMeasure: 9, outMeasure: 12, playableParts: ['rh', 'lh'] },
];
const planOf = () => createCoachPlan({ scoreId: 'files:t.mxl', fingerprint: 'c', segments, tempoMap: [{ onsetQuarter: 0, bpm: 50 }] });
const span = (expected, missed = 0, wrong = 0) => ({ diagnostics: { expected_notes: expected, missed_notes: missed, wrong_notes: wrong } });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 0.95 },
  diagnostics: { expected_notes: 12, matched_notes: 12, wrong_notes: 0, missed_notes: 0 }, spans: {} };
// Every bar played, then stuck on the last chord until the stall ended the take.
const stalledAtEnd = { ...good, criteria: { completeness: 0.92, cleanliness: 0.6 },
  diagnostics: { expected_notes: 43, matched_notes: 40, wrong_notes: 20, missed_notes: 3 },
  parts: { rh: { diagnostics: { expected_notes: 32, missed_notes: 2, wrong_notes: 8 } }, lh: { diagnostics: { expected_notes: 11, missed_notes: 1, wrong_notes: 12 } } },
  spans: { 'measure:5': span(12), 'measure:6': span(12), 'measure:7': span(12, 0, 2), 'measure:8': span(7, 3, 18) } };
// A short drill with the notes found but too many wrong ones.
const messy = { ...good, criteria: { completeness: 1, cleanliness: 0.4 },
  diagnostics: { expected_notes: 7, matched_notes: 7, wrong_notes: 10, missed_notes: 0 },
  parts: { rh: { diagnostics: { expected_notes: 4, missed_notes: 0, wrong_notes: 1 } }, lh: { diagnostics: { expected_notes: 3, missed_notes: 0, wrong_notes: 9 } } },
  spans: { 'measure:8': span(7, 0, 10) } };

let n = 0;
const event = (state, plan, payload, dayKey = DAY) => applyCoachEvent(state, { id: `e${n += 1}`, ...payload }, { plan, now: `${dayKey}T12:00:00Z`, dayKey });
const play = (state, plan, task, result) => event(state, plan, { type: 'outcome', task, result });
const twice = (state, plan, task, result) => play(play(state, plan, task, result), plan, task, result);
const select = (state, plan, task) => event(state, plan, { type: 'selection', task });
const view = (plan, state) => projectCoach({ plan, state, dayKey: DAY });
const check = (plan, passageId = 'tail') => plan.tasks.find((t) => t.skill === 'silver' && t.passageId === passageId);
// The note steps (each hand, then together) done, so the Silver check is what is left.
const atCheck = (plan) => ['right', 'left', 'together'].reduce((state, skill) =>
  play(state, plan, plan.tasks.find((t) => t.skill === skill && t.passageId === 'tail'), good), undefined);

describe('a passage that stalls in its last bar', () => {
  it('practices the way into the hard bar: the bar before it and the bar itself', () => {
    const plan = planOf();
    const drill = view(plan, twice(undefined, plan, check(plan), stalledAtEnd)).recommended;
    expect(drill).toMatchObject({ passageId: 'tail', depth: 1, reason: 'focus-bars', range: { start: 7, end: 8 }, parts: ['rh', 'lh'] });
  });

  it('narrows to the hard bar alone, then to its harder hand, when the linked bars keep missing', () => {
    const plan = planOf();
    let state = twice(undefined, plan, check(plan), stalledAtEnd);
    const linked = view(plan, state).recommended;
    state = twice(state, plan, linked, messy);
    const alone = view(plan, state).recommended;
    expect(alone).toMatchObject({ depth: 2, range: { start: 8, end: 8 }, parts: ['rh', 'lh'] });
    state = twice(state, plan, alone, messy);
    const hand = view(plan, state).recommended;
    expect(hand).toMatchObject({ depth: 3, reason: 'one-hand', range: { start: 8, end: 8 }, parts: ['lh'] });
    // The bottom of the ladder repeats itself rather than recursing.
    state = twice(state, plan, hand, messy);
    expect(view(plan, state).recommended.key).toBe(hand.key);
  });

  it('builds back toward the start one bar at a time, always ending on the bar it learned', () => {
    const plan = planOf(); const full = check(plan);
    let state = twice(atCheck(plan), plan, full, stalledAtEnd);
    const linked = view(plan, state).recommended;
    state = twice(state, plan, linked, good);
    const longer = view(plan, state).recommended;
    expect(longer).toMatchObject({ depth: 1, reason: 'back-chain', range: { start: 6, end: 8 }, parts: ['rh', 'lh'], parent: { key: full.key } });
    expect(longer.assist).toBeUndefined();
    state = twice(state, plan, longer, good);
    // The next bar back is the whole passage: the Silver check itself, not a copy of it.
    expect(state.resume.key).toBe(full.key);
    expect(view(plan, state).recommended.key).toBe(full.key);
  });

  it('a passed one-hand or one-bar drill returns to the drill it came from before building back', () => {
    const plan = planOf();
    let state = twice(undefined, plan, check(plan), stalledAtEnd);
    const linked = view(plan, state).recommended;
    state = twice(state, plan, linked, messy);
    const alone = view(plan, state).recommended;
    state = twice(state, plan, alone, messy);
    const hand = view(plan, state).recommended;
    state = twice(state, plan, hand, good);
    expect(view(plan, state).recommended.key).toBe(alone.key);
    state = twice(state, plan, alone, good);
    expect(view(plan, state).recommended.key).toBe(linked.key);
    state = twice(state, plan, linked, good);
    expect(view(plan, state).recommended).toMatchObject({ reason: 'back-chain', range: { start: 6, end: 8 } });
  });

  it('a drill in the middle of a passage returns to the passage when passed', () => {
    const plan = planOf(); const full = check(plan);
    const middle = { ...stalledAtEnd, criteria: { completeness: 1, cleanliness: 0.5 },
      spans: { 'measure:5': span(12), 'measure:6': span(12, 0, 9), 'measure:7': span(12), 'measure:8': span(7) } };
    let state = twice(atCheck(plan), plan, full, middle);
    const drill = view(plan, state).recommended;
    expect(drill.range).toEqual({ start: 5, end: 6 });
    state = twice(state, plan, drill, good);
    expect(view(plan, state).recommended.key).toBe(full.key);
  });
});

describe('a passage set aside and then chosen again', () => {
  it('choosing it again brings it back, coaching included', () => {
    const plan = planOf(); const full = check(plan);
    let state = twice(undefined, plan, full, stalledAtEnd);
    state = event(state, plan, { type: 'set-aside', task: full });
    expect(view(plan, state).recommended.passageId).toBe('next');
    // The learner opens it from the rail and starts a take: that is a selection.
    state = select(state, plan, full);
    expect(state.setAside.tail).toBeUndefined();
    state = twice(state, plan, full, stalledAtEnd);
    expect(view(plan, state).recommended).toMatchObject({ passageId: 'tail', depth: 1, range: { start: 7, end: 8 } });
    expect(view(plan, state).canSetAside.tail).toBe(true);
  });

  it('choosing a different passage leaves the set-aside in place', () => {
    const plan = planOf(); const full = check(plan);
    let state = twice(undefined, plan, full, stalledAtEnd);
    state = event(state, plan, { type: 'set-aside', task: full });
    state = select(state, plan, check(plan, 'next'));
    expect(state.setAside.tail).toBe(DAY);
  });
});
