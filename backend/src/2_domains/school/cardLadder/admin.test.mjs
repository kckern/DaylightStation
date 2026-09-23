// backend/src/2_domains/school/cardLadder/admin.test.mjs
import { describe, expect, it } from 'vitest';
import { applyGraded, emptyWordV3 } from './mastery.mjs';
import { newAllowance, planNextRound } from './rounds.mjs';
import { addDays } from '../termVerdict.mjs';
import { emptyDay } from './statusV3.mjs';
import { markMastered, typedAnswers } from './admin.mjs';

const D = '2026-09-22';
const SET = { round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 } };

describe('markMastered (grown-up control)', () => {
  it('sets mastered at the stage, due after that stage\'s gap, and clears miss flags', () => {
    const word = { ...emptyWordV3(), state: 'familiar', missStreak: 2, tricky: true, trickySince: '2026-09-20', notYetCarry: true, introducedDay: '2026-09-10' };
    expect(markMastered(word, { stage: 2, day: D })).toMatchObject({
      state: 'mastered', stage: 2, dueDay: '2026-09-29', missStreak: 0, tricky: false, trickySince: null, notYetCarry: false, introducedDay: '2026-09-10',
    });
    expect(markMastered(word, { stage: 9, day: D }).dueDay).toBe('2026-11-21'); // GAPS[5] = 60
    // A grown-up's mark is a sign-off (ruling 2026-09-23).
    expect(markMastered(word, { stage: 2, day: D })).toMatchObject({ recognizedCount: 2, matched: true, typedSignedOff: D });
    expect(markMastered(word, { stage: 0, day: D }).dueDay).toBe('2026-09-23');
  });
  it('a never-introduced word gets today as its introduced day, so a later miss is carried', () => {
    const marked = markMastered(emptyWordV3(), { stage: 1, day: D });
    expect(marked.introducedDay).toBe(D);
    const missed = applyGraded(marked, { source: 'recheck', correct: false, day: marked.dueDay, task: '2.2', settings: { afterMisses: 2, gapScale: 1 } });
    expect(missed.state).toBe('familiar');
    const round = planNextRound({ words: { gawi: missed }, pool: [], day: addDays(marked.dueDay, 1), settings: SET, remainingMs: 900000, roundNumber: 1 });
    expect(round).toMatchObject({ kind: 'carry', words: ['gawi'] });
  });
  it('a grown-up\'s mark does not use up today\'s new-word allowance, and the word is still carried after a miss', () => {
    const marked = markMastered(emptyWordV3(), { stage: 1, day: D });
    expect(marked.introducedBy).toBe('admin');
    const SETTINGS = { ...SET, batch: { newPerDay: 1, workingSet: 7 } };
    expect(newAllowance({ words: { gawi: marked }, day: D, settings: SETTINGS })).toBe(1);
    // A word already introduced by the child keeps its own record untouched.
    const own = markMastered({ ...emptyWordV3(), state: 'familiar', introducedDay: D }, { stage: 1, day: D });
    expect(own.introducedBy).toBeUndefined();
    expect(newAllowance({ words: { pul: own }, day: D, settings: SETTINGS })).toBe(0);
    const missed = applyGraded(marked, { source: 'recheck', correct: false, day: marked.dueDay, task: '2.2', settings: { afterMisses: 2, gapScale: 1 } });
    expect(planNextRound({ words: { gawi: missed }, pool: [], day: addDays(marked.dueDay, 1), settings: SET, remainingMs: 900000, roundNumber: 1 }))
      .toMatchObject({ kind: 'carry', words: ['gawi'] });
  });
  it('applies the day\'s tuned review.gapScale like a recheck pass does (1 when absent)', () => {
    expect(markMastered(emptyWordV3(), { stage: 2, day: D, gapScale: 2 }).dueDay).toBe('2026-10-06'); // 7 * 2
    expect(markMastered(emptyWordV3(), { stage: 0, day: D, gapScale: 0.2 }).dueDay).toBe('2026-09-23'); // never under a day
    expect(markMastered(emptyWordV3(), { stage: 2, day: D, gapScale: null }).dueDay).toBe('2026-09-29');
  });
  it('refuses a stage that is not a non-negative integer', () => {
    expect(() => markMastered(emptyWordV3(), { stage: -1, day: D })).toThrow(/stage/);
    expect(() => markMastered(emptyWordV3(), { stage: 1.5, day: D })).toThrow(/stage/);
  });
});

describe('typedAnswers (a day file\'s judged typed answers)', () => {
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
      'rc:mul': { at: 'a5', response: { typed: '무' }, result: { correct: true, score: 6, judge: 'distance' }, wordId: 'mul', task: '1.4', source: 'recheck' },
    };
    const rows = typedAnswers(day);
    expect(rows).toEqual([
      { day: D, itemId: 'rc:pul', at: 'a1', wordId: 'pul', task: '3.3', source: 'recheck', typed: '풀', correct: true, score: 10, judge: 'exact', reason: null, regraded: null },
      { day: D, itemId: 'r1:q:0', at: 'a2', wordId: 'gawi', task: '3.3', source: 'verify', typed: '가위', correct: true, score: 10, judge: 'exact', reason: null, regraded: null },
      { day: D, itemId: 'p1:0', at: 'a4', wordId: 'chaek', task: '3.3', source: 'practice', typed: '책', correct: false, score: 4, judge: 'model', reason: 'partly', regraded: { at: 'z', actorId: 'parent', pass: true } },
      // A graded dictation (1.4) sign-off is judged like 3.3, so a grown-up sees and can re-grade it.
      { day: D, itemId: 'rc:mul', at: 'a5', wordId: 'mul', task: '1.4', source: 'recheck', typed: '무', correct: true, score: 6, judge: 'distance', reason: null, regraded: null },
    ]);
  });
});
