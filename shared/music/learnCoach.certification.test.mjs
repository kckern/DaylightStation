import { describe, expect, it } from 'vitest';
import stuck from './__fixtures__/learnCoachStuckLearner.json';
import { applyCoachEvent, coachSummary, coachTaskKey, createCoachPlan, normalizeCertification, projectCoach } from './learnCoach.mjs';

const DAY = '2026-11-18';
const segments = [
  { id: 'one', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] },
  { id: 'two', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] },
  { id: 'solo', inMeasure: 8, outMeasure: 11, playableParts: ['rh'] },
];
const planOf = (over = {}) => createCoachPlan({ scoreId: 'files:t.mxl', fingerprint: 'c', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], ...over });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 0.95, placement: 0.95 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 }, spans: {} };
const bad = { ...good, criteria: { completeness: 1, cleanliness: 0.5, placement: 0.5 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 8, missed_notes: 0 } };
const task = (plan, skill, passageId = 'one') => plan.tasks.find((t) => t.skill === skill && t.passageId === passageId);
let n = 0;
const play = (state, plan, t, result = good, dayKey = DAY, legacy = {}) => applyCoachEvent(state, { id: `e${n += 1}`, type: 'outcome', task: t, result }, { plan, now: `${dayKey}T12:00:00Z`, dayKey, legacy });
const view = (plan, state, extra = {}) => projectCoach({ plan, state, dayKey: DAY, ...extra });
const unassisted = ({ assist: _assist, key: _key, ...rest }) => rest;

describe('certification policy', () => {
  it('defaults and rejects invalid values', () => {
    expect(normalizeCertification()).toEqual({ silver: { stepPasses: 1, checkPasses: 1, cleanliness: 0.8, stallSeconds: 30 } });
    expect(normalizeCertification({ silver: { stepPasses: 0, checkPasses: 2.5, cleanliness: 4, stallSeconds: -1 } }).silver)
      .toEqual({ stepPasses: 1, checkPasses: 1, cleanliness: 0.8, stallSeconds: 30 });
  });
  it('applies configured step and check counts', () => {
    const plan = planOf({ certification: { silver: { stepPasses: 2, checkPasses: 3, cleanliness: 0.9 } } });
    expect(task(plan, 'right').required).toBe(2);
    expect(task(plan, 'silver')).toMatchObject({ required: 3, criteria: { cleanliness: 0.9 } });
  });
  it('keeps Silver when the cleanliness policy changes', () => {
    const plan = planOf();
    const state = play(undefined, plan, task(plan, 'silver'));
    const stricter = planOf({ certification: { silver: { cleanliness: 0.95 } } });
    expect(view(stricter, state).certifications.one.silver).toMatchObject({ provenance: 'check' });
  });
});

describe('Silver and Gold tasks', () => {
  it('adds the Silver check after the note steps', () => {
    const plan = planOf();
    expect(plan.tasks.filter((t) => t.passageId === 'one').map((t) => t.skill)).toEqual(['right', 'left', 'together', 'silver', 'pulse', 'timed-60', 'timed-80', 'mastery']);
    expect(plan.tasks.filter((t) => t.passageId === 'solo').map((t) => t.skill)).toEqual(['notes', 'silver', 'pulse', 'timed-60', 'timed-80', 'mastery']);
    expect(task(plan, 'silver')).toMatchObject({ label: 'Play it on your own', mode: 'free', assist: 'none', track: 'silver', parts: ['rh', 'lh'] });
    expect(task(plan, 'pulse').track).toBe('gold');
  });
  it('keeps existing task keys', () => {
    const t = task(planOf(), 'right');
    const { track: _track, required: _required, legacyRequired: _legacy, ...plain } = t;
    expect(coachTaskKey(plain)).toBe(t.key);
    expect(t.key).toBe(JSON.stringify(['files:t.mxl', 'c', 0, 3, ['rh'], 'free', null, { cleanliness: 0.8, completeness: 1 }]));
  });
  it('one clean take completes a note step', () => {
    const plan = planOf();
    expect(view(plan, play(undefined, plan, task(plan, 'right'))).recommended.skill).toBe('left');
  });
  it('old legacy partial counts do not satisfy a one-take step', () => {
    const plan = planOf();
    const legacy = { learn: { passages: { one: { rungs: { right: { passCount: 1 } } } } } };
    expect(view(plan, null, { legacy }).segments[0].skills.find((s) => s.skill === 'right').ready).toBe(false);
  });
  it('earns Silver with one passing hints-off take', () => {
    const plan = planOf();
    expect(view(plan, play(undefined, plan, task(plan, 'silver'))).certifications.one.silver).toMatchObject({ provenance: 'check', at: `${DAY}T12:00:00Z` });
  });
  it('holds the check to the cleanliness line', () => {
    const plan = planOf();
    const at = (cleanliness) => view(plan, play(undefined, plan, task(plan, 'silver'), { ...good, criteria: { completeness: 1, cleanliness } })).certifications.one.silver;
    expect(at(0.79)).toBeNull();
    expect(at(0.8)).not.toBeNull();
  });
  it('does not let a hinted free take prove Silver', () => {
    const plan = planOf();
    expect(view(plan, play(undefined, plan, task(plan, 'together'))).certifications.one.silver).toBeNull();
  });
  it('accepts an old-client free take without proving Silver', () => {
    const plan = planOf();
    const old = { ...unassisted(task(plan, 'silver')), skill: 'custom' };
    const projected = view(plan, play(undefined, plan, old));
    expect(projected.certifications.one.silver).toBeNull();
    expect(projected.segments[0].skills.find((s) => s.skill === 'together').ready).toBe(true);
  });
  it('Gold grants Silver with provenance gold', () => {
    const plan = planOf(); const gold = task(plan, 'mastery');
    const c = view(plan, play(play(undefined, plan, gold), plan, gold)).certifications.one;
    expect(c.gold).toMatchObject({ provenance: 'demonstrated' });
    expect(c.silver).toMatchObject({ provenance: 'gold' });
  });
  it('legacy completion counts as Silver and Gold, legacy hand steps do not', () => {
    const plan = planOf();
    const legacy = { learn: { passages: { one: { complete: true }, two: { rungs: { right: { passCount: 6 }, left: { passCount: 6 }, together: { passCount: 6 } } } } } };
    const c = view(plan, null, { legacy }).certifications;
    expect(c.one).toMatchObject({ silver: { provenance: 'legacy', at: null }, gold: { provenance: 'legacy', at: null } });
    expect(c.two).toEqual({ silver: null, gold: null });
  });
  it('a Silver passage has every Silver-track skill ready', () => {
    const plan = planOf();
    const skills = view(plan, play(undefined, plan, task(plan, 'silver'))).segments[0].skills;
    expect(skills.filter((s) => s.track === 'silver').every((s) => s.ready)).toBe(true);
  });
  it('authored ladders get no Silver check, and a completed plan counts as Silver', () => {
    const plan = planOf({ authoredLadder: true, segments: [{ ...segments[0], ladder: [{ id: 'phrase', label: 'Phrase', effectiveParts: ['rh'], mode: 'free', sets: 1, reps: 1, completes: 'passage' }] }] });
    expect(plan.tasks.some((t) => t.skill === 'silver')).toBe(false);
    expect(view(plan, play(undefined, plan, task(plan, 'phrase'))).certifications.one.silver).not.toBeNull();
  });
  it('a stalled take drills the first bar with missed notes', () => {
    const plan = planOf(); const check = task(plan, 'silver');
    const stalled = { ...good, criteria: { completeness: 0.4, cleanliness: 1 }, diagnostics: { expected_notes: 8, matched_notes: 3, wrong_notes: 0, missed_notes: 5 },
      spans: { 'measure:0': { diagnostics: { expected_notes: 2, missed_notes: 0, wrong_notes: 0 } }, 'measure:1': { diagnostics: { expected_notes: 2, missed_notes: 1, wrong_notes: 0 } }, 'measure:2': { diagnostics: { expected_notes: 2, missed_notes: 2, wrong_notes: 0 } } } };
    const drill = view(plan, play(play(undefined, plan, check, stalled), plan, check, stalled)).recommended;
    expect(drill).toMatchObject({ depth: 1, range: { start: 1, end: 1 } });
    expect(drill.assist).toBeUndefined();
  });
});

describe('what comes next', () => {
  const stuckPlan = () => createCoachPlan({ scoreId: stuck.state.scoreId, fingerprint: stuck.state.fingerprint, tempoMap: [{ onsetQuarter: 0, bpm: 90 }],
    segments: Object.keys(stuck.legacy.learn.segments).map((id) => { const [, a, b] = id.match(/^m(\d+)-(\d+)$/); return { id, inMeasure: +a, outMeasure: +b, playableParts: ['rh', 'lh'] }; }) });
  it('sends the stuck learner to the Silver check on bars 1-5, then bars 6-9', () => {
    const plan = stuckPlan();
    const first = view(plan, stuck.state, { legacy: stuck.legacy });
    expect(first.recommended).toMatchObject({ passageId: 'm0-4', skill: 'silver' });
    const after = view(plan, play(stuck.state, plan, first.recommended, good, DAY, stuck.legacy), { legacy: stuck.legacy });
    expect(after.recommended).toMatchObject({ passageId: 'm5-8', skill: 'right' });
  });
  it('failed metronome takes never change recommended', () => {
    const plan = planOf(); const before = view(plan).recommended.key;
    let state; for (const skill of ['pulse', 'pulse', 'mastery', 'mastery']) state = play(state, plan, task(plan, skill), bad);
    const projected = view(plan, state);
    expect(projected.recommended.key).toBe(before);
    expect(projected.goldResume).toMatchObject({ depth: 1, mode: 'cued' });
  });
  it('a depth-0 resume no longer overrides score order', () => {
    const plan = planOf();
    const state = applyCoachEvent(undefined, { id: 's', type: 'selection', task: task(plan, 'right', 'two') }, { plan, now: 'x', dayKey: DAY });
    expect(view(plan, state).recommended.passageId).toBe('one');
  });
  it('a Silver drill comes first and survives Gold work', () => {
    const plan = planOf(); const check = task(plan, 'silver');
    let state = play(play(undefined, plan, check, bad), plan, check, bad);
    const drill = view(plan, state).recommended;
    expect(drill.depth).toBe(1);
    state = play(state, plan, task(plan, 'pulse'), bad);
    expect(view(plan, state).recommended.key).toBe(drill.key);
  });
  it('a selected review goes to goldResume and never becomes recommended', () => {
    const plan = planOf(); const gold = task(plan, 'mastery');
    let state = play(play(undefined, plan, gold), plan, gold);
    const later = projectCoach({ plan, state, dayKey: '2026-11-19' });
    state = applyCoachEvent(state, { id: 'r', type: 'selection', task: later.review }, { plan, now: 'x', dayKey: '2026-11-19' });
    const projected = projectCoach({ plan, state, dayKey: '2026-11-19' });
    expect(projected.goldResume).toMatchObject({ review: true });
    expect(projected.recommended.passageId).toBe('two');
  });
  it('after two misses, set-aside clears the drill and recommends the next passage', () => {
    const plan = planOf(); const check = task(plan, 'silver');
    let state = play(play(undefined, plan, check, bad), plan, check, bad);
    expect(view(plan, state).canSetAside.one).toBe(true);
    state = applyCoachEvent(state, { id: 'a', type: 'set-aside', task: check }, { plan, now: 'x', dayKey: DAY });
    expect(view(plan, state).recommended.passageId).toBe('two');
    expect(state.resume).toBeNull();
    expect(projectCoach({ plan, state, dayKey: '2026-11-19' }).recommended.passageId).toBe('one');
  });
  it('falls back to the earliest set-aside passage when all remaining are set aside', () => {
    const plan = planOf(); let state;
    for (const id of ['one', 'two', 'solo']) state = applyCoachEvent(state, { id, type: 'set-aside', task: task(plan, 'silver', id) }, { plan, now: 'x', dayKey: DAY });
    expect(view(plan, state).recommended.passageId).toBe('one');
  });
  it('recommended is null only when every passage has Silver', () => {
    const plan = planOf(); let state;
    for (const id of ['one', 'two']) state = play(state, plan, task(plan, 'silver', id));
    expect(view(plan, state).recommended.passageId).toBe('solo');
    state = play(state, plan, task(plan, 'silver', 'solo'));
    const done = view(plan, state);
    expect(done.recommended).toBeNull();
    expect(done.piece).toMatchObject({ total: 3, silver: 3, gold: 0, nextPassageId: null, nextGoldPassageId: 'one' });
  });
  it('canSetAside is true after two straight misses of any Silver-track task or drill', () => {
    const plan = planOf(); const right = task(plan, 'right');
    let state = play(undefined, plan, right, bad);
    expect(view(plan, state).canSetAside.one).toBe(false);
    state = play(state, plan, right, bad);
    expect(view(plan, state).canSetAside.one).toBe(true);
    state = play(state, plan, view(plan, state).recommended, good);
    expect(view(plan, state).canSetAside.one).toBe(false);
  });
  it('coachSummary ignores set-aside for nextPassageId and reports it separately', () => {
    const plan = planOf(); let state = play(undefined, plan, task(plan, 'silver'));
    state = applyCoachEvent(state, { id: 'a', type: 'set-aside', task: task(plan, 'silver', 'two') }, { plan, now: 'x', dayKey: DAY });
    expect(coachSummary(view(plan, state), { now: 'NOW', state })).toMatchObject({
      total: 3, silver: 1, gold: 0, nextPassageId: 'two', setAside: { two: DAY }, updatedAt: 'NOW',
      passages: [{ id: 'one', start: 0, end: 3, silver: `${DAY}T12:00:00Z`, gold: null }, { id: 'two', silver: null }, { id: 'solo', silver: null }],
    });
  });
});
