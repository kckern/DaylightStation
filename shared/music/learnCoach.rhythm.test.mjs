import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachTaskKey } from './learnCoach.mjs';

const segments = [{ id: 'a', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }, { id: 'b', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] }];
const plan = createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }] });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 } };
const lateOnly = { ...good, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 } };
const dayKey = '2026-11-23';
let n = 0;
const play = (state, task, result = good) => applyCoachEvent(state, { id: `r${++n}`, type: 'outcome', task, result }, { plan, now: '2026-11-23T18:00:00Z', dayKey });
const step = (skill) => plan.tasks.find((t) => t.passageId === 'a' && t.skill === skill);

describe('rhythm recovery rung', () => {
  it('is offered when timing keeps failing at the slowest tempo, instead of nothing smaller', () => {
    const task = step('timed-30');
    const state = play(play(undefined, task, lateOnly), task, lateOnly);
    const resume = projectCoach({ plan, state, dayKey }).goldResume;
    expect(resume).toMatchObject({ reason: 'rhythm', rhythm: true, label: 'Tap the rhythm', depth: 1, mode: 'cued', tempoPercent: 30, parts: ['rh', 'lh'] });
  });
  it('is not offered while a slower tempo exists: that comes first', () => {
    const task = step('timed-50');
    const state = play(play(undefined, task, lateOnly), task, lateOnly);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ reason: 'slower-beat', tempoPercent: 40 });
  });
  it('never nests: a failed rhythm take goes to the ordinary smaller steps', () => {
    const task = step('timed-30');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    state = play(play(state, rhythm, lateOnly), rhythm, lateOnly);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ depth: 2 });
    expect(projectCoach({ plan, state, dayKey }).goldResume.reason).not.toBe('rhythm');
  });
  it('has its own key, so a pitchless pass is never credit for the real timed step', () => {
    const task = step('timed-30');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    expect(coachTaskKey(rhythm)).not.toBe(coachTaskKey(task));
    state = play(play(state, rhythm), rhythm);
    const skills = projectCoach({ plan, state, dayKey }).segments.find((s) => s.id === 'a').skills;
    expect(skills.find((s) => s.skill === 'timed-30').ready).toBe(false);
  });
  it('and a real pass never counts for the rhythm rung, which a pass returns to its parent', () => {
    const task = step('timed-30');
    let state = play(play(undefined, task, lateOnly), task, lateOnly);
    const rhythm = projectCoach({ plan, state, dayKey }).goldResume;
    state = play(play(state, rhythm), rhythm);
    expect(projectCoach({ plan, state, dayKey }).goldResume).toMatchObject({ skill: 'timed-30' });
    expect(projectCoach({ plan, state, dayKey }).goldResume.rhythm).toBeUndefined();
  });
});
