import { describe, it, expect } from 'vitest';
import { omrKeyAlignmentSuspect, MIN_ITEMS, MARGIN } from './omrKeyAlignment.mjs';

// The real 2026-09-21 New York-lesson scan (session ses_qkd1wl1fzz, rows
// 22-27): a parent suspected a row-shift mistake. Hand verification found
// none — this is the must-NOT-trigger regression fixture that matters most.
// Recomputed by hand during review: literal=2; offset -2 -> 0, -1 -> 1,
// +1 -> 0, +2 -> 1. No offset reaches MARGIN(2). Confirmed null.
const learner1NewYorkRows = [
  { row: 22, given: 'C', correctLetter: 'C' },
  { row: 23, given: 'A', correctLetter: 'B' },
  { row: 24, given: 'B', correctLetter: 'B' },
  { row: 25, given: 'C', correctLetter: 'A' },
  { row: 26, given: 'C', correctLetter: 'A' },
  { row: 27, given: 'C', correctLetter: 'D' },
];

describe('omrKeyAlignmentSuspect', () => {
  it('does not flag a real 2/6 sheet whose misses are genuine content misses', () => {
    expect(omrKeyAlignmentSuspect(learner1NewYorkRows)).toBeNull();
  });

  it('flags a synthetic sheet whose marks are the key shifted down one row', () => {
    // correct[row] for rows 1-6: A,B,C,D,A,B. given[row] = correct[row-1] for
    // rows 2-6 (a learner who wrote each answer one row late); row 1 has no
    // row 0 to draw from, so it is deliberately wrong. Recomputed by hand:
    // literal=0; offset -1 gives 5 matches (rows 2-6); offsets -2/+1/+2 give
    // fewer. -1/5/0/6 is the correct result.
    const rows = [
      { row: 1, given: 'E', correctLetter: 'A' },
      { row: 2, given: 'A', correctLetter: 'B' },
      { row: 3, given: 'B', correctLetter: 'C' },
      { row: 4, given: 'C', correctLetter: 'D' },
      { row: 5, given: 'D', correctLetter: 'A' },
      { row: 6, given: 'A', correctLetter: 'B' },
    ];
    expect(omrKeyAlignmentSuspect(rows)).toEqual({
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
  });

  it('never flags a worksheet below MIN_ITEMS, however clean the shift', () => {
    const rows = [
      { row: 1, given: 'E', correctLetter: 'A' },
      { row: 2, given: 'A', correctLetter: 'B' },
      { row: 3, given: 'B', correctLetter: 'C' },
      { row: 4, given: 'C', correctLetter: 'D' },
    ];
    expect(rows.length).toBe(MIN_ITEMS - 1);
    expect(omrKeyAlignmentSuspect(rows, { minItems: MIN_ITEMS })).toBeNull();
  });

  it('never lets a shift reach outside the worksheet\'s own row range', () => {
    // 4-row sheet, whose key repeats a pattern such that a shift crediting
    // row 4 a match against a row 5 that does not exist on this worksheet
    // would look clean. It does not: row 4 contributes no shifted match at
    // offset +1 at all — verified below by checking the exact shiftedMatches
    // count, not just null/non-null. (This demonstrates the OUTCOME, not a
    // specific mechanism — a shifted target that is not one of THIS
    // worksheet's own rows is never credited, however that is implemented;
    // `byRow.get(shiftedRow)` already misses on row 5 for the same reason an
    // explicit min/max range check would, since `byRow` is built from
    // exactly the rows passed in and can hold no key beyond them.)
    const rows = [
      { row: 1, given: 'B', correctLetter: 'A' },
      { row: 2, given: 'C', correctLetter: 'B' },
      { row: 3, given: 'D', correctLetter: 'C' },
      { row: 4, given: 'A', correctLetter: 'D' },
    ];
    // At offset +1: row1->row2(correct B, given B: match), row2->row3(correct
    // C, given C: match), row3->row4(correct D, given D: match), row4->row5
    // (no row 5 on this worksheet: excluded). shiftedMatches must be 3, not
    // 4 — a version that credited row 4 a match against a phantom row 5
    // would report 4 instead.
    const result = omrKeyAlignmentSuspect(rows, { minItems: 4 });
    expect(result).toEqual({ offset: 1, literalMatches: 0, shiftedMatches: 3, itemCount: 4 });
  });

  it('does not flag an already-passing sheet even when MARGIN alone would (PASSING_FLOOR is what prevents it)', () => {
    // 12 rows: correct key is 'A' for rows 1-10, then 'B' (row 11), 'C' (row 12).
    // given matches literally for rows 1-9 (literalMatches=9, 75% -- passes
    // PASSING_FLOOR=0.7) and is deliberately WRONG but shift-aligned for rows
    // 10-12: given(10)='B'=correct(11), given(11)='C'=correct(12). Hand-verified:
    // at offset +1, every row i=1..11 has given[i] === correct[i+1] (rows 1-9
    // because correct[i+1] is still 'A' through row 10; rows 10-11 by
    // construction), so shiftedMatches=11. shiftedMatches - literalMatches =
    // 11 - 9 = 2, which MEETS margin(2) -- MARGIN ALONE would flag this
    // passing sheet. Only PASSING_FLOOR (9/12 = 0.75 >= 0.7) stops it.
    const correctKey = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'B', 'C'];
    const givenMarks = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'B', 'C', 'E'];
    const rows = correctKey.map((correctLetter, index) => ({
      row: index + 1, given: givenMarks[index], correctLetter,
    }));
    const literalMatches = rows.filter((row) => row.given === row.correctLetter).length;
    // The comment above hand-computes shiftedMatches (11) - literalMatches
    // (9) as exactly MARGIN — assert that against the real exported
    // constant, not a hardcoded 2, so this fixture can never silently drift
    // out of alignment with the value it's built to sit exactly at.
    expect(11 - literalMatches).toBe(MARGIN);
    expect(omrKeyAlignmentSuspect(rows)).toBeNull();
  });
});
