// backend/src/2_domains/school/wordLadder/admin.test.mjs
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay } from './statusV3.mjs';
import { markMastered, typedAnswers } from './admin.mjs';

const D = '2026-09-22';

describe('markMastered (grown-up control)', () => {
  it('sets mastered at the stage, due after that stage\'s gap, and clears miss flags', () => {
    const word = { ...emptyWordV3(), state: 'familiar', missStreak: 2, tricky: true, trickySince: '2026-09-20', notYetCarry: true, introducedDay: '2026-09-10' };
    expect(markMastered(word, { stage: 2, day: D })).toMatchObject({
      state: 'mastered', stage: 2, dueDay: '2026-09-29', missStreak: 0, tricky: false, trickySince: null, notYetCarry: false, introducedDay: '2026-09-10',
    });
    expect(markMastered(word, { stage: 9, day: D }).dueDay).toBe('2026-11-21'); // GAPS[5] = 60
    expect(markMastered(word, { stage: 0, day: D }).dueDay).toBe('2026-09-23');
  });
  it('refuses a stage that is not a non-negative integer', () => {
    expect(() => markMastered(emptyWordV3(), { stage: -1, day: D })).toThrow(/stage/);
    expect(() => markMastered(emptyWordV3(), { stage: 1.5, day: D })).toThrow(/stage/);
  });
});

describe('typedAnswers (a day file\'s judged 3.3 answers)', () => {
  it('lists recorded typed answers with their word, including legacy records without meta', () => {
    const day = emptyDay(D);
    day.rechecks = { order: ['pul'], answered: { pul: { task: '3.3', correct: true } } };
    day.rounds = [{ id: 'r1', quiz: { queue: [{ wordId: 'gawi', task: '3.3' }, { wordId: 'gawi', task: '2.2' }], index: 2, passed: ['gawi'], failed: [] } }];
    day.items = {
      'rc:pul': { at: 'a1', response: { typed: '풀' }, result: { correct: true, score: 10, judge: 'exact' } },
      'r1:q:0': { at: 'a2', response: { typed: '가위' }, result: { correct: true, score: 10, judge: 'exact' } },
      'r1:q:1': { at: 'a3', response: { choice: 'Scissors' }, result: { correct: true } },
      'p1:0': { at: 'a4', response: { typed: '책' }, result: { correct: false, score: 4, judge: 'model' }, wordId: 'chaek', task: '3.3', source: 'practice', reason: 'partly', regraded: { at: 'z', actorId: 'parent', pass: true } },
      'r1:i:gawi:copy': { at: 'a0', response: { typed: '가위' }, result: { correct: true } },
    };
    const rows = typedAnswers(day);
    expect(rows).toEqual([
      { day: D, itemId: 'rc:pul', at: 'a1', wordId: 'pul', task: '3.3', source: 'recheck', typed: '풀', correct: true, score: 10, judge: 'exact', reason: null, regraded: null },
      { day: D, itemId: 'r1:q:0', at: 'a2', wordId: 'gawi', task: '3.3', source: 'verify', typed: '가위', correct: true, score: 10, judge: 'exact', reason: null, regraded: null },
      { day: D, itemId: 'p1:0', at: 'a4', wordId: 'chaek', task: '3.3', source: 'practice', typed: '책', correct: false, score: 4, judge: 'model', reason: 'partly', regraded: { at: 'z', actorId: 'parent', pass: true } },
    ]);
  });
});
