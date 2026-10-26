import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachFeedback } from './learnCoach.mjs';

const segments = [
  { id: 'opening', inMeasure: 0, outMeasure: 3, printedMeasures: ['1', '4'], playableParts: ['rh', 'lh'] },
  { id: 'answer', inMeasure: 4, outMeasure: 7, printedMeasures: ['5', '8'], playableParts: ['rh'] },
];
const planOf = (over = {}) => createCoachPlan({ scoreId: 'files:test.musicxml', fingerprint: 'content-a', segments, tempoMap: [{ onsetQuarter: 0, bpm: 100 }], ...over });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 0.95, placement: 0.95 }, verdict: { passed: true }, diagnostics: { expected_notes: 10, matched_notes: 10, wrong_notes: 0, missed_notes: 0 } };
const bad = { ...good, verdict: { passed: false }, criteria: { completeness: 0.5, cleanliness: 0.5, placement: 0.5 }, diagnostics: { expected_notes: 10, matched_notes: 5, wrong_notes: 5, missed_notes: 5 } };
const choose = (plan, skill, passageId = 'opening') => plan.tasks.find((task) => task.skill === skill && task.passageId === passageId);
const outcome = (state, plan, task, result = good, id = `take-${(state?.revision ?? 0) + 1}`, extra = {}) => applyCoachEvent(state, { id, type: 'outcome', task, result, ...extra }, { plan, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26' });
const projection = (plan, state, extra = {}) => projectCoach({ plan, state, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26', ...extra });

describe('guided musical progression', () => {
  it('offers a concrete first hand task and omits impossible hand stages for single-part music', () => {
    const plan = planOf();
    expect(projection(plan).recommended).toMatchObject({ skill: 'right', mode: 'free', parts: ['rh'], range: { start: 0, end: 3 } });
    expect(plan.tasks.filter((task) => task.passageId === 'answer').map((task) => task.skill)).toEqual(['notes', 'pulse', 'timed-60', 'timed-80', 'mastery']);
  });

  it('advances after two passes among three equivalent takes and never removes that achievement', () => {
    const plan = planOf(); const task = choose(plan, 'right');
    let state = outcome(undefined, plan, task);
    expect(projection(plan, state).recommended.skill).toBe('right');
    state = outcome(state, plan, task, bad);
    state = outcome(state, plan, task);
    expect(projection(plan, state).recommended.skill).toBe('left');
    state = outcome(state, plan, task, bad);
    expect(projection(plan, state).segments[0].skills.find((skill) => skill.skill === 'right').ready).toBe(true);
  });

  it('does not combine unlike practice settings to manufacture timed readiness', () => {
    const plan = planOf();const task = choose(plan, 'timed-60');
    let state = outcome(undefined, plan, task);
    state = outcome(state, plan, { ...task, tempoPercent: 40 });
    expect(projection(plan, state).segments[0].skills.find((skill) => skill.skill === 'timed-60').ready).toBe(false);
  });

  it('credits successful custom work by demonstrated skill rather than launch source', () => {
    const plan = planOf();const task = { ...choose(plan, 'right'), source: 'custom' };
    const state = outcome(outcome(undefined, plan, task), plan, task);
    expect(projection(plan, state).recommended.skill).toBe('left');
  });

  it('a full-tempo demonstration proves weaker timed tasks without compulsory earlier drill quotas', () => {
    const plan = planOf();const task = choose(plan, 'mastery');
    const state = outcome(outcome(undefined, plan, task), plan, task);
    const first = projection(plan, state).segments[0];
    expect(first.mastered).toBe(true);
    expect(first.skills.every((skill) => skill.ready)).toBe(true);
    expect(projection(plan, state).recommended.passageId).toBe('answer');
  });

  it('a click-assisted pitch success cannot claim timing mastery', () => {
    const plan = planOf();const task = choose(plan, 'pulse');
    const state = outcome(outcome(undefined, plan, task), plan, task);
    expect(projection(plan, state).segments[0].mastered).toBe(false);
    expect(projection(plan, state).segments[0].skills.find((s) => s.skill === 'together').ready).toBe(true);
  });

  it.each(['aborted', 'error', 'prepared'])('does not change ability from a %s take', (status) => {
    const plan = planOf();const task = choose(plan, 'right');
    const state = outcome(outcome(undefined, plan, task, { ...bad, status }), plan, task, { ...bad, status });
    expect(projection(plan, state).recommended).toMatchObject({ skill: 'right', range: { start: 0, end: 3 } });
    expect(state.evidence).toHaveLength(0);
  });

  it('excludes invalid assessment evidence without creating false passes or recovery', () => {
    const plan = planOf();const task = choose(plan, 'mastery');
    const result = { ...bad, validity: 'invalid' };
    const state = outcome(outcome(undefined, plan, task, result), plan, task, result);
    expect(state.evidence).toHaveLength(0);
    expect(projection(plan, state).segments[0].mastered).toBe(false);
  });

  it('ignores pre-fix two-part cued failures even if they were terminal', () => {
    const plan = planOf();const task = choose(plan, 'mastery');
    const result = { ...bad, inputContractVersion: undefined, rubric: { version: '2' }, provider_version: 'exercise-runtime-v4' };
    const state = outcome(undefined, plan, task, result);
    expect(state.evidence).toHaveLength(0);
  });
});

describe('focused recovery and honest feedback', () => {
  it('targets the hardest normalized measure only after two equivalent unsuccessful takes', () => {
    const plan = planOf();const task = choose(plan, 'right');
    const result = { ...bad, spans: {
      'measure:0': { diagnostics: { expected_notes: 20, missed_notes: 2, wrong_notes: 0 } },
      'measure:2': { diagnostics: { expected_notes: 4, missed_notes: 2, wrong_notes: 2 } },
    } };
    let state = outcome(undefined, plan, task, result);
    expect(projection(plan, state).recommended.range).toEqual({ start: 0, end: 3 });
    state = outcome(state, plan, task, result);
    expect(projection(plan, state).recommended).toMatchObject({ range: { start: 2, end: 2 }, parent: { skill: 'right' }, depth: 1 });
  });

  it('falls back to the first half and cannot recurse endlessly on a one-bar task', () => {
    const plan = planOf();const task = choose(plan, 'right');
    let state = outcome(outcome(undefined, plan, task, bad), plan, task, bad);
    let recovery = projection(plan, state).recommended;
    expect(recovery.range).toEqual({ start: 0, end: 1 });
    state = outcome(outcome(state, plan, recovery, bad), plan, recovery, bad);
    recovery = projection(plan, state).recommended;
    expect(recovery.depth).toBeLessThanOrEqual(2);
    state = outcome(outcome(state, plan, recovery, bad), plan, recovery, bad);
    expect(projection(plan, state).recommended.depth).toBeLessThanOrEqual(2);
  });

  it('returns from successful short practice without banking a full-passage skill', () => {
    const plan = planOf();const task = choose(plan, 'right');
    let state = outcome(outcome(undefined, plan, task, bad), plan, task, bad);
    const recovery = projection(plan, state).recommended;
    state = outcome(outcome(state, plan, recovery), plan, recovery);
    expect(projection(plan, state).recommended.range).toEqual({ start: 0, end: 3 });
    expect(projection(plan, state).segments[0].skills.find((s) => s.skill === 'right').ready).toBe(false);
  });

  it('offers one slower stage for timing-only difficulty and shortens below the automatic floor', () => {
    const plan = planOf();const task = choose(plan, 'timed-60');
    const timing = { ...bad, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 } };
    let state = outcome(outcome(undefined, plan, task, timing), plan, task, timing);
    expect(projection(plan, state).recommended).toMatchObject({ tempoPercent: 40, range: { start: 0, end: 3 } });
    const slower = projection(plan, state).recommended;
    state = outcome(outcome(state, plan, slower, timing), plan, slower, timing);
    expect(projection(plan, state).recommended.tempoPercent).toBe(40);
    expect(projection(plan, state).recommended.range.end).toBeLessThan(3);
  });

  it('never describes metronome practice as measured timing accuracy', () => {
    const task = choose(planOf(), 'pulse');
    expect(coachFeedback(good, task).detail).not.toMatch(/timing|on time|rhythm mastered/i);
    expect(coachFeedback({ ...bad, validity: 'invalid' }, task).reason).toBe('operational');
  });
});

describe('identity, authored requirements, review and legacy preservation', () => {
  it('preserves explicit authored quotas and plan completion without inventing timed mastery', () => {
    const plan = planOf({ authoredLadder: true, segments: [{ ...segments[0], ladder: [{ id: 'custom-hand', label: 'Practice phrase', effectiveParts: ['rh'], mode: 'free', sets: 1, reps: 4, completes: 'passage' }] }] });
    const task = plan.tasks[0];let state;
    for (let i = 0; i < 3; i++)state = outcome(state, plan, task);
    expect(projection(plan, state).segments[0].complete).toBe(false);
    state = outcome(state, plan, task);
    expect(projection(plan, state).segments[0]).toMatchObject({ complete: true, mastered: false });
  });

  it('preserves completed weaker legacy readiness with explicit provenance', () => {
    const plan = planOf();const legacy = { learn: { passages: { opening: { rungs: { right: { attempts: 8, passCount: 6 } } } } } };
    const p = projection(plan, undefined, { legacy });
    expect(p.recommended.skill).toBe('left');
    expect(p.segments[0].skills[0]).toMatchObject({ ready: true, provenance: 'legacy' });
  });

  it('does not inherit another score fingerprint or manufacture partial legacy evidence', () => {
    const old = planOf();const task = choose(old, 'right');const state = outcome(outcome(undefined, old, task), old, task);
    const plan = planOf({ fingerprint: 'content-b' });
    expect(projection(plan, state).recommended.skill).toBe('right');
    const legacy = { learn: { passages: { opening: { rungs: { right: { passCount: 1 } } } } } };
    expect(projection(old, undefined, { legacy }).recommended.skill).toBe('right');
  });

  it('offers a later-day review and keeps mastery after an unsuccessful review', () => {
    const plan = planOf();const task = choose(plan, 'mastery');let state = outcome(outcome(undefined, plan, task), plan, task);
    const p = projection(plan, state, { dayKey: '2026-10-27' });
    expect(p.review).toMatchObject({ passageId: 'opening', review: true });
    state = outcome(state, plan, { ...task, review: true }, bad);
    expect(projection(plan, state).segments[0].mastered).toBe(true);
  });

  it('uses the earned household date for review when UTC has already crossed midnight', () => {
    const plan = planOf();const task = choose(plan, 'mastery');let state;
    for (const id of ['late-one', 'late-two'])state = applyCoachEvent(state, { id, type: 'outcome', task, result: good }, {
      plan, now: '2026-10-27T06:30:00Z', dayKey: '2026-10-26',
    });
    expect(projection(plan, state, { dayKey: '2026-10-27' }).review).toMatchObject({ passageId: 'opening' });
  });

  it('bounds recent evidence while retaining earned achievements and ignores duplicate delivery', () => {
    const plan = planOf();const task = choose(plan, 'right');let state = outcome(outcome(undefined, plan, task), plan, task);
    const same = outcome(state, plan, task, good, state.evidence.at(-1).id);
    expect(same.revision).toBe(state.revision);
    for (let i = 0; i < 150; i++)state = outcome(state, plan, task, bad, `late-${i}`);
    expect(state.evidence.length).toBeLessThanOrEqual(128);
    expect(projection(plan, state).segments[0].skills[0].ready).toBe(true);
  });
});
