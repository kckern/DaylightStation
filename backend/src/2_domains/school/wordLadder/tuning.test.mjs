import { describe, expect, it } from 'vitest';
import {
  TUNABLE, TUNING_BOUNDS, GROWN_UP_SETTINGS, tunableValues, buildTuningDigest, applyTuningProposal,
} from './tuning.mjs';
import { DEFAULT_SETTINGS } from './settings.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { emptyWordV3 } from './mastery.mjs';

const current = tunableValues(DEFAULT_SETTINGS);

describe('TUNABLE', () => {
  it('names exactly the six spec §7 tunables with their steps and bounds', () => {
    expect(TUNABLE).toEqual({
      'round.size': { step: 1 }, 'drill.afterMisses': { step: 1 }, 'batch.newPerDay': { step: 1 },
      'batch.workingSet': { step: 1 }, 'review.gapScale': { step: 0.1 }, 'review.typedEvery': { step: 1 },
    });
    expect(TUNING_BOUNDS).toEqual({
      'round.size': [3, 7], 'drill.afterMisses': [1, 3], 'batch.newPerDay': [2, 6],
      'batch.workingSet': [4, 10], 'review.gapScale': [0.5, 1.5], 'review.typedEvery': [1, 4],
    });
    expect(GROWN_UP_SETTINGS).toEqual(['session.capMinutes', 'drill.perSitting', 'round.maxPasses', 'typing.passScore']);
    expect(current).toEqual({
      'round.size': 5, 'drill.afterMisses': 2, 'batch.newPerDay': 4, 'batch.workingSet': 7, 'review.gapScale': 1, 'review.typedEvery': 2,
    });
  });
});

describe('applyTuningProposal brakes', () => {
  const studyDays = ['2026-09-10', '2026-09-12', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const base = { current, bounds: TUNING_BOUNDS, day: '2026-09-20', lastChanged: {}, studyDays };

  it('requires the study-day list', () => {
    const { studyDays: _omit, ...noDays } = base;
    expect(() => applyTuningProposal({ ...noDays, proposal: [] })).toThrow(/studyDays is required/);
  });

  it('applies a single one-step change and records it', () => {
    const out = applyTuningProposal({ ...base, proposal: [{ setting: 'batch.newPerDay', to: 3, reason: 'cap hit most days' }] });
    expect(out.applied).toEqual([{ setting: 'batch.newPerDay', from: 4, to: 3, reason: 'cap hit most days' }]);
    expect(out.dropped).toEqual([]);
    expect(out.next['batch.newPerDay']).toBe(3);
    expect(out.lastChanged).toEqual({ 'batch.newPerDay': '2026-09-20' });
  });

  it('drops a +2 step (step)', () => {
    const out = applyTuningProposal({ ...base, proposal: [{ setting: 'round.size', to: 7, reason: 'r' }] });
    expect(out.applied).toEqual([]);
    expect(out.dropped).toEqual([{ setting: 'round.size', to: 7, reason: 'r', brake: 'step' }]);
    expect(out.next).toEqual(current);
  });

  it('drops a change 3 study days after the last one (dwell) and allows it at 5', () => {
    const early = applyTuningProposal({ ...base, lastChanged: { 'round.size': '2026-09-17' }, proposal: [{ setting: 'round.size', to: 4, reason: 'r' }] });
    expect(early.dropped[0].brake).toBe('dwell');
    expect(early.next['round.size']).toBe(5);
    const later = applyTuningProposal({ ...base, lastChanged: { 'round.size': '2026-09-15' }, proposal: [{ setting: 'round.size', to: 4, reason: 'r' }] });
    expect(later.applied).toHaveLength(1);
  });

  it('counts study days, not calendar days', () => {
    const out = applyTuningProposal({
      ...base, lastChanged: { 'round.size': '2026-09-10' }, studyDays: ['2026-09-12', '2026-09-18', '2026-09-20'],
      proposal: [{ setting: 'round.size', to: 4, reason: 'r' }],
    });
    expect(out.dropped[0].brake).toBe('dwell');
  });

  it('clamps out-of-bounds: a clamp that lands one step away applies, one that does not move drops (bounds)', () => {
    const near = applyTuningProposal({ ...base, current: { ...current, 'round.size': 6 }, proposal: [{ setting: 'round.size', to: 9, reason: 'r' }] });
    expect(near.applied).toEqual([{ setting: 'round.size', from: 6, to: 7, reason: 'r', clampedFrom: 9 }]);
    const atEdge = applyTuningProposal({ ...base, current: { ...current, 'round.size': 7 }, proposal: [{ setting: 'round.size', to: 8, reason: 'r' }] });
    expect(atEdge.dropped).toEqual([{ setting: 'round.size', to: 8, reason: 'r', brake: 'bounds' }]);
    const far = applyTuningProposal({ ...base, proposal: [{ setting: 'batch.newPerDay', to: 0, reason: 'r' }] });
    expect(far.dropped[0].brake).toBe('step');
  });

  it('honours grown-up bounds narrower than the spec', () => {
    const out = applyTuningProposal({ ...base, bounds: { 'round.size': [3, 5] }, proposal: [{ setting: 'round.size', to: 6, reason: 'r' }] });
    expect(out.dropped[0].brake).toBe('bounds');
  });

  it('steps gapScale by 0.1 without float drift', () => {
    const out = applyTuningProposal({ ...base, current: { ...current, 'review.gapScale': 0.7 }, proposal: [{ setting: 'review.gapScale', to: 0.6, reason: 'r' }] });
    expect(out.next['review.gapScale']).toBe(0.6);
    const big = applyTuningProposal({ ...base, proposal: [{ setting: 'review.gapScale', to: 0.8, reason: 'r' }] });
    expect(big.dropped[0].brake).toBe('step');
  });

  it('rejects grown-up settings (not-tunable) and unknown settings (unknown)', () => {
    const out = applyTuningProposal({ ...base, proposal: [
      { setting: 'session.capMinutes', to: 20, reason: 'r' },
      { setting: 'volume.level', to: 3, reason: 'r' },
    ] });
    expect(out.dropped.map((d) => d.brake)).toEqual(['not-tunable', 'unknown']);
    expect(out.applied).toEqual([]);
  });

  it('allows one change per setting per run and ignores a no-op', () => {
    const out = applyTuningProposal({ ...base, proposal: { changes: [
      { setting: 'round.size', to: 4, reason: 'a' },
      { setting: 'round.size', to: 3, reason: 'b' },
      { setting: 'batch.workingSet', to: 7, reason: 'c' },
    ] } });
    expect(out.applied.map((a) => a.setting)).toEqual(['round.size']);
    expect(out.dropped.map((d) => [d.setting, d.brake])).toEqual([['round.size', 'dwell'], ['batch.workingSet', 'step']]);
  });
});

// A fixture day: two rounds, one recheck miss, a typed fallback, the cap hit
// with a goal-closed sitting.
function fixtureDay(day, overrides = {}) {
  return {
    ...emptyDay(day),
    atOpen: { dueRechecks: ['w9'], tricky: [], newAllowance: 2, settings: structuredClone(DEFAULT_SETTINGS) },
    rechecks: { order: ['w9'], answered: { w9: { task: '2.2', correct: false } } },
    rounds: [
      {
        id: 'r1', words: ['w1', 'w2', 'w3'], newWords: ['w1', 'w2'], phase: 'done',
        stream: { latest: { w1: 'familiar', w2: 'claimed', w3: 'claimed' }, notYetCount: {} },
        quiz: { queue: [], index: 0, passed: ['w2', 'w3'], failed: ['w1'] },
      },
      {
        id: 'r2', words: ['w4', 'w5'], newWords: [], phase: 'done',
        stream: { latest: { w4: 'familiar', w5: 'notYet' }, notYetCount: { w5: 2 } },
        quiz: { queue: [], index: 0, passed: ['w4'], failed: [] },
      },
    ],
    activeMs: 15 * 60000 + 1200,
    items: {
      'rc:w9': { at: 'a', response: { dontKnow: true }, result: { correct: false } },
      'r1:i:w1:flash': { at: 'a', response: { seen: true }, result: { ok: true } },
      'r1:i:w2:flash': { at: 'a', response: { seen: true }, result: { ok: true } },
      'r1:q:0': { at: 'a', response: { typed: 'x' }, result: { correct: false, score: 3, judge: 'distance' } },
      'r1:q:1': { at: 'a', response: { typed: 'y' }, result: { correct: true, score: 7, judge: 'fallback' } },
      'r1:q:2': { at: 'a', response: { dontKnow: true }, result: { correct: false } },
    },
    sittings: { s1: { reason: 'goal' } },
    doneAt: `${day}T16:20:00-07:00`,
    drills: [{ id: 'd1', source: 'tricky', wordId: 'w7', done: true }],
    ...overrides,
  };
}

function fixtureStatus(n = 12) {
  const status = emptyStatusV3();
  const states = ['new', 'introduced', 'notYet', 'familiar', 'claimed', 'mastered'];
  for (let i = 0; i < n; i += 1) {
    status.words[`w${i}`] = { ...emptyWordV3(), state: states[i % states.length], tricky: i === 7 };
  }
  return status;
}

describe('buildTuningDigest', () => {
  it('summarises the day just ended from the real day-file fields', () => {
    const digest = buildTuningDigest({
      status: fixtureStatus(), days: [fixtureDay('2026-09-20')], settings: DEFAULT_SETTINGS, lastChanged: { 'round.size': '2026-09-10' },
    });
    expect(digest.day).toBe('2026-09-20');
    expect(digest.settings).toEqual(current);
    expect(digest.lastChanged).toEqual({ 'round.size': '2026-09-10' });
    expect(digest.words).toEqual({
      total: 12, byState: { new: 2, introduced: 2, notYet: 2, familiar: 2, claimed: 2, mastered: 2 }, tricky: 1, excluded: 0,
    });
    expect(digest.today).toEqual({
      quizzed: 4, passed: 3,
      passedByPile: { familiar: 1, claimed: 2, other: 0 },
      failedByPile: { familiar: 1, claimed: 0, other: 0 },
      rechecks: { asked: 1, missed: 1 },
      dontKnow: 2, typedScores: [3, 7], judgeFallbacks: 1, stalls: null,
      activeMin: 15, capHit: true, credited: true, newIntroduced: 2, drillsRun: 1, reachedGoal: true,
    });
    expect(digest.trailing7).toEqual({ days: 0 });
  });

  it('a cap-credited day without a goal sitting did not reach its goal', () => {
    const d = fixtureDay('2026-09-20', { sittings: { s1: { reason: 'cap' } } });
    const digest = buildTuningDigest({ status: fixtureStatus(), days: [d], settings: DEFAULT_SETTINGS, lastChanged: {} });
    expect(digest.today.capHit).toBe(true);
    expect(digest.today.reachedGoal).toBe(false);
  });

  it('a day done under the cap reached its goal; an open day did not', () => {
    const done = fixtureDay('2026-09-20', { activeMs: 9 * 60000, sittings: { s1: { reason: 'leave' } } });
    expect(buildTuningDigest({ status: fixtureStatus(), days: [done], settings: DEFAULT_SETTINGS, lastChanged: {} }).today)
      .toMatchObject({ capHit: false, reachedGoal: true, activeMin: 9 });
    const open = fixtureDay('2026-09-20', { activeMs: 9 * 60000, doneAt: null, sittings: { s1: { reason: 'idle' } } });
    expect(buildTuningDigest({ status: fixtureStatus(), days: [open], settings: DEFAULT_SETTINGS, lastChanged: {} }).today)
      .toMatchObject({ credited: false, reachedGoal: false });
  });

  it('uses the cap captured at open over the current settings', () => {
    const d = fixtureDay('2026-09-20', { activeMs: 12 * 60000 });
    d.atOpen.settings.session.capMinutes = 10;
    expect(buildTuningDigest({ status: fixtureStatus(), days: [d], settings: DEFAULT_SETTINGS, lastChanged: {} }).today.capHit).toBe(true);
  });

  it('averages the trailing 7 study days before today and counts zero-quizzed credited days', () => {
    const days = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']
      .map((day) => fixtureDay(day));
    days[1] = fixtureDay('2026-09-11', { rounds: [], items: {}, drills: [] });
    const digest = buildTuningDigest({ status: fixtureStatus(), days, settings: DEFAULT_SETTINGS, lastChanged: {} });
    expect(digest.day).toBe('2026-09-17');
    expect(digest.trailing7.days).toBe(7);
    expect(digest.trailing7.creditedZeroQuizzed).toBe(1);
    // 6 fixture days of 4 quizzed + 1 day of 0 → 24/7
    expect(digest.trailing7.quizzed).toBeCloseTo(3.43, 2);
    expect(digest.trailing7.capHit).toBe(1);
    expect(digest.trailing7.typedScoreMean).toBe(5);
    expect(digest.trailing7.stalls).toBeNull();
    expect(digest.trailing7.passedByPile).toEqual({ familiar: 0.86, claimed: 1.71, other: 0 });
  });

  it('is deterministic and compact for a 50-word package', () => {
    const days = Array.from({ length: 8 }, (_, i) => fixtureDay(`2026-09-${String(10 + i).padStart(2, '0')}`));
    const input = { status: fixtureStatus(50), days, settings: DEFAULT_SETTINGS, lastChanged: {} };
    const a = buildTuningDigest(input);
    expect(buildTuningDigest(structuredClone(input))).toEqual(a);
    expect(JSON.stringify(a).length).toBeLessThan(8000);
  });
});
