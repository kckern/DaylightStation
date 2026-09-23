import { describe, expect, it } from 'vitest';
import { GAPS, applyGraded, applySort, emptyWordV3, introduce, isDue, isUnsettled } from './mastery.mjs';

const S = { afterMisses: 2, gapScale: 1 };
const D = '2026-09-22';
const graded = (w, source, correct, day = D, task = '3.3') => applyGraded(w, { source, correct, day, task, settings: S });
const mastered = (stage, dueDay) => ({ ...emptyWordV3(), state: 'mastered', stage, dueDay, introducedDay: '2026-09-01' });

describe('mastery', () => {
  it('introduce marks the day and leaves state introduced', () => {
    expect(introduce(emptyWordV3(), D)).toMatchObject({ state: 'introduced', introducedDay: D });
  });
  it('sorting moves a non-mastered word to the pile', () => {
    const w = introduce(emptyWordV3(), D);
    expect(applySort(w, 'notYet', D).state).toBe('notYet');
    expect(applySort(w, 'claimed', D).state).toBe('claimed');
  });
  it('rule 2: sorting can lower a mastered word but Got it changes nothing', () => {
    const m = mastered(2, '2026-09-30');
    expect(applySort(m, 'claimed', D)).toEqual(m);
    expect(applySort(m, 'familiar', D)).toMatchObject({ state: 'familiar', stage: null, dueDay: null });
  });
  it('a graded word with no introduced day (reset mid-round) gets the graded day, so a miss can be carried', () => {
    for (const [source, correct] of [['verify', true], ['verify', false], ['recheck', true], ['recheck', false]]) {
      expect(graded({ ...emptyWordV3(), state: 'mastered', stage: 0 }, source, correct).introducedDay).toBe(D);
    }
    expect(graded(mastered(1, D), 'recheck', false).introducedDay).toBe('2026-09-01');
  });
  it('verify pass → mastered s0 due next day, streak and flags cleared', () => {
    const w = { ...applySort(introduce(emptyWordV3(), D), 'claimed', D), missStreak: 1, tricky: true, notYetCarry: true };
    expect(graded(w, 'verify', true)).toMatchObject({
      state: 'mastered', stage: 0, dueDay: '2026-09-23', missStreak: 0, tricky: false, notYetCarry: false,
    });
  });
  it('verify fail → familiar, streak +1, verifyFailedDay; tricky at afterMisses', () => {
    const once = graded(applySort(introduce(emptyWordV3(), D), 'claimed', D), 'verify', false);
    expect(once).toMatchObject({ state: 'familiar', missStreak: 1, verifyFailedDay: D, tricky: false });
    const twice = graded(once, 'verify', false, '2026-09-23');
    expect(twice).toMatchObject({ missStreak: 2, tricky: true, trickySince: '2026-09-23' });
  });
  it('recheck pass: stage s → s+1, due by GAPS[s+1] × gapScale', () => {
    expect(graded(mastered(0, D), 'recheck', true)).toMatchObject({ stage: 1, dueDay: '2026-09-25', rechecks: 1 });
    expect(graded(mastered(4, D), 'recheck', true)).toMatchObject({ stage: 5, dueDay: '2026-11-21' });
    expect(graded(mastered(5, D), 'recheck', true)).toMatchObject({ stage: 6, dueDay: '2026-11-21' });
    expect(GAPS).toEqual([1, 3, 7, 14, 30, 60]);
  });
  it('recheck fail → familiar, stage cleared, lostMasteredDay set', () => {
    expect(graded(mastered(3, D), 'recheck', false)).toMatchObject({
      state: 'familiar', stage: null, dueDay: null, missStreak: 1, lostMasteredDay: D,
    });
  });
  it('rule 3: paper miss on new/introduced/notYet is logged only; on claimed demotes', () => {
    const nY = applySort(introduce(emptyWordV3(), D), 'notYet', D);
    expect(graded(nY, 'paper', false).state).toBe('notYet');
    expect(graded(emptyWordV3(), 'paper', false).state).toBe('new');
    const c = applySort(introduce(emptyWordV3(), D), 'claimed', D);
    expect(graded(c, 'paper', false)).toMatchObject({ state: 'familiar', missStreak: 1 });
  });
  it('paper pass changes nothing, not even tricky', () => {
    const w = { ...mastered(1, D), tricky: true };
    expect(graded(w, 'paper', true)).toMatchObject({ state: 'mastered', stage: 1, tricky: true });
  });
  it('isDue and isUnsettled', () => {
    expect(isDue(mastered(1, D), D)).toBe(true);
    expect(isDue(mastered(1, '2026-09-23'), D)).toBe(false);
    expect(isUnsettled(mastered(0, D))).toBe(true);
    expect(isUnsettled(mastered(1, D))).toBe(false);
    expect(isUnsettled(emptyWordV3())).toBe(false);
    expect(isUnsettled(introduce(emptyWordV3(), D))).toBe(true);
  });
});
