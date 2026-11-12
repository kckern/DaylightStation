import { describe, it, expect } from 'vitest';
import {
  GOOD_FAITH_DEFAULTS, checkInStep, checkInDrill, bankSittings, goodFaithScore, rawScore,
  isBorderline, drillForScore, creditDecision, PRESCHOOL_POLICY, policyFor,
} from './goodFaith.mjs';

const ROOTS = { roots: ['C', 'G', 'F'], rotation: 0 };
const exp = (targetNpm) => ({ source: 'ai', targetNpm });
const sit = (practiceNotes, playedSec) => ({ a: { practiceNotes, playedSec } });

describe('goodFaithScore', () => {
  it('target 0 (watch-only) scores 10', () => {
    expect(goodFaithScore({ practiceNotes: 0, playedSec: 600, targetNpm: 0 })).toBe(10);
  });
  it('13 against 13 → 10; 7 against 13 → 5', () => {
    expect(goodFaithScore({ practiceNotes: 130, playedSec: 600, targetNpm: 13 })).toBe(10);
    expect(goodFaithScore({ practiceNotes: 70, playedSec: 600, targetNpm: 13 })).toBe(5);
  });
  it('3 taps in 600 s against 13 → 0', () => {
    expect(goodFaithScore({ practiceNotes: 3, playedSec: 600, targetNpm: 13 })).toBe(0);
  });
  it('playedSec 0 does not throw', () => {
    expect(() => goodFaithScore({ practiceNotes: 5, playedSec: 0, targetNpm: 13 })).not.toThrow();
  });
  it('rawScore is unfloored and capped; isBorderline is [5, 7)', () => {
    expect(rawScore({ practiceNotes: 70, playedSec: 600, targetNpm: 13 })).toBeCloseTo(5.385, 2);
    expect(rawScore({ practiceNotes: 9999, playedSec: 60, targetNpm: 13 })).toBe(10);
    expect(isBorderline(5)).toBe(true);
    expect(isBorderline(6.99)).toBe(true);
    expect(isBorderline(7)).toBe(false);
    expect(isBorderline(4.99)).toBe(false);
  });
});

describe('checkInStep / checkInDrill', () => {
  it('0 → note, 1 → 1 scale, 2 and 5 → 2 scales', () => {
    expect(checkInStep({ consecutiveIdle: 0 })).toEqual({ kind: 'note' });
    expect(checkInStep({ consecutiveIdle: 1 })).toEqual({ kind: 'scales', count: 1 });
    expect(checkInStep({ consecutiveIdle: 2 })).toEqual({ kind: 'scales', count: 2 });
    expect(checkInStep({ consecutiveIdle: 5 })).toEqual({ kind: 'scales', count: 2 });
  });
  it('checkInDrill: count sets of 1 rep, hands R then L', () => {
    const s = checkInDrill(2, ROOTS);
    expect(s).toMatchObject({ kind: 'exercise', collection: 'scales', sets: 2, reps: 1, hands: ['R', 'L'], mode: 'ionian' });
  });
});

describe('bankSittings', () => {
  it('sums sittings', () => {
    expect(bankSittings({ a: { practiceNotes: 10, playedSec: 60 }, b: { practiceNotes: 5, playedSec: 30 } }))
      .toEqual({ practiceNotes: 15, playedSec: 90 });
    expect(bankSittings(null)).toEqual({ practiceNotes: 0, playedSec: 0 });
  });
});

describe('drillForScore', () => {
  it('6 → null; 5 → 2 reps 1 set; 3 → 4 reps 2 sets; 0 → 6 reps 3 sets R/L/RL', () => {
    expect(drillForScore(6, ROOTS)).toBeNull();
    expect(drillForScore(5, ROOTS)).toMatchObject({ reps: 2, sets: 1 });
    expect(drillForScore(3, ROOTS)).toMatchObject({ reps: 4, sets: 2 });
    const d = drillForScore(0, ROOTS);
    expect(d).toMatchObject({ reps: 6, sets: 3 });
    expect(d.spec).toEqual({
      kind: 'exercise', collection: 'scales', roots: ['C', 'G', 'F'], mode: 'ionian',
      direction: 'up-then-down', span_octaves: 1, sets: 3, reps: 2, hands: ['R', 'L', 'RL'],
    });
  });
  it('rotation shifts the roots', () => {
    expect(drillForScore(0, { roots: ['C', 'G', 'F'], rotation: 1 }).roots).toEqual(['G', 'F', 'C']);
  });
});

describe('creditDecision', () => {
  const base = { percent: 95, thresholdPercent: 90, engaged: true, legacy: false, drillsPassed: 0, ...ROOTS, review: null };
  it('not-watched below the threshold', () => {
    expect(creditDecision({ ...base, percent: 50, expectation: exp(13), sittings: sit(999, 600) }).outcome).toBe('not-watched');
  });
  it('unenforced and legacy credit iff engaged', () => {
    expect(creditDecision({ ...base, expectation: null, sittings: {} })).toMatchObject({ outcome: 'unenforced', credited: true });
    expect(creditDecision({ ...base, expectation: null, sittings: {}, engaged: false })).toMatchObject({ outcome: 'unenforced', credited: false });
    expect(creditDecision({ ...base, legacy: true, expectation: exp(13), sittings: {} })).toMatchObject({ outcome: 'legacy', credited: true });
    expect(creditDecision({ ...base, legacy: true, expectation: exp(13), sittings: {}, engaged: false })).toMatchObject({ outcome: 'legacy', credited: false });
  });
  it('score 7 → credited', () => {
    const d = creditDecision({ ...base, expectation: exp(10), sittings: sit(70, 600) });
    expect(d).toMatchObject({ outcome: 'credited', credited: true, score: 7 });
  });
  it('score 3 with no drills → drill-owed, 4 reps; after 4 passes → credited-after-drills', () => {
    const d = creditDecision({ ...base, expectation: exp(10), sittings: sit(30, 600) });
    expect(d).toMatchObject({ outcome: 'drill-owed', credited: false, score: 3 });
    expect(d.drill.reps).toBe(4);
    const d2 = creditDecision({ ...base, drillsPassed: 4, expectation: exp(10), sittings: sit(30, 600) });
    expect(d2).toMatchObject({ outcome: 'credited-after-drills', credited: true });
  });
  it('target 0 credits without drills', () => {
    expect(creditDecision({ ...base, expectation: exp(0), sittings: {} })).toMatchObject({ outcome: 'credited', score: 10 });
  });
  it('borderline review: raw 5.5 + 0.8 → credited reviewed; raw 6.5 + 0.3 → drill 2 reps; raw 5.5 no review → drill', () => {
    const e = exp(10);
    expect(creditDecision({ ...base, expectation: e, sittings: sit(55, 600), review: { probability: 0.8, source: 'model' } }))
      .toMatchObject({ outcome: 'credited', reviewed: true });
    const low = creditDecision({ ...base, expectation: e, sittings: sit(65, 600), review: { probability: 0.3, source: 'model' } });
    expect(low).toMatchObject({ outcome: 'drill-owed', reviewed: true });
    expect(low.drill.reps).toBe(2);
    expect(creditDecision({ ...base, expectation: e, sittings: sit(55, 600) })).toMatchObject({ outcome: 'drill-owed', reviewed: false });
  });
  it('a review never touches a clear case', () => {
    const e = exp(10);
    expect(creditDecision({ ...base, expectation: e, sittings: sit(80, 600), review: { probability: 0.1, source: 'model' } }))
      .toMatchObject({ outcome: 'credited', reviewed: false });
    expect(creditDecision({ ...base, expectation: e, sittings: sit(30, 600), review: { probability: 0.95, source: 'model' } }))
      .toMatchObject({ outcome: 'drill-owed', reviewed: false });
  });
  it('defaults are exported', () => {
    expect(GOOD_FAITH_DEFAULTS).toMatchObject({ passScore: 6, maxSittings: 12, repsPerSet: 2, checkInScaleCap: 2, realPlayingNotes: 8 });
  });
});

describe('preschool policy', () => {
  const P = PRESCHOOL_POLICY;
  it('passes at 3 and never escalates the check-in past a note', () => {
    expect(P.passScore).toBe(3);
    expect(checkInStep({ consecutiveIdle: 1 }, P)).toEqual({ kind: 'note' });
    expect(checkInStep({ consecutiveIdle: 5 }, P)).toEqual({ kind: 'note' });
  });
  it('borderline band sits around its pass score: [2, 4)', () => {
    expect(isBorderline(2, P)).toBe(true);
    expect(isBorderline(3.9, P)).toBe(true);
    expect(isBorderline(4, P)).toBe(false);
    expect(isBorderline(1.9, P)).toBe(false);
  });
  it('drills are gentle rounds, not scales: 3 → none, 1–2 → one round, 0 → two', () => {
    expect(drillForScore(3, ROOTS, P)).toBeNull();
    const one = drillForScore(2, ROOTS, P);
    expect(one).toMatchObject({ reps: 1, sets: 1 });
    expect(one.spec.kind).toBe('gentle');
    expect(one.spec.rounds).toEqual([{ type: 'climb', count: 5, start: 60 }]);
    const two = drillForScore(0, ROOTS, P);
    expect(two.reps).toBe(2);
    expect(two.spec.rounds.map((r) => r.type)).toEqual(['climb', 'echo']);
    expect(two.spec.rounds[1].notes).toHaveLength(3);
  });
  it('creditDecision honours the policy', () => {
    const base = { percent: 95, thresholdPercent: 90, engaged: true, legacy: false, drillsPassed: 0, ...ROOTS, review: null };
    expect(creditDecision({ ...base, expectation: exp(10), sittings: sit(45, 600) }, P)).toMatchObject({ outcome: 'credited', score: 4 });
    const d = creditDecision({ ...base, expectation: exp(10), sittings: sit(15, 600) }, P);
    expect(d).toMatchObject({ outcome: 'drill-owed', score: 1 });
    expect(d.drill.spec.kind).toBe('gentle');
    expect(creditDecision({ ...base, drillsPassed: 1, expectation: exp(10), sittings: sit(15, 600) }, P).outcome).toBe('credited-after-drills');
  });
  it('policyFor picks preschool for a listed course', () => {
    expect(policyFor({ courseId: '42', preschoolCourses: ['42'] })).toBe(PRESCHOOL_POLICY);
    expect(policyFor({ courseId: '7', preschoolCourses: ['42'] })).toBe(GOOD_FAITH_DEFAULTS);
    expect(policyFor({ courseId: 'plex:42', preschoolCourses: [42] })).toBe(PRESCHOOL_POLICY);
    expect(policyFor({ courseId: '42', preschoolCourses: ['42'], preschoolPassScore: 2 }).passScore).toBe(2);
    expect(policyFor({ courseId: '7', preschoolCourses: ['42'], passScore: 5 }).passScore).toBe(5);
  });
});
