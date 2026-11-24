import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachFeedback, coachTaskKey, entryShiftBeats } from './learnCoach.mjs';

const segments = [
  { id: 'opening', inMeasure: 0, outMeasure: 3, printedMeasures: ['1', '4'], playableParts: ['rh', 'lh'] },
  { id: 'answer', inMeasure: 4, outMeasure: 7, printedMeasures: ['5', '8'], playableParts: ['rh'] },
];
const planOf = (over = {}) => createCoachPlan({ scoreId: 'files:test.musicxml', fingerprint: 'content-a', segments, tempoMap: [{ onsetQuarter: 0, bpm: 100 }], goldLadder: { minBpm: 50 }, ...over });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 0.95, placement: 0.95 }, verdict: { passed: true }, diagnostics: { expected_notes: 10, matched_notes: 10, wrong_notes: 0, missed_notes: 0 } };
const bad = { ...good, verdict: { passed: false }, criteria: { completeness: 0.5, cleanliness: 0.5, placement: 0.5 }, diagnostics: { expected_notes: 10, matched_notes: 5, wrong_notes: 5, missed_notes: 5 } };
const choose = (plan, skill, passageId = 'opening') => plan.tasks.find((task) => task.skill === skill && task.passageId === passageId);
const outcome = (state, plan, task, result = good, id = `take-${(state?.revision ?? 0) + 1}`, extra = {}) => applyCoachEvent(state, { id, type: 'outcome', task, result, ...extra }, { plan, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26' });
const projection = (plan, state, extra = {}) => projectCoach({ plan, state, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26', ...extra });

describe('guided musical progression', () => {
  it('offers a concrete first hand task and omits impossible hand stages for single-part music', () => {
    const plan = planOf();
    expect(projection(plan).recommended).toMatchObject({ skill: 'silver', assist: 'none', mode: 'free', parts: ['rh', 'lh'], range: { start: 0, end: 3 } });
    expect(plan.tasks.filter((task) => task.passageId === 'answer').map((task) => task.skill)).toEqual(['notes', 'silver', 'rhythm', 'timed-50', 'timed-70', 'timed-85', 'mastery']);
  });

  it('advances the Gold path after two passes among three equivalent takes and never removes that achievement', () => {
    const plan = planOf(); const task = choose(plan, 'timed-50-rh');
    // The rhythm step comes first; clear it so this test can follow the right hand at the first speed.
    const rhythm = choose(plan, 'rhythm');
    let state = outcome(outcome(undefined, plan, rhythm), plan, rhythm);
    state = outcome(state, plan, task);
    expect(projection(plan, state).gold.opening.skill).toBe('timed-50-rh');
    state = outcome(state, plan, task, bad);
    state = outcome(state, plan, task);
    expect(projection(plan, state).gold.opening.skill).toBe('timed-50-lh');
    state = outcome(state, plan, task, bad);
    expect(projection(plan, state).segments[0].skills.find((skill) => skill.skill === 'timed-50-rh').ready).toBe(true);
  });

  it('does not combine unlike practice settings to manufacture timed readiness', () => {
    const plan = planOf();const task = choose(plan, 'timed-70');
    let state = outcome(undefined, plan, task);
    state = outcome(state, plan, { ...task, tempoPercent: 60 });
    expect(projection(plan, state).segments[0].skills.find((skill) => skill.skill === 'timed-70').ready).toBe(false);
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
    // A click-assisted (metronome, timing ungraded) take: the retired beat step, still accepted when saved.
    const plan = planOf();const task = { ...choose(plan, 'timed-50'), skill: 'pulse', mode: 'metronome' };
    const state = outcome(outcome(undefined, plan, task), plan, task);
    expect(projection(plan, state).segments[0].mastered).toBe(false);
    expect(projection(plan, state).segments[0].skills.find((s) => s.skill === 'together').ready).toBe(true);
  });

  it.each(['aborted', 'error', 'prepared'])('does not change ability from a %s take', (status) => {
    const plan = planOf();const task = choose(plan, 'right');
    const state = outcome(outcome(undefined, plan, task, { ...bad, status }), plan, task, { ...bad, status });
    expect(projection(plan, state).recommended).toMatchObject({ skill: 'silver', range: { start: 0, end: 3 } });
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
  it('targets the hardest normalized measure, with the bar before it, only after two equivalent unsuccessful takes', () => {
    const plan = planOf();const task = choose(plan, 'right');
    const result = { ...bad, criteria: { completeness: 1, cleanliness: 0.5 }, spans: {
      'measure:0': { diagnostics: { expected_notes: 20, missed_notes: 2, wrong_notes: 0 } },
      'measure:2': { diagnostics: { expected_notes: 4, missed_notes: 2, wrong_notes: 2 } },
    } };
    let state = outcome(undefined, plan, task, result);
    expect(projection(plan, state).recommended.range).toEqual({ start: 0, end: 3 });
    state = outcome(state, plan, task, result);
    expect(projection(plan, state).recommended).toMatchObject({ range: { start: 1, end: 2 }, parent: { skill: 'right' }, depth: 1 });
  });

  it('falls back to the first half and cannot recurse endlessly on a one-bar task', () => {
    const plan = planOf();const task = choose(plan, 'right');
    let state = outcome(outcome(undefined, plan, task, bad), plan, task, bad);
    let recovery = projection(plan, state).recommended;
    expect(recovery.range).toEqual({ start: 0, end: 1 });
    state = outcome(outcome(state, plan, recovery, bad), plan, recovery, bad);
    recovery = projection(plan, state).recommended;
    expect(recovery.depth).toBeLessThanOrEqual(3);
    state = outcome(outcome(state, plan, recovery, bad), plan, recovery, bad);
    expect(projection(plan, state).recommended.depth).toBeLessThanOrEqual(3);
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
    const plan = planOf();const task = choose(plan, 'timed-85');
    const timing = { ...bad, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 } };
    let state = outcome(outcome(undefined, plan, task, timing), plan, task, timing);
    // The slower rungs are the plan's own speeds: 85, then 70, then 50.
    expect(projection(plan, state).goldResume).toMatchObject({ tempoPercent: 70, range: { start: 0, end: 3 } });
    let slower = projection(plan, state).goldResume;
    state = outcome(outcome(state, plan, slower, timing), plan, slower, timing);
    expect(projection(plan, state).goldResume).toMatchObject({ tempoPercent: 50, range: { start: 0, end: 3 } });
    slower = projection(plan, state).goldResume;
    state = outcome(outcome(state, plan, slower, timing), plan, slower, timing);
    // Nothing slower is left: the pitch comes off (tap the rhythm) at that speed.
    expect(projection(plan, state).goldResume).toMatchObject({ tempoPercent: 50, reason: 'rhythm', rhythm: true, range: { start: 0, end: 3 }, depth: 3 });
  });

  it('keeps the same task after a named shifted entry: the start was wrong, not the passage', () => {
    const plan = planOf();const task = choose(plan, 'timed-50');
    const shifted = { ...bad, criteria: { completeness: 0.25, cleanliness: 0.25, placement: 0 }, entryShift: { beats: 1, matched: 4, possible: 4 } };
    const state = outcome(outcome(undefined, plan, task, shifted), plan, task, shifted);
    expect(projection(plan, state).goldResume).toMatchObject({ key: task.key, depth: 0 });
    // Without the shift the same two takes step down to a smaller task.
    const { entryShift: ignored, ...unnamed } = shifted;void ignored;
    const plain = outcome(outcome(undefined, plan, task, unnamed), plan, task, unnamed);
    expect(projection(plan, plain).goldResume.depth).toBe(1);
  });

  it('reads an entry shift as null when untested and 0 when tested and none was named', () => {
    expect(entryShiftBeats(bad)).toBeNull();
    expect(entryShiftBeats({ ...bad, entryShift: { beats: 0 } })).toBe(0);
    expect(entryShiftBeats({ ...bad, entryShift: { beats: -1 } })).toBe(-1);
    const plan = planOf();const task = choose(plan, 'timed-50');
    const none = { ...bad, entryShift: { beats: 0 } };
    expect(projection(plan, outcome(outcome(undefined, plan, task, none), plan, task, none)).goldResume.depth).toBe(1);
  });

  it('names a shifted entry in the feedback on a cued step, never on a passed take', () => {
    const task = choose(planOf(), 'timed-50');
    expect(coachFeedback({ ...bad, entryShift: { beats: 1 } }, task)).toMatchObject({ reason: 'entry-late', entryShiftBeats: 1,
      title: 'Start on the click', detail: 'You started one beat late — start on the click after the count.' });
    expect(coachFeedback({ ...bad, entryShift: { beats: -2 } }, task)).toMatchObject({ reason: 'entry-early', entryShiftBeats: -2,
      title: 'Wait for the click', detail: 'You started two beats early — wait for the click after the count.' });
    expect(coachFeedback({ ...good, entryShift: { beats: 1 } }, task).reason).toBe('passed');
    expect(coachFeedback({ ...bad, entryShift: { beats: 1 } }, choose(planOf(), 'right')).reason).not.toMatch(/^entry-/);
  });

  it('never describes metronome practice as measured timing accuracy', () => {
    const task = { ...choose(planOf(), 'timed-50'), mode: 'metronome' };
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
    expect(projection(plan, state).recommended.skill).toBe('silver');
    const legacy = { learn: { passages: { opening: { rungs: { right: { passCount: 1 } } } } } };
    expect(projection(old, undefined, { legacy }).recommended.skill).toBe('silver');
  });

  it('keeps an explicitly selected review on the Gold path even though mastery is earned', () => {
    const plan = planOf(); const task = choose(plan, 'mastery');
    let state = outcome(outcome(undefined, plan, task), plan, task);
    const review = projectCoach({ plan, state, dayKey: '2026-10-27' }).review;
    state = applyCoachEvent(state, { id: 'choose-review', type: 'selection', task: review }, { plan, now: '2026-10-27T18:00:00Z', dayKey: '2026-10-27' });
    expect(projectCoach({ plan, state, dayKey: '2026-10-27' }).goldResume).toMatchObject({ review: true, skill: 'mastery' });
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
  it('excludes silent completed takes from readiness and difficulty while explaining no input', () => {
    const plan=planOf();const task=choose(plan,'timed-70');
    const silent={...bad,diagnostics:{expected_notes:10,matched_notes:0,wrong_notes:0,missed_notes:10}};
    let state=outcome(undefined,plan,task,silent);state=outcome(state,plan,task,silent);
    expect(state.evidence).toHaveLength(0);expect(state.resume).toBeNull();
    expect(coachFeedback(silent,task)).toMatchObject({reason:'no-input'});
  });
  it('grandfathers three earned timed passes and equivalent single-part hand work', () => {
    const plan=planOf();const legacy={learn:{passages:{opening:{rungs:{timed:{passCount:3}}},answer:{rungs:{right:{passCount:6}}}}}};
    const p=projection(plan,null,{legacy});
    // The old `timed` rung (60%) maps to the first speed's step.
    expect(p.segments[0].skills.find(s=>s.skill==='timed-50')).toMatchObject({ready:true,provenance:'legacy'});
    expect(p.segments[0].skills.find(s=>s.skill==='timed-70').ready).toBe(false);
    expect(p.segments[1].skills.find(s=>s.skill==='notes')).toMatchObject({ready:true,provenance:'legacy'});
  });
  it('offers optional full-tempo mastery without replacing an authored practice-plan quota', () => {
    const plan=planOf({authoredLadder:true,segments:[{...segments[0],ladder:[{id:'phrase',label:'Phrase',effectiveParts:['rh'],mode:'free',sets:1,reps:4,completes:'passage'}]}]});
    const demo=plan.segments[0].demonstration;expect(demo).toMatchObject({mastery:true,mode:'cued',parts:['rh','lh'],tempoPercent:100});
    let state=outcome(outcome(undefined,plan,demo),plan,demo);
    expect(projection(plan,state).segments[0]).toMatchObject({mastered:true,complete:false});
    expect(projection(plan,state).recommended.skill).toBe('phrase');
  });
  it('retains authored set tempos, requiring distinct successful takes at each stage', () => {
    const plan=planOf({authoredLadder:true,segments:[{...segments[0],ladder:[{id:'ramp',label:'Ramp',effectiveParts:['rh','lh'],mode:'cued',sets:2,reps:1,tempoPercent:60,tempoPercents:[60,100],completes:'passage'}]}]});
    const first=projection(plan).recommended;expect(first.tempoPercent).toBe(60);
    let state=outcome(undefined,plan,first);const second=projection(plan,state).recommended;expect(second.tempoPercent).toBe(100);
    state=outcome(state,plan,first);expect(projection(plan,state).segments[0].complete).toBe(false);
    state=outcome(state,plan,second);expect(projection(plan,state).segments[0].complete).toBe(true);
    const full=plan.segments[0].demonstration;const once=outcome(undefined,plan,full);
    expect(projection(plan,once).segments[0].complete).toBe(false);
  });

});

describe('Gold tempo ladder: 50, 70, 85, then score tempo (2026-11-23 late night)', () => {
  const gold = (plan, passageId = 'opening') => plan.tasks.filter((task) => task.passageId === passageId && task.track === 'gold');
  const stateWith = (...keys) => ({ version: 1, scoreId: 'files:test.musicxml', fingerprint: 'content-a', revision: 3,
    achievements: Object.fromEntries(keys.map((key) => [key, { at: '2026-10-01T18:00:00Z', dayKey: '2026-10-01', provenance: 'demonstrated' }])),
    counts: {}, evidence: [], reviews: {}, resume: null });
  // The keys a child earned under an old ladder (30/50/75, or 60/80 before that).
  const oldKey = (plan, mode, tempoPercent) => coachTaskKey({ ...choose(plan, 'timed-50'), mode, tempoPercent });
  const skillOf = (p, skill) => p.segments[0].skills.find((item) => item.skill === skill);

  it('taps the rhythm at score tempo, then each hand and both at 50, then 70, 85 and score tempo; no beat step', () => {
    const plan = planOf();
    expect(gold(plan).map(({ skill, mode, tempoPercent, label }) => [skill, mode, tempoPercent, label])).toEqual([
      ['rhythm', 'cued', 100, 'Tap the rhythm'],
      ['timed-50-rh', 'cued', 50, 'Right hand with the beat'],
      ['timed-50-lh', 'cued', 50, 'Left hand with the beat'],
      ['timed-50', 'cued', 50, 'Play with the beat'],
      ['timed-70', 'cued', 70, 'Play with the beat'],
      ['timed-85', 'cued', 85, 'Play with the beat'],
      ['mastery', 'cued', 100, 'Play at score tempo'],
    ]);
    expect(choose(plan, 'mastery')).toMatchObject({ mastery: true, completes: true });
    expect(gold(plan).filter((task) => task.mastery || task.completes).map((task) => task.skill)).toEqual(['mastery']);
    // The first timed take opens on the beat loop (the retired beat step's lead-in), and only that one.
    expect(gold(plan).filter((task) => task.leadIn).map((task) => task.skill)).toEqual(['timed-50-rh']);
    expect(gold(plan, 'answer').filter((task) => task.leadIn).map((task) => task.skill)).toEqual(['timed-50']);
    expect(plan.goldTempos).toEqual([50, 70, 85, 100]);
  });

  it('reads the speeds from the config, validated, and lifts slow rungs to the bpm floor', () => {
    expect(planOf({ goldLadder: { tempos: [60, 80, 100], minBpm: 40 } }).goldTempos).toEqual([60, 80, 100]);
    // Invalid (not ascending, not ending at 100, out of range) falls back to the default.
    for (const tempos of [[70, 50, 100], [50, 70, 85], [0, 50, 100], 'fast']) expect(planOf({ goldLadder: { tempos, minBpm: 40 } }).goldTempos).toEqual([50, 70, 85, 100]);
    // 60 bpm at a 100 bpm score is 60%: the 50% rung is lifted to it.
    expect(planOf({ goldLadder: undefined }).goldTempos).toEqual([60, 70, 85, 100]);
    // A slow score (72 bpm): 50% and 70% would be 36 and 50 bpm, both lifted to 84% (60.5 bpm); 84 sits within
    // ten points of 85, so it merges into it: 85 and score tempo.
    const slow = planOf({ goldLadder: undefined, tempoMap: [{ onsetQuarter: 0, bpm: 72 }] });
    expect(slow.goldTempos).toEqual([85, 100]);
    expect(slow.tasks.filter((task) => task.passageId === 'answer' && task.track === 'gold').map((task) => task.skill)).toEqual(['rhythm', 'timed-85', 'mastery']);
    // Hands alone at the (merged) first speed.
    expect(slow.tasks.filter((task) => task.passageId === 'opening' && /-(rh|lh)$/.test(task.skill)).map((task) => task.skill)).toEqual(['timed-85-rh', 'timed-85-lh']);
    // A piece with no known tempo keeps the configured speeds.
    expect(planOf({ goldLadder: undefined, tempoMap: [] }).goldTempos).toEqual([50, 70, 85, 100]);
  });

  it('merges a lifted rung into the next one within ten points, never dropping 100 or an untouched rung', async () => {
    const { goldTemposFor } = await import('./learnCoach.mjs');
    const at = (bpm, tempos) => goldTemposFor({ tempos, minBpm: 60 }, [{ onsetQuarter: 0, bpm }]);
    // 100 bpm: 50 lifts to 60, ten points from 70, so both stay.
    expect(at(100, [50, 70, 85, 100])).toEqual([60, 70, 85, 100]);
    // 72 bpm: 50 and 70 lift to 84, one point from 85: merged.
    expect(at(72, [50, 70, 85, 100])).toEqual([85, 100]);
    // 63 bpm: everything below 100 lifts to 96, four points from 100: only score tempo is left.
    expect(at(63, [50, 70, 85, 100])).toEqual([100]);
    // A ladder the floor does not touch is kept as configured, however close its rungs.
    expect(at(200, [90, 95, 100])).toEqual([90, 95, 100]);
    // The joins' Gold uses the same merged speeds.
    const slow = planOf({ goldLadder: undefined, segments: [segments[0], { ...segments[0], id: 'more', inMeasure: 4, outMeasure: 7, printedMeasures: ['5', '8'] }, { ...segments[0], id: 'last', inMeasure: 8, outMeasure: 11, printedMeasures: ['9', '12'] }],
      tempoMap: [{ onsetQuarter: 0, bpm: 72 }] });
    const join = slow.segments.find((segment) => segment.kind === 'join' && !segment.final);
    expect(join.tasks.filter((task) => task.track === 'gold').map((task) => task.tempoPercent)).toEqual([85, 100]);
  });

  it('writes the score tempo on the coach summary, for readers without the score', async () => {
    const { coachSummary } = await import('./learnCoach.mjs');
    const plan = planOf({ tempoMap: [{ onsetQuarter: 0, bpm: 72 }] });
    expect(coachSummary(projection(plan, null), { now: 'x' }).baseBpm).toBe(72);
    expect(coachSummary(projection(planOf({ tempoMap: [] }), null), { now: 'x' }).baseBpm).toBeNull();
  });

  it('steps a timing-only miss down one rung of the plan: 85 to 70 and 70 to 50', () => {
    const plan = planOf();
    const timing = { ...bad, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 } };
    for (const [skill, slower] of [['timed-85', 70], ['timed-70', 50]]) {
      const task = choose(plan, skill);
      const state = outcome(outcome(undefined, plan, task, timing), plan, task, timing);
      expect(projection(plan, state).goldResume).toMatchObject({ tempoPercent: slower, reason: 'slower-beat', depth: 1 });
    }
  });

  it('steps the rhythm step down through the slower-beat recovery, and back up when it passes', () => {
    const plan = planOf(); const rhythm = choose(plan, 'rhythm');
    const timing = { ...bad, criteria: { completeness: 1, cleanliness: 1, placement: 0.2 } };
    let state = outcome(outcome(undefined, plan, rhythm, timing), plan, rhythm, timing);
    const down = projection(plan, state).goldResume;
    expect(down).toMatchObject({ rhythm: true, tempoPercent: 85, reason: 'slower-beat', depth: 1 });
    state = outcome(outcome(state, plan, down), plan, down);
    expect(projection(plan, state).goldResume.key).toBe(rhythm.key);
    // A slower rhythm pass proves only its drill, never the rhythm step at score tempo or a timed step.
    const skills = projection(plan, state).segments[0].skills;
    expect(skills.find((s) => s.skill === 'rhythm').ready).toBe(false);
    expect(skills.filter((s) => s.track === 'gold' && !s.rhythm).some((s) => s.ready)).toBe(false);
  });

  it('keeps a rhythm step earned at the old 50%', () => {
    const plan = planOf();
    const old = coachTaskKey({ ...choose(plan, 'rhythm'), tempoPercent: 50 });
    const p = projection(plan, stateWith(old));
    expect(skillOf(p, 'rhythm').ready).toBe(true);
    expect(p.gold.opening.skill).toBe('timed-50-rh');
  });

  it('a child who earned 60% and 80% keeps every rung at or below 80 and goes on to 85', () => {
    const plan = planOf();
    const p = projection(plan, stateWith(oldKey(plan, 'metronome', 60), oldKey(plan, 'cued', 60), oldKey(plan, 'cued', 80)));
    for (const skill of ['timed-50-rh', 'timed-50-lh', 'timed-50', 'timed-70']) expect(skillOf(p, skill).ready).toBe(true);
    expect(skillOf(p, 'timed-85').ready).toBe(false);
    expect(p.gold.opening.skill).toBe('rhythm');
    expect(p.segments[0].certification.gold).toBeNull();
  });

  it('a child who earned 75% on the 30/50/75 ladder keeps 50 and 70 and goes on to 85', () => {
    const plan = planOf();
    const rhythm = coachTaskKey({ ...choose(plan, 'rhythm'), tempoPercent: 50 });
    const p = projection(plan, stateWith(rhythm, oldKey(plan, 'cued', 75)));
    for (const skill of ['timed-50', 'timed-70']) expect(skillOf(p, skill).ready).toBe(true);
    expect(skillOf(p, 'timed-85').ready).toBe(false);
    expect(p.gold.opening.skill).toBe('timed-85');
  });

  it('a pulse achievement gates nothing and proves no timed step', () => {
    const plan = planOf();
    const p = projection(plan, stateWith(oldKey(plan, 'metronome', 30)));
    expect(p.segments[0].skills.filter((s) => s.track === 'gold').some((s) => s.ready)).toBe(false);
    expect(p.gold.opening.skill).toBe('rhythm');
  });

  it('carries over only the same bars and parts at an equal or faster tempo', () => {
    const plan = planOf();
    const other = coachTaskKey({ ...choose(plan, 'timed-50'), tempoPercent: 80, range: { start: 0, end: 1 } });
    const oneHand = coachTaskKey({ ...choose(plan, 'timed-50'), tempoPercent: 80, parts: ['rh'] });
    const slower = oldKey(plan, 'cued', 40);
    const p = projection(plan, stateWith(other, oneHand, slower));
    for (const skill of ['timed-50', 'timed-70', 'timed-85']) expect(skillOf(p, skill).ready).toBe(false);
    expect(p.gold.opening.skill).toBe('rhythm');
  });

  describe('a saved Gold step from the old 60/80/100 ladder', () => {
    const select = (plan, task, state) => applyCoachEvent(state, { id: `sel-${task.key}`, type: 'selection', task }, { plan, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26' });
    const oldTimed80 = (plan) => ({ ...choose(plan, 'timed-50'), skill: 'timed-80', tempoPercent: 80 });

    it('no longer resumes; the next unready Gold step does', () => {
      const plan = planOf();
      const state = select(plan, oldTimed80(plan), stateWith(oldKey(plan, 'cued', 60), coachTaskKey({ ...choose(plan, 'rhythm'), tempoPercent: 50 })));
      expect(state.goldResume).toMatchObject({ tempoPercent: 80, track: 'gold' });
      const p = projection(plan, state);
      expect(p.goldResume).toBeNull();
      expect(p.gold.opening.skill).toBe('timed-70');
    });

    it('still resumes a slower-beat recovery drill below the ladder', () => {
      const plan = planOf();
      const drill = { ...choose(plan, 'timed-50'), tempoPercent: 40, depth: 1, parent: choose(plan, 'timed-50'), reason: 'slower-beat' };
      expect(projection(plan, select(plan, drill)).goldResume).toMatchObject({ tempoPercent: 40, depth: 1 });
    });

    it('still resumes an explicit review, and a Gold step whose tempo is on the ladder', () => {
      const plan = planOf();
      const review = { ...oldTimed80(plan), review: true };
      expect(projection(plan, select(plan, review)).goldResume).toMatchObject({ review: true, tempoPercent: 80 });
      const edited = { ...choose(plan, 'timed-50'), criteria: { completeness: 1, cleanliness: 0.8, placement: 0.7 } };
      expect(projection(plan, select(plan, edited)).goldResume).toMatchObject({ tempoPercent: 50 });
    });

    it('leaves an authored ladder\'s saved step alone', () => {
      const plan = planOf({ authoredLadder: true, segments: [{ ...segments[0], ladder: [
        { id: 'slow', label: 'Slow', effectiveParts: ['rh', 'lh'], mode: 'cued', tempoPercent: 50, sets: 1, reps: 2, completes: 'passage' },
      ] }] });
      // An authored step at a tempo the ladder no longer has, saved mid-practice.
      const off = { ...choose(plan, 'slow'), tempoPercent: 70, depth: 1 };
      expect(projection(plan, select(plan, off)).recommended).toMatchObject({ skill: 'slow', tempoPercent: 70 });
    });
  });

  it('leaves authored ladders to their own steps', () => {
    const plan = planOf({ authoredLadder: true, segments: [{ ...segments[0], ladder: [
      { id: 'slow', label: 'Slow', effectiveParts: ['rh', 'lh'], mode: 'cued', tempoPercent: 50, sets: 1, reps: 2 },
      { id: 'fast', label: 'Fast', effectiveParts: ['rh', 'lh'], mode: 'cued', tempoPercent: 80, sets: 1, reps: 2, completes: 'passage' },
    ] }] });
    const fast = choose(plan, 'fast');
    const p = projection(plan, { ...stateWith(fast.key) });
    expect(skillOf(p, 'fast').ready).toBe(true);
    expect(skillOf(p, 'slow').ready).toBe(false);
  });
});

describe('one hand at a time with the beat (2026-11-22), at the first speed only', () => {
  it('puts one-hand beat rungs after the rhythm and before both hands at the first speed', () => {
    const plan = planOf();
    expect(plan.tasks.filter((task) => task.passageId === 'opening').map((task) => task.skill)).toEqual(
      ['right', 'left', 'together', 'silver', 'rhythm', 'timed-50-rh', 'timed-50-lh', 'timed-50', 'timed-70', 'timed-85', 'mastery']);
    expect(choose(plan, 'timed-50-rh')).toMatchObject({ parts: ['rh'], mode: 'cued', tempoPercent: 50, track: 'gold', label: 'Right hand with the beat' });
    expect(choose(plan, 'timed-50-lh')).toMatchObject({ parts: ['lh'], mode: 'cued', tempoPercent: 50, track: 'gold', label: 'Left hand with the beat' });
  });
  it('adds no one-hand rungs to a one-part passage', () => {
    expect(planOf().tasks.filter((task) => task.passageId === 'answer').map((task) => task.skill))
      .toEqual(['notes', 'silver', 'rhythm', 'timed-50', 'timed-70', 'timed-85', 'mastery']);
  });
  it('a both-hands proof covers the one-hand rungs at or below its tempo', () => {
    const plan = planOf();
    let state = outcome(undefined, plan, choose(plan, 'timed-70'));
    state = outcome(state, plan, choose(plan, 'timed-70'));
    const skills = projection(plan, state).segments[0].skills;
    expect(skills.find((s) => s.skill === 'timed-50-rh').ready).toBe(true);
    expect(skills.find((s) => s.skill === 'timed-50-lh').ready).toBe(true);
  });
  it('a one-hand proof never covers both hands', () => {
    const plan = planOf();
    let state = outcome(undefined, plan, choose(plan, 'timed-50-rh'));
    state = outcome(state, plan, choose(plan, 'timed-50-rh'));
    const skills = projection(plan, state).segments[0].skills;
    expect(skills.find((s) => s.skill === 'timed-50-rh').ready).toBe(true);
    expect(skills.find((s) => s.skill === 'timed-50').ready).toBe(false);
    expect(projection(plan, state).gold.opening.skill).toBe('rhythm');
  });
  it('a resume saved on both hands before the one-hand rungs existed gives way to the right hand', () => {
    const plan = planOf();
    // A state saved by the old ladder carries no `ladder` revision.
    const rhythm = choose(plan, 'rhythm');
    const saved = outcome(outcome(undefined, plan, rhythm), plan, rhythm);
    const { ladder, ...state } = outcome(saved, plan, choose(plan, 'timed-50'), bad);
    expect(ladder).toBe(3);
    expect(state.goldResume).toBeTruthy();
    const p = projection(plan, state);
    expect(p.goldResume).toBeNull();
    expect(p.gold.opening.skill).toBe('timed-50-rh');
  });
  it('a child who tried a one-hand rung and then chose both hands keeps that choice', () => {
    const plan = planOf();
    let state = outcome(undefined, plan, choose(plan, 'timed-50-rh'), bad);
    state = outcome(state, plan, choose(plan, 'timed-50-lh'), bad);
    state = outcome(state, plan, choose(plan, 'timed-50'), bad);
    expect(projection(plan, state).goldResume).toBeTruthy();
  });
  it('a child who taps both hands on the new ladder keeps that choice', () => {
    const plan = planOf();
    const state = outcome(undefined, plan, choose(plan, 'timed-50'), bad);
    expect(projection(plan, state).goldResume).toBeTruthy();
  });
});
