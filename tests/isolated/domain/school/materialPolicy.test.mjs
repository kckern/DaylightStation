import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '#domains/school/categories.mjs';
import {
  orderUnits,
  unitCompleted,
  annotateLocks,
  quizSessionPassed,
} from '#domains/school/materialPolicy.mjs';

const threshold = { completionThresholdPercent: 90 };

describe('orderUnits', () => {
  it('returns a sorted copy by index, leaving the input untouched', () => {
    const units = [{ id: 'c', index: 2 }, { id: 'a', index: 0 }, { id: 'b', index: 1 }];
    const original = [...units];
    const ordered = orderUnits(units);
    expect(ordered.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(units).toEqual(original); // input not mutated
    expect(ordered).not.toBe(units); // copy, not same array reference
  });
});

describe('unitCompleted', () => {
  it("completion:[] (reference) never completes, even at 100% and gate satisfied", () => {
    expect(unitCompleted({ percent: 100, gateSatisfied: true }, CATEGORIES.reference, threshold)).toBe(false);
  });

  it("completion:['played'] (listening) completes at/above threshold", () => {
    expect(unitCompleted({ percent: 90, gateSatisfied: false }, CATEGORIES.listening, threshold)).toBe(true);
    expect(unitCompleted({ percent: 89, gateSatisfied: false }, CATEGORIES.listening, threshold)).toBe(false);
  });

  it("completion:['played','gate'] (course) requires BOTH conditions", () => {
    // played only, gate not satisfied -> false
    expect(unitCompleted({ percent: 100, gateSatisfied: false }, CATEGORIES.course, threshold)).toBe(false);
    // gate only, not enough percent -> false
    expect(unitCompleted({ percent: 10, gateSatisfied: true }, CATEGORIES.course, threshold)).toBe(false);
    // both -> true
    expect(unitCompleted({ percent: 90, gateSatisfied: true }, CATEGORIES.course, threshold)).toBe(true);
  });
});

describe('annotateLocks', () => {
  const units = orderUnits([
    { id: 'u1', index: 0, title: 'Act 1' },
    { id: 'u2', index: 1, title: 'Act 2' },
    { id: 'u3', index: 2, title: 'Act 3' },
    { id: 'u4', index: 3, title: 'Act 4' },
    { id: 'u5', index: 4, title: 'Act 5' },
  ]);

  it('sequential: units before the first incomplete are unlocked, it is current, everything after is locked naming it', () => {
    const completedFlags = [true, true, false, false, false];
    const gateInfo = units.map(() => ({ hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.course, gateInfo);

    expect(result[0]).toEqual({ locked: false, current: false, lockReason: null });
    expect(result[1]).toEqual({ locked: false, current: false, lockReason: null });
    expect(result[2]).toEqual({ locked: false, current: true, lockReason: null });
    expect(result[3]).toEqual({ locked: true, current: false, lockReason: 'Finish “Act 3” first' });
    expect(result[4]).toEqual({ locked: true, current: false, lockReason: 'Finish “Act 3” first' });
  });

  it('quiz-gate variant: current unit has an unsatisfied quiz gate -> reason names the quiz, not "finish"', () => {
    const completedFlags = [true, true, false, false, false];
    const gateInfo = units.map((u, i) => (i === 2 ? { hasQuiz: true, gateSatisfied: false } : { hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.course, gateInfo);

    expect(result[2]).toEqual({ locked: false, current: true, lockReason: null });
    expect(result[3].lockReason).toBe('Pass the quiz for “Act 3” first');
    expect(result[4].lockReason).toBe('Pass the quiz for “Act 3” first');
  });

  it('missing-quiz variant: current unit watched but bankless (needsQuiz) -> reason asks for the quiz', () => {
    const completedFlags = [true, true, false, false, false];
    const gateInfo = units.map((u, i) => (i === 2
      ? { hasQuiz: false, gateSatisfied: false, needsQuiz: true, played: true }
      : { hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.course, gateInfo);

    expect(result[2]).toEqual({ locked: false, current: true, lockReason: null });
    expect(result[3].lockReason).toBe('“Act 3” is waiting for its quiz — request one to move on');
    expect(result[4].lockReason).toBe('“Act 3” is waiting for its quiz — request one to move on');
  });

  it('missing-quiz but UNwatched current unit -> reason is still "finish it" (watching is the first blocker)', () => {
    const completedFlags = [true, true, false, false, false];
    const gateInfo = units.map((u, i) => (i === 2
      ? { hasQuiz: false, gateSatisfied: false, needsQuiz: true, played: false }
      : { hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.course, gateInfo);

    expect(result[3].lockReason).toBe('Finish “Act 3” first');
  });

  it('single-unit material never locks, whether complete or not', () => {
    const one = orderUnits([{ id: 'solo', index: 0, title: 'I Survived' }]);
    const gateInfo = [{ hasQuiz: true, gateSatisfied: false }];

    const incomplete = annotateLocks(one, [false], CATEGORIES.course, gateInfo);
    expect(incomplete).toEqual([{ locked: false, current: true, lockReason: null }]);

    const complete = annotateLocks(one, [true], CATEGORIES.course, gateInfo);
    expect(complete).toEqual([{ locked: false, current: false, lockReason: null }]);
  });

  it('non-sequential category: nothing is ever locked or current', () => {
    const completedFlags = [true, false, false, false, false];
    const gateInfo = units.map(() => ({ hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.reference, gateInfo);
    expect(result).toEqual(units.map(() => ({ locked: false, current: false, lockReason: null })));
  });

  it('all units complete: none locked, none current', () => {
    const completedFlags = [true, true, true, true, true];
    const gateInfo = units.map(() => ({ hasQuiz: false, gateSatisfied: true }));
    const result = annotateLocks(units, completedFlags, CATEGORIES.course, gateInfo);
    expect(result).toEqual(units.map(() => ({ locked: false, current: false, lockReason: null })));
  });
});

describe('quizSessionPassed', () => {
  it('true if ANY session score meets the pass bar', () => {
    // 4-item bank; session s1 gets 2/4 = 50%, session s2 gets 4/4 = 100%
    const attempts = [
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i2', correct: false },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i2', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i3', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i4', correct: true },
    ];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 4, passPercent: 80 })).toBe(true);
  });

  it('two sessions at 40% and 80% with an 80 pass bar -> true (the 80% session clears it)', () => {
    // 5-item bank; s1 = 2/5 = 40%, s2 = 4/5 = 80%
    const attempts = [
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i2', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i2', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i3', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's2', itemId: 'i4', correct: true },
    ];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 5, passPercent: 80 })).toBe(true);
  });

  it('false when no session reaches the pass bar', () => {
    const attempts = [
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i2', correct: false },
    ];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 4, passPercent: 80 })).toBe(false);
  });

  it('distinct-item rule: repeated correct answers to ONE item in a 4-item bank score 25%, not 100%', () => {
    const attempts = [
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
    ];
    // 1 distinct correct item / 4 = 25%, well under any reasonable pass bar
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 4, passPercent: 80 })).toBe(false);
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 4, passPercent: 25 })).toBe(true);
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 4, passPercent: 26 })).toBe(false);
  });

  it("mode 'flashcard' attempts are ignored, even if correct", () => {
    const attempts = [
      { mode: 'flashcard', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'flashcard', bankId: 'b1', sessionId: 's1', itemId: 'i2', correct: true },
    ];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 2, passPercent: 50 })).toBe(false);
  });

  it('attempts for a different bankId are ignored', () => {
    const attempts = [
      { mode: 'quiz', bankId: 'other-bank', sessionId: 's1', itemId: 'i1', correct: true },
      { mode: 'quiz', bankId: 'other-bank', sessionId: 's1', itemId: 'i2', correct: true },
    ];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 2, passPercent: 50 })).toBe(false);
  });

  it('empty attempts array -> false', () => {
    expect(quizSessionPassed([], { bankId: 'b1', itemCount: 4, passPercent: 80 })).toBe(false);
  });

  it('zero itemCount -> false', () => {
    const attempts = [{ mode: 'quiz', bankId: 'b1', sessionId: 's1', itemId: 'i1', correct: true }];
    expect(quizSessionPassed(attempts, { bankId: 'b1', itemCount: 0, passPercent: 80 })).toBe(false);
  });
});
