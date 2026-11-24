import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachTaskKey } from './learnCoach.mjs';

const segments = [{ id: 'a', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }, { id: 'b', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] }];
const plan = createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], goldLadder: { minBpm: 40 } });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 } };
const lateOnly = { ...good, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 } };
const dayKey = '2026-11-23';
let n = 0;
const play = (state, task, result = good) => applyCoachEvent(state, { id: `r${++n}`, type: 'outcome', task, result }, { plan, now: '2026-11-23T18:00:00Z', dayKey });
const step = (skill) => plan.tasks.find((t) => t.passageId === 'a' && t.skill === skill);

describe('rhythm recovery rung', () => {
  it('is offered when timing keeps failing at the slowest tempo, instead of nothing smaller', () => {
    const task = step('timed-50');
    const state = play(play(undefined, task, lateOnly), task, lateOnly);
    const resume = projectCoach({ plan, state, dayKey }).goldResume;
    expect(resume).toMatchObject({ reason: 'rhythm', rhythm: true, label: 'Tap the rhythm', depth: 1, mode: 'cued', tempoPercent: 50, parts: ['rh', 'lh'] });
  });
  it('is not offered while a slower tempo exists: that comes first', () => {
    const task = step('timed-70');
    const state = play(play(undefined, task, lateOnly), task, lateOnly);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ reason: 'slower-beat', tempoPercent: 50 });
  });
  it('never nests: a failed rhythm take goes to the ordinary smaller steps', () => {
    const task = step('timed-50');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    state = play(play(state, rhythm, lateOnly), rhythm, lateOnly);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ depth: 2 });
    expect(projectCoach({ plan, state, dayKey }).goldResume.reason).not.toBe('rhythm');
  });
  it('has its own key, so a pitchless pass is never credit for the real timed step', () => {
    const task = step('timed-50');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    expect(coachTaskKey(rhythm)).not.toBe(coachTaskKey(task));
    state = play(play(state, rhythm), rhythm);
    const skills = projectCoach({ plan, state, dayKey }).segments.find((s) => s.id === 'a').skills;
    expect(skills.find((s) => s.skill === 'timed-50').ready).toBe(false);
  });
  it('and a real pass never counts for the rhythm rung, which a pass returns to its parent', () => {
    const task = step('timed-50');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    state = play(play(state, rhythm), rhythm);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ skill: 'timed-50' });
    expect(projectCoach({ plan, state, dayKey }).goldResume.rhythm).toBeUndefined();
  });
});

describe('the rhythm step (first of the Gold lap, at score tempo)', () => {
  const plain = createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], goldLadder: { minBpm: 40 } });
  const gold = (state) => projectCoach({ plan: plain, state, dayKey }).gold.a;
  const doTwice = (state, task, result = good) => [1, 2].reduce((acc) => applyCoachEvent(acc, { id: `s${++n}`, type: 'outcome', task, result }, { plan: plain, now: '2026-11-23T18:00:00Z', dayKey }), state);
  const stepOf = (skill) => plain.tasks.find((t) => t.passageId === 'a' && t.skill === skill);
  it('is the first Gold step, pitch-free at score tempo', () => {
    expect(gold(undefined)).toMatchObject({ skill: 'rhythm', rhythm: true, mode: 'cued', tempoPercent: 100, label: 'Tap the rhythm' });
  });
  it('once clear, the right hand at the first speed comes next (there is no beat step)', () => {
    expect(gold(doTwice(undefined, stepOf('rhythm')))).toMatchObject({ skill: 'timed-50-rh' });
    expect(plain.tasks.some((t) => t.skill === 'pulse' || t.mode === 'metronome')).toBe(false);
  });
  it('a pitch-free pass proves no timed step, even at a faster tempo than one', () => {
    const state = doTwice(undefined, stepOf('rhythm'));
    const skills = projectCoach({ plan: plain, state, dayKey }).segments[0].skills;
    for (const skill of ['timed-50-rh', 'timed-50', 'timed-85', 'mastery']) expect(skills.find((s) => s.skill === skill).ready).toBe(false);
  });
  it('playing the real notes in time at score tempo proves the rhythm step; a slower take does not', () => {
    const slower = projectCoach({ plan: plain, state: doTwice(undefined, stepOf('timed-85')), dayKey }).segments[0].skills;
    expect(slower.find((s) => s.skill === 'rhythm').ready).toBe(false);
    const state = doTwice(undefined, stepOf('mastery'));
    const skills = projectCoach({ plan: plain, state, dayKey }).segments[0].skills;
    expect(skills.find((s) => s.skill === 'rhythm').ready).toBe(true);
  });
  it('speaks of taps, not notes', async () => {
    const { coachFeedback } = await import('./learnCoach.mjs');
    const rhythm = stepOf('rhythm');
    expect(coachFeedback({ ...good, criteria: { completeness: 0.8, cleanliness: 1, placement: 1 } }, rhythm)).toMatchObject({ title: 'A tap went missing', reason: 'coverage' });
    expect(coachFeedback(good, rhythm)).toMatchObject({ title: 'Nice rhythm!', reason: 'passed' });
  });
});
