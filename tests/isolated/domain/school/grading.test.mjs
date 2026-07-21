import { describe, it, expect } from 'vitest';
import { gradeAnswer, givenShapeError } from '#domains/school/grading.mjs';

const sa = { id: 'q', type: 'short_answer', prompt: 'Capital of OR?', answer: 'Salem', accept: ['salem city'] };
const match = { id: 'm', type: 'matching', prompt: 'M', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] };

describe('gradeAnswer', () => {
  it('multiple_choice: exact match only', () => {
    const item = { id: 'q', type: 'multiple_choice', prompt: 'P', answer: 'Olympia', choices: ['Seattle', 'Olympia'] };
    expect(gradeAnswer(item, 'Olympia')).toEqual({ correct: true, expected: 'Olympia' });
    expect(gradeAnswer(item, 'Seattle').correct).toBe(false);
  });
  it('short_answer: trims, collapses whitespace, casefolds', () => {
    expect(gradeAnswer(sa, '  salem ').correct).toBe(true);
    expect(gradeAnswer(sa, 'SALEM').correct).toBe(true);
    expect(gradeAnswer(sa, 'Salem  City').correct).toBe(true); // accept entry, collapsed
  });
  it('short_answer: no fuzz — near-misses stay wrong', () => {
    expect(gradeAnswer(sa, 'Salems').correct).toBe(false);
    expect(gradeAnswer(sa, 'Sale m').correct).toBe(false);
    expect(gradeAnswer(sa, 'St. Salem').correct).toBe(false); // punctuation NOT stripped
  });
  it('cloze grades exactly like short_answer', () => {
    const item = { id: 'c', type: 'cloze', prompt: 'Capital is ___.', answer: 'Boise' };
    expect(gradeAnswer(item, ' boise ').correct).toBe(true);
  });
  it('matching: all pairs correct in any order', () => {
    expect(gradeAnswer(match, [{ left: 'OR', right: 'Salem' }, { left: 'WA', right: 'Olympia' }]).correct).toBe(true);
  });
  it('matching: one wrong pair fails the whole item (all-or-nothing)', () => {
    const three = {
      id: 'm3',
      type: 'matching',
      prompt: 'M3',
      pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }, { left: 'ID', right: 'Boise' }],
    };
    // Two pairs genuinely correct, one wrong — must not get credit for the two right ones.
    const r = gradeAnswer(three, [
      { left: 'WA', right: 'Olympia' },
      { left: 'OR', right: 'Salem' },
      { left: 'ID', right: 'Salem' }, // wrong
    ]);
    expect(r.correct).toBe(false);
    expect(r.expected).toEqual(three.pairs);
  });
  it('matching: missing a pair fails', () => {
    expect(gradeAnswer(match, [{ left: 'WA', right: 'Olympia' }]).correct).toBe(false);
  });
  it('matching: repeating one correct pair N times does not fake a full match', () => {
    // Exploit: client knows only one correct pair, submits it match.pairs.length times.
    // Length matches item.pairs.length and every submitted pair is individually correct,
    // but lefts are not unique and don't cover the item's left set.
    const r = gradeAnswer(match, [{ left: 'OR', right: 'Salem' }, { left: 'OR', right: 'Salem' }]);
    expect(r.correct).toBe(false);
  });
  it('matching: lefts not matching the item\'s left set fails, even with the right pair count', () => {
    const r = gradeAnswer(match, [{ left: 'OR', right: 'Salem' }, { left: 'CA', right: 'Olympia' }]);
    expect(r.correct).toBe(false);
  });
});

describe('givenShapeError', () => {
  it('accepts string for text types, array of pairs for matching', () => {
    expect(givenShapeError(sa, 'x')).toBe(null);
    expect(givenShapeError(match, [{ left: 'WA', right: 'Olympia' }])).toBe(null);
  });
  it('rejects wrong shapes', () => {
    expect(givenShapeError(sa, ['x'])).toBeTruthy();
    expect(givenShapeError(match, 'Olympia')).toBeTruthy();
    expect(givenShapeError(match, [{ left: 'WA' }])).toBeTruthy();
    expect(givenShapeError(sa, undefined)).toBeTruthy();
  });
});
