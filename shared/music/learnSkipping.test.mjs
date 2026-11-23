import { describe, expect, it } from 'vitest';
import { applyCoachEvent, createCoachPlan, projectCoach } from './learnCoach.mjs';
import { currentStep, normalizeSkipping, passageAccess, resolveSkipMode, stepAccess } from './learnSkipping.mjs';

const DAY = '2026-11-19';
const SCORE = 'files:docs/sheet-music/carol.mxl';
const plan = createCoachPlan({ scoreId: SCORE, fingerprint: 'c', segments: [{ id: 'one', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 }, spans: {} };
const step = (skill) => plan.tasks.find((task) => task.skill === skill);
let ids = 0;
const take = (state, skill) => applyCoachEvent(state, { id: `take-${ids += 1}`, type: 'outcome', task: step(skill), result: good }, { plan, now: '2026-11-19T18:00:00.000Z', dayKey: DAY });
const passage = (state) => projectCoach({ plan, state, dayKey: DAY }).segments[0];
const readySkills = (segment) => segment.skills.filter((skill) => skill.ready).map((skill) => skill.skill);

describe('skip mode resolution', () => {
  const skipping = { default: 'strict', learners: { 'learner-a': 'open', 'learner-b': 'sideways' }, pieces: { [SCORE]: 'open-to-silver', 'files:b.mxl': 'nope' } };
  it('defaults to open-to-silver with no config', () => {
    expect(resolveSkipMode({})).toBe('open-to-silver');
    expect(normalizeSkipping(null)).toEqual({ default: 'open-to-silver', learners: {}, pieces: {} });
  });
  it('takes the piece, then the learner, then the household default', () => {
    expect(resolveSkipMode({ skipping, userId: 'learner-a', scoreId: SCORE })).toBe('open-to-silver');
    expect(resolveSkipMode({ skipping, userId: 'learner-a', scoreId: 'files:other.mxl' })).toBe('open');
    expect(resolveSkipMode({ skipping, userId: 'learner-c', scoreId: 'files:other.mxl' })).toBe('strict');
  });
  it('drops unknown values to the next level and an unknown default to open-to-silver', () => {
    expect(resolveSkipMode({ skipping, userId: 'learner-b', scoreId: 'files:other.mxl' })).toBe('strict');
    expect(resolveSkipMode({ skipping, userId: 'learner-a', scoreId: 'files:b.mxl' })).toBe('open');
    expect(resolveSkipMode({ skipping: { default: 'wide-open' }, userId: 'learner-c' })).toBe('open-to-silver');
  });
  it('keeps an authored ladder strict unless the piece says otherwise', () => {
    expect(resolveSkipMode({ skipping, userId: 'learner-a', scoreId: 'files:other.mxl', authored: true })).toBe('strict');
    expect(resolveSkipMode({ skipping: { default: 'open' }, authored: true })).toBe('strict');
    expect(resolveSkipMode({ skipping, userId: 'learner-c', scoreId: SCORE, authored: true })).toBe('open-to-silver');
  });
});

describe('which steps may be started', () => {
  const access = (state, mode) => {
    const segment = passage(state);
    const map = passageAccess(segment, mode);
    return Object.fromEntries(segment.skills.map((skill) => [skill.skill, map[skill.key]]));
  };
  it('strict opens only the current step', () => {
    expect(currentStep(passage(null)).skill).toBe('right');
    expect(access(null, 'strict')).toEqual({ right: 'open', left: 'locked', together: 'locked', silver: 'locked',
      pulse: 'locked', 'timed-50-rh': 'locked', 'timed-50-lh': 'locked', 'timed-50': 'locked', 'timed-60': 'locked', 'timed-75': 'locked', mastery: 'locked' });
  });
  it('open-to-silver opens every note step and the check, and Gold after Silver', () => {
    expect(access(null, 'open-to-silver')).toEqual({ right: 'open', left: 'open', together: 'open', silver: 'open',
      pulse: 'locked', 'timed-50-rh': 'locked', 'timed-50-lh': 'locked', 'timed-50': 'locked', 'timed-60': 'locked', 'timed-75': 'locked', mastery: 'locked' });
    const silver = take(null, 'silver');
    expect(Object.values(access(silver, 'open-to-silver')).every((value) => value === 'open')).toBe(true);
  });
  it('open opens everything from the start', () => {
    expect(Object.values(access(null, 'open')).every((value) => value === 'open')).toBe(true);
  });
  it('keeps a ready step open in every mode, and the current Gold step after Silver in strict', () => {
    const state = take(null, 'right');
    expect(access(state, 'strict')).toMatchObject({ right: 'open', left: 'open', together: 'locked' });
    const segment = passage(take(null, 'silver'));
    expect(stepAccess(segment, segment.skills.find((skill) => skill.skill === 'pulse'), 'strict')).toBe('open');
    expect(stepAccess(segment, segment.skills.find((skill) => skill.skill === 'mastery'), 'strict')).toBe('locked');
  });
});

describe('higher passes cover lower steps', () => {
  it('together covers each hand, without Silver', () => {
    const segment = passage(take(null, 'together'));
    expect(readySkills(segment)).toEqual(['right', 'left', 'together']);
    expect(segment.certification).toEqual({ silver: null, gold: null });
  });
  it('the Silver check covers every note step, and certifies Silver only', () => {
    const segment = passage(take(null, 'silver'));
    expect(readySkills(segment)).toEqual(['right', 'left', 'together', 'silver']);
    expect(segment.certification.silver).toMatchObject({ provenance: 'check' });
    expect(segment.certification.gold).toBeNull();
  });
  it('75% covers 50%, 60% and the beat, without Silver or Gold', () => {
    const segment = passage(take(take(null, 'timed-75'), 'timed-75'));
    expect(readySkills(segment)).toEqual(expect.arrayContaining(['pulse', 'timed-50', 'timed-60', 'timed-75']));
    expect(readySkills(segment)).not.toContain('mastery');
    expect(segment.certification).toEqual({ silver: null, gold: null });
  });
  it('mastery covers every Gold step and is the one way to Gold', () => {
    const segment = passage(take(take(null, 'mastery'), 'mastery'));
    expect(segment.skills.filter((skill) => skill.track === 'gold').every((skill) => skill.ready)).toBe(true);
    expect(segment.certification.gold).toMatchObject({ provenance: 'demonstrated' });
  });
  it('one hand alone covers nothing above it', () => {
    expect(readySkills(passage(take(null, 'right')))).toEqual(['right']);
  });
});
