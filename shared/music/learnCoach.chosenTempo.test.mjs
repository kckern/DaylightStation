import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, makeCoachTask, coachTaskKey } from './learnCoach.mjs';

// A take the child chose to play faster than its step asks (the drill header's tempo track).
const segments = [{ id: 'a', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }, { id: 'b', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] }];
const plan = createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }] });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 } };
const late = { ...good, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 } };
const dayKey = '2026-11-23';
let n = 0;
const play = (state, task, result = good) => applyCoachEvent(state, { id: `c${++n}`, type: 'outcome', task, result }, { plan, now: '2026-11-23T18:00:00Z', dayKey });
const step = (skill, passageId = 'a') => plan.tasks.find((t) => t.passageId === passageId && t.skill === skill);
/** The step played at a chosen tempo, as the kiosk records it. */
const at = (task, tempoPercent) => makeCoachTask(plan, { ...task, tempoPercent, stepTempoPercent: task.tempoPercent });
const skills = (state, passageId = 'a') => projectCoach({ plan, state, dayKey }).segments.find((s) => s.id === passageId).skills;
const readyOf = (state, passageId) => Object.fromEntries(skills(state, passageId).filter((s) => s.track === 'gold').map((s) => [s.skill, s.ready]));
// The ladder's own tempos, read from the plan: nothing here assumes which they are.
const goldCued = plan.tasks.filter((t) => t.passageId === 'a' && t.track === 'gold' && t.mode === 'cued' && !t.rhythm);
const tempos = [...new Set(goldCued.map((t) => t.tempoPercent))].sort((x, y) => x - y);
const below100 = tempos.filter((t) => t < 100);
const chosen = below100.at(-1); // the fastest rung under score tempo
const first = step('rhythm');

describe('a take at a chosen faster tempo', () => {
  it('keeps the step tempo beside the played one, outside the key', () => {
    const task = at(first, chosen);
    expect(task).toMatchObject({ tempoPercent: chosen, stepTempoPercent: first.tempoPercent });
    expect(task.key).toBe(coachTaskKey({ ...first, tempoPercent: chosen }));
    // Not faster: nothing is kept.
    expect(makeCoachTask(plan, { ...first, stepTempoPercent: first.tempoPercent }).stepTempoPercent).toBeUndefined();
  });

  it('a first pass of a real step at T tests out every Gold step of the unit up to T, and nothing above', () => {
    const together = goldCued.find((t) => t.tempoPercent === below100[0] && t.parts.length === 2);
    const state = play(undefined, at(together, chosen));
    const after = skills(state);
    for (const skill of after.filter((s) => s.track === 'gold')) {
      // A real take covers the rhythm step too, whatever its tempo: it is a warm-up, not a speed rung.
      const covered = skill.rhythm || skill.mode === 'metronome' || (skill.mode === 'cued' && skill.tempoPercent <= chosen);
      expect([skill.skill, skill.ready]).toEqual([skill.skill, covered]);
    }
    expect(after.find((s) => s.mastery).ready).toBe(false);
    // Every one-hand beat step is among them, and the other unit is untouched.
    expect(after.filter((s) => /-(rh|lh)$/.test(s.skill)).every((s) => s.ready)).toBe(true);
    expect(Object.values(readyOf(state, 'b')).some(Boolean)).toBe(false);
    expect(Object.values(state.achievements).every((a) => a.provenance === 'tested-out')).toBe(true);
  });

  it('a pass at score tempo tests out the whole Gold lap, Gold itself included', () => {
    const together = goldCued.find((t) => t.tempoPercent === below100[0] && t.parts.length === 2);
    const state = play(undefined, at(together, 100));
    expect(Object.values(readyOf(state, 'a')).every(Boolean)).toBe(true);
    expect(projectCoach({ plan, state, dayKey }).segments.find((s) => s.id === 'a').certification.gold).toBeTruthy();
  });

  it('holds after a reload: the state alone, projected again, says the same', () => {
    const together = goldCued.find((t) => t.tempoPercent === below100[0] && t.parts.length === 2);
    const state = JSON.parse(JSON.stringify(play(undefined, at(together, chosen))));
    expect(readyOf(state, 'a')[`timed-${chosen}`]).toBe(true);
  });

  it('a miss changes nothing: no step charged, no smaller step, back to the step', () => {
    const task = step(`timed-${below100[0]}`);
    let state = play(undefined, task); // one honest pass at the step's own tempo
    const before = { counts: state.counts, achievements: state.achievements, ready: readyOf(state, 'a') };
    state = play(play(state, at(task, chosen), late), at(task, chosen), late);
    expect(state.counts).toEqual(before.counts);
    expect(state.achievements).toEqual(before.achievements);
    expect(readyOf(state, 'a')).toEqual(before.ready);
    const resume = projectCoach({ plan, state, dayKey }).goldResume;
    expect(resume).toMatchObject({ key: task.key, depth: 0 });
    expect(resume.reason).toBeUndefined();
  });

  it('a pitch-free rhythm pass at T tests out only rhythm steps', () => {
    // Whatever the rhythm step's own tempo: a rhythm take chosen above a lower step tempo, at score tempo.
    const rhythmUp = makeCoachTask(plan, { ...first, tempoPercent: 100, stepTempoPercent: Math.min(...tempos) - 1 });
    expect(rhythmUp.stepTempoPercent).toBeLessThan(100);
    const state = play(undefined, rhythmUp);
    const ready = skills(state).filter((s) => s.track === 'gold' && s.ready).map((s) => s.skill);
    expect(ready).toEqual(['rhythm']);
  });

  it('one hand at T covers that hand only', () => {
    const rh = goldCued.find((t) => t.parts.length === 1 && t.parts[0] === 'rh');
    const state = play(undefined, at(rh, chosen));
    const after = skills(state).filter((s) => s.track === 'gold');
    expect(after.filter((s) => s.ready).every((s) => s.parts.length === 1 && s.parts[0] === 'rh')).toBe(true);
    expect(after.find((s) => s.skill === rh.skill).ready).toBe(true);
  });

  it('the step tempo is not a ceiling for a take played at it: an ordinary take is unchanged', () => {
    const task = step(`timed-${chosen}`);
    const state = play(undefined, task);
    expect(readyOf(state, 'a')[`timed-${chosen}`]).toBe(false); // still two good takes out of three
  });
});

describe('the rhythm step never walls a child', () => {
  const rhythmDown = (state, tempoPercent, result = good) => play(state, makeCoachTask(plan, { ...first, tempoPercent, stepTempoPercent: first.tempoPercent }), result);
  const floor = Math.min(...goldCued.map((t) => t.tempoPercent));
  const slower = Math.min(floor, first.tempoPercent - 1);
  it('a pass taken slower than the step clears the rhythm step, and nothing else', () => {
    const state = rhythmDown(undefined, slower);
    expect(skills(state).filter((s) => s.track === 'gold' && s.ready).map((s) => s.skill)).toEqual(['rhythm']);
    expect(projectCoach({ plan, state, dayKey }).gold.a.rhythm).toBeUndefined();
  });
  it('a slower miss changes nothing', () => {
    const state = rhythmDown(undefined, slower, late);
    expect(state.counts).toEqual({});
    expect(skills(state).some((s) => s.ready)).toBe(false);
  });
  it('a slower take is only for the rhythm step: a note step taken down is an ordinary take', () => {
    const task = step(`timed-${tempos.at(-2)}`);
    expect(makeCoachTask(plan, { ...task, tempoPercent: floor - 1, stepTempoPercent: task.tempoPercent }).stepTempoPercent).toBeUndefined();
  });
  it('skipping earns nothing, moves the lap on and is remembered', () => {
    const before = projectCoach({ plan, state: undefined, dayKey });
    expect(before.gold.a.skill).toBe('rhythm');
    const state = applyCoachEvent(play(undefined, first, late), { id: 'skip-1', type: 'skip-rhythm', task: first }, { plan, now: '2026-11-23T18:00:00Z', dayKey });
    const after = projectCoach({ plan, state: JSON.parse(JSON.stringify(state)), dayKey });
    expect(after.gold.a.rhythm).toBeUndefined();
    expect(after.gold.a.track).toBe('gold');
    expect(after.goldResume).toBeNull();
    expect(after.rhythmSkipped).toMatchObject({ a: true, b: false });
    expect(skills(state).some((s) => s.ready)).toBe(false);
    expect(after.gold.b.skill).toBe('rhythm');
  });
});
