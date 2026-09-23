import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { ESTIMATE_MS, newAllowance, planNextRound } from './rounds.mjs';

const D = '2026-09-22';
const SET = { round: { size: 5 }, batch: { newPerDay: 4, workingSet: 7 } };
const w = (state, introducedDay = '2026-09-20', extra = {}) => ({ ...emptyWordV3(), state, introducedDay, ...extra });
const MIN = 60000;
const plan = (words, pool, remainingMs, roundedToday = new Set()) =>
  planNextRound({ words, pool, day: D, roundedToday, settings: SET, remainingMs, roundNumber: 1 });

describe('rounds', () => {
  it('allowance respects newPerDay and the working set', () => {
    const words = { a: w('familiar'), b: w('familiar'), c: w('mastered', '2026-09-10', { stage: 0 }) };
    expect(newAllowance({ words, day: D, settings: SET })).toBe(4);
    const crowded = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`x${i}`, w('familiar')]));
    expect(newAllowance({ words: crowded, day: D, settings: SET })).toBe(1);
  });
  it('carry round first when ≥ 2 carry words', () => {
    const r = plan({ a: w('claimed'), b: w('notYet'), c: w('familiar') }, ['n1', 'n2'], 15 * MIN);
    expect(r).toMatchObject({ kind: 'carry', words: ['b', 'c', 'a'], newWords: [] });
  });
  it('a single carry word is held back into the new round', () => {
    const r = plan({ a: w('familiar') }, ['n1', 'n2', 'n3', 'n4', 'n5'], 15 * MIN);
    expect(r.kind).toBe('new');
    expect(r.newWords).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(r.words).toEqual(['n1', 'n2', 'n3', 'n4', 'a']);
  });
  it('shrinks to fit the time left', () => {
    const r = plan({}, ['n1', 'n2', 'n3', 'n4'], 6.5 * MIN);
    expect(r.newWords).toEqual(['n1', 'n2']);
    expect(plan({}, ['n1', 'n2'], 3.5 * MIN)).toBeNull();
  });
  it('skips words already rounded today or failed today', () => {
    const words = { a: w('familiar'), b: w('familiar', '2026-09-20', { verifyFailedDay: D }), c: w('notYet') };
    expect(plan(words, [], 15 * MIN, new Set(['c']))).toMatchObject({ kind: 'carry', words: ['a'] });
  });
  it('estimates match the spec', () => {
    expect(ESTIMATE_MS).toEqual({ recheckChoice: 15000, recheckTyped: 30000, newWord: 138000, carryWord: 61000 });
  });
});
