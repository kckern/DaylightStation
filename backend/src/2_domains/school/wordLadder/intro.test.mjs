import { describe, expect, it } from 'vitest';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { emptyWordV3 } from './mastery.mjs';
import { deckProgress, introPlanLabel, introPreview } from './intro.mjs';
import { DEFAULT_SETTINGS } from './settings.mjs';

const DAY = '2026-09-23';
const settings = structuredClone(DEFAULT_SETTINGS);
const word = (over) => ({ ...emptyWordV3(), ...over });

function statusWith(words) {
  const status = emptyStatusV3();
  status.words = words;
  return status;
}

describe('introPreview — today, read before any sitting opens', () => {
  it('a fresh learner: new words up to the daily allowance, nothing to review', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
    const plan = introPreview({ status: emptyStatusV3(), dayFile: emptyDay(DAY), day: DAY, pool, settings });
    expect(plan).toMatchObject({ newCount: 4, reviewCount: 0, doneToday: false, opened: false });
    // 4 × 138s = 9.2 min → about 10, never more than the cap.
    expect(plan.estimatedMinutes).toBe(10);
  });

  it('counts due rechecks and yesterday\'s unsettled words as review', () => {
    const status = statusWith({
      due: word({ state: 'mastered', stage: 1, dueDay: DAY, introducedDay: '2026-09-01' }),
      later: word({ state: 'mastered', stage: 1, dueDay: '2026-10-01', introducedDay: '2026-09-01' }),
      carry: word({ state: 'familiar', introducedDay: '2026-09-22' }),
      gone: word({ state: 'familiar', introducedDay: '2026-09-22', excluded: true }),
    });
    const plan = introPreview({ status, dayFile: emptyDay(DAY), day: DAY, pool: ['n1', 'n2'], settings });
    expect(plan.reviewCount).toBe(2);
    expect(plan.newCount).toBe(2);
  });

  it('an opened day counts only the rechecks still pending', () => {
    const status = statusWith({ x: word({ state: 'mastered', stage: 1, dueDay: DAY }), y: word({ state: 'mastered', stage: 1, dueDay: DAY }) });
    const dayFile = { ...emptyDay(DAY), atOpen: { dueRechecks: ['x', 'y'], tricky: [], newAllowance: 0, settings }, rechecks: { order: ['x', 'y'], answered: { x: { correct: true } } }, activeMs: 60000 };
    const plan = introPreview({ status, dayFile, day: DAY, pool: [], settings });
    expect(plan).toMatchObject({ opened: true, reviewCount: 1, newCount: 0, doneToday: false });
  });

  it('a done day plans nothing', () => {
    const dayFile = { ...emptyDay(DAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 4, settings }, doneAt: `${DAY}T16:00:00-07:00` };
    const plan = introPreview({ status: emptyStatusV3(), dayFile, day: DAY, pool: ['a', 'b'], settings });
    expect(plan).toMatchObject({ doneToday: true, newCount: 0, reviewCount: 0, estimatedMinutes: 0 });
  });

  it('the estimate never exceeds the time left under the cap', () => {
    const dayFile = { ...emptyDay(DAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 4, settings }, activeMs: 12 * 60000 };
    const plan = introPreview({ status: emptyStatusV3(), dayFile, day: DAY, pool: ['a', 'b', 'c', 'd'], settings });
    expect(plan.estimatedMinutes).toBe(3);
  });
});

describe('introPlanLabel', () => {
  it('names the day\'s work, singular and plural', () => {
    expect(introPlanLabel({ newCount: 4, reviewCount: 3, estimatedMinutes: 10 })).toBe('4 new words · 3 to review');
    expect(introPlanLabel({ newCount: 1, reviewCount: 0, estimatedMinutes: 3 })).toBe('1 new word');
    expect(introPlanLabel({ newCount: 0, reviewCount: 2, estimatedMinutes: 1 }, { withTime: true })).toBe('2 to review · about 1 minute');
    expect(introPlanLabel({ newCount: 4, reviewCount: 3, estimatedMinutes: 10 }, { withTime: true })).toBe('4 new words · 3 to review · about 10 minutes');
  });
  it('a done day says so; an empty open day says there is nothing new', () => {
    expect(introPlanLabel({ doneToday: true, newCount: 0, reviewCount: 0 })).toBe('Done for today');
    expect(introPlanLabel({ doneToday: true }, { withTime: true })).toBe('Done for today — practice anytime');
    expect(introPlanLabel({ newCount: 0, reviewCount: 0, estimatedMinutes: 0 })).toBe('Nothing new today');
  });
});

describe('deckProgress', () => {
  it('learned = mastered words of this deck; excluded words leave both sides', () => {
    const status = statusWith({
      a: word({ state: 'mastered', stage: 0 }), b: word({ state: 'claimed' }),
      c: word({ state: 'mastered', stage: 2, excluded: true }), z: word({ state: 'mastered', stage: 1 }),
    });
    expect(deckProgress({ status, deckWords: ['a', 'b', 'c', 'd'] })).toEqual({ learned: 1, total: 3 });
  });
});
