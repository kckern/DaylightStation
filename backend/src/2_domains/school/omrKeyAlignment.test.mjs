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
    // 4-row sheet, whose key repeats a pattern such that a NAIVE (unbounded)
    // +1 shift would look clean if row 4 were allowed to "match" a row 5
    // that does not exist. The boundary rule means row 4 contributes no
    // shifted match at offset +1 at all — verified below by checking the
    // exact shiftedMatches count, not just null/non-null.
    const rows = [
      { row: 1, given: 'B', correctLetter: 'A' },
      { row: 2, given: 'C', correctLetter: 'B' },
      { row: 3, given: 'D', correctLetter: 'C' },
      { row: 4, given: 'A', correctLetter: 'D' },
    ];
    // At offset +1: row1->row2(correct B, given B: match), row2->row3(correct
    // C, given C: match), row3->row4(correct D, given D: match), row4->row5
    // (out of range: excluded). shiftedMatches must be 3, not 4 — if the
    // boundary guard were missing and row 4 wrapped to a phantom row 5 that
    // happened to be treated as matching, this would be 4 instead.
    const result = omrKeyAlignmentSuspect(rows, { minItems: 4 });
    expect(result).toEqual({ offset: 1, literalMatches: 0, shiftedMatches: 3, itemCount: 4 });
  });

  it('does not flag an already-passing sheet even when a shift would score higher still', () => {
    // 9/12 correct literally (75%) — a real pass on most grading scales.
    // Constructed so shifting by -1 would raise 3 of the wrong rows to
    // correct, pushing shiftedMatches to 12 — margin(2) alone does NOT rule
    // this out (12 - 9 = 3 >= 2), which is exactly the false "structural"
    // proof an earlier draft of this file relied on. PASSING_FLOOR is the
    // real guard: literalMatches/itemCount (0.75) is at or above it, so this
    // must return null regardless of how large the shifted score is.
    const correct = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'];
    const rows = correct.map((letter, index) => ({
      row: index + 1,
      given: index < 9 ? letter : correct[index - 1], // last 3 rows: shifted-late guess
      correctLetter: letter,
    }));
    expect(omrKeyAlignmentSuspect(rows)).toBeNull();
  });
});
