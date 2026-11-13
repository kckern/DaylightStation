import { describe, it, expect } from 'vitest';
import {
  GOOD_FAITH_DEFAULTS, bankSittings, goodFaithScore, rawScore,
  drillForScore, creditDecision, PRESCHOOL_POLICY, policyFor,
} from './goodFaith.mjs';

const ROOTS = { roots: ['C', 'G', 'F'], rotation: 0 };

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
  it('rawScore is unfloored and capped', () => {
    expect(rawScore({ practiceNotes: 70, playedSec: 600, targetNpm: 13 })).toBeCloseTo(5.385, 2);
    expect(rawScore({ practiceNotes: 9999, playedSec: 60, targetNpm: 13 })).toBe(10);
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

describe('creditDecision — the session-level good-faith judgement decides', () => {
  const base = { percent: 95, thresholdPercent: 90, enforced: true, engaged: true, legacy: false, drillsPassed: 0, ...ROOTS };
  const judged = (goodFaith, extra = {}) => ({ a: { practiceNotes: 40, checkInsAnswered: 0, goodFaith, ...extra } });
  const unjudged = (practiceNotes, checkInsAnswered = 0) => ({ a: { practiceNotes, checkInsAnswered } });
  it('not-watched below the threshold', () => {
    expect(creditDecision({ ...base, percent: 50, sittings: judged(9) }).outcome).toBe('not-watched');
  });
  it('unenforced and legacy credit iff engaged', () => {
    expect(creditDecision({ ...base, enforced: false, sittings: {} })).toMatchObject({ outcome: 'unenforced', credited: true });
    expect(creditDecision({ ...base, enforced: false, sittings: {}, engaged: false })).toMatchObject({ outcome: 'unenforced', credited: false });
    expect(creditDecision({ ...base, legacy: true, sittings: {} })).toMatchObject({ outcome: 'legacy', credited: true });
    expect(creditDecision({ ...base, legacy: true, sittings: {}, engaged: false })).toMatchObject({ outcome: 'legacy', credited: false });
  });
  it('a judged score at or above the pass score credits', () => {
    expect(creditDecision({ ...base, sittings: judged(7.4) })).toMatchObject({ outcome: 'credited', credited: true, score: 7.4, source: 'model', drill: null });
    expect(creditDecision({ ...base, sittings: judged(6) })).toMatchObject({ outcome: 'credited' });
  });
  it('below the pass score owes the drill sized from the floored score; the reps credit it', () => {
    const d = creditDecision({ ...base, sittings: judged(3.6) });
    expect(d).toMatchObject({ outcome: 'drill-owed', credited: false, score: 3.6, source: 'model' });
    expect(d.drill.reps).toBe(4);
    expect(creditDecision({ ...base, sittings: judged(5.9) }).drill.reps).toBe(2);
    expect(creditDecision({ ...base, drillsPassed: 4, sittings: judged(3.6) })).toMatchObject({ outcome: 'credited-after-drills', credited: true });
  });
  it('the best judged sitting of the lesson stands', () => {
    const sittings = { a: { goodFaith: 2 }, b: { goodFaith: 8 }, c: { practiceNotes: 0 } };
    expect(creditDecision({ ...base, sittings })).toMatchObject({ outcome: 'credited', score: 8 });
  });
  it('no judgement: the lenient rule — meaningful playing or an answered check-in credits', () => {
    expect(creditDecision({ ...base, sittings: unjudged(6) })).toMatchObject({ outcome: 'credited', source: 'fallback', score: null });
    expect(creditDecision({ ...base, sittings: unjudged(0, 1) })).toMatchObject({ outcome: 'credited', source: 'fallback' });
    const d = creditDecision({ ...base, sittings: unjudged(2) });
    expect(d).toMatchObject({ outcome: 'drill-owed', source: 'fallback', score: 0 });
    expect(d.drill.reps).toBe(6);
  });
  it('banks the lenient rule across sittings', () => {
    expect(creditDecision({ ...base, sittings: { a: { practiceNotes: 3 }, b: { practiceNotes: 3 } } }).outcome).toBe('credited');
  });
  it('defaults are exported', () => {
    expect(GOOD_FAITH_DEFAULTS).toMatchObject({ passScore: 6, maxSittings: 12, repsPerSet: 2 });
  });
});

describe('preschool policy', () => {
  const P = PRESCHOOL_POLICY;
  it('passes at 3', () => {
    expect(P.passScore).toBe(3);
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
    const base = { percent: 95, thresholdPercent: 90, enforced: true, engaged: true, legacy: false, drillsPassed: 0, ...ROOTS };
    expect(creditDecision({ ...base, sittings: { a: { goodFaith: 3.2 } } }, P)).toMatchObject({ outcome: 'credited', score: 3.2 });
    const d = creditDecision({ ...base, sittings: { a: { goodFaith: 1.5 } } }, P);
    expect(d).toMatchObject({ outcome: 'drill-owed', score: 1.5 });
    expect(d.drill.spec.kind).toBe('gentle');
    expect(d.drill.reps).toBe(1);
    expect(creditDecision({ ...base, drillsPassed: 1, sittings: { a: { goodFaith: 1.5 } } }, P).outcome).toBe('credited-after-drills');
  });
  it('policyFor picks preschool for a listed course', () => {
    expect(policyFor({ courseId: '42', preschoolCourses: ['42'] })).toBe(PRESCHOOL_POLICY);
    expect(policyFor({ courseId: '7', preschoolCourses: ['42'] })).toBe(GOOD_FAITH_DEFAULTS);
    expect(policyFor({ courseId: 'plex:42', preschoolCourses: [42] })).toBe(PRESCHOOL_POLICY);
    expect(policyFor({ courseId: '42', preschoolCourses: ['42'], preschoolPassScore: 2 }).passScore).toBe(2);
    expect(policyFor({ courseId: '7', preschoolCourses: ['42'], passScore: 5 }).passScore).toBe(5);
  });
});
