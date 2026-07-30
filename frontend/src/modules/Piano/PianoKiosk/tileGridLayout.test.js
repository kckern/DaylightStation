import { describe, it, expect } from 'vitest';
import { balancedColumns, balancedGrid } from './tileGridLayout.js';

describe('balancedColumns', () => {
  it('keeps up to `max` on a single row', () => {
    expect(balancedColumns(4)).toBe(4);   // Games: 4 in one centered row
    expect(balancedColumns(5)).toBe(5);
  });
  it('keeps the 10-item home menu at 5×2 (unchanged)', () => {
    expect(balancedColumns(10)).toBe(5);
  });
  it('fills the fewest rows then widens, past `max`', () => {
    expect(balancedColumns(6)).toBe(3);   // 3+3
    expect(balancedColumns(7)).toBe(4);   // 4+3
    expect(balancedColumns(8)).toBe(4);   // 4×2
    expect(balancedColumns(9)).toBe(5);   // 5+4 (2 rows beats a 3×3 square above the fold)
  });
  it('stays wide-and-short for large counts (never a narrow tall grid)', () => {
    expect(balancedColumns(13)).toBe(5);  // 5+5+3, not 2×7
    expect(balancedColumns(22)).toBe(5);  // 5×4+2, not 2×11
  });
  it('handles degenerate counts', () => {
    expect(balancedColumns(0)).toBe(1);
    expect(balancedColumns(1)).toBe(1);
    expect(balancedColumns(-3)).toBe(1);
  });
  it('honors a custom max', () => {
    expect(balancedColumns(6, { max: 4 })).toBe(3); // rows=2 → 3 cols
    expect(balancedColumns(4, { max: 3 })).toBe(2); // rows=2 → 2 cols
  });
});

describe('balancedGrid', () => {
  it('keeps a single row for tiny counts', () => {
    expect(balancedGrid(1)).toEqual({ rows: 1, cols: 1 });
    expect(balancedGrid(2)).toEqual({ rows: 1, cols: 2 });
    expect(balancedGrid(3)).toEqual({ rows: 1, cols: 3 });
  });

  it('matches balancedColumns at the fixed-max=5 sizes (10 → 5×2)', () => {
    expect(balancedGrid(10)).toEqual({ rows: 2, cols: 5 });
  });

  it('balances 11 into 3 rows (4/4/3), not a ragged 5+5+1', () => {
    expect(balancedGrid(11)).toEqual({ rows: 3, cols: 4 });
  });

  it('widens past 5 columns for a big library instead of stacking more 5-wide rows', () => {
    // rows0 (cap heuristic) is 4 for n=30, but 4×8 wastes 2 (8/8/8/6) — the
    // nearest BALANCED neighbour is rows=3, cols=10 (waste 0, 10/10/10).
    expect(balancedGrid(30)).toEqual({ rows: 3, cols: 10 });
  });

  it('finds the nearest balanced split when the cap-preferred rows count is ragged', () => {
    // rows0=3 for n=13 wastes 2 (13%3=1, needs rem===2 to balance at rows=3);
    // the nearest balanced neighbour is rows=2, cols=7 (waste 1, 7/6) — not
    // the naive cap-then-ceil answer, which would silently waste 2.
    expect(balancedGrid(13)).toEqual({ rows: 2, cols: 7 });
  });

  it('handles degenerate counts', () => {
    expect(balancedGrid(0)).toEqual({ rows: 1, cols: 1 });
    expect(balancedGrid(-3)).toEqual({ rows: 1, cols: 1 });
  });

  it('honors a custom minimum column cap', () => {
    expect(balancedGrid(6, { minCols: 3 })).toEqual({ rows: 2, cols: 3 });
  });

  // MANDATORY regression guard: balancedColumns' cap-then-ceil heuristic,
  // reused verbatim for rows/cols here, does NOT guarantee balance — 8 of the
  // 32 counts below (13, 16, 19, 22, 25, 26, 29, 30) failed it (spread up to
  // 2) before the nearest-balanced-neighbour search replaced it. This is the
  // assertion that would have caught that bug.
  it('is provably balanced (waste ≤ 1) for every count from 1 to 32', () => {
    for (let n = 1; n <= 32; n++) {
      const { rows, cols } = balancedGrid(n);
      const capacity = rows * cols;
      expect(capacity, `n=${n} rows=${rows} cols=${cols}`).toBeGreaterThanOrEqual(n);
      expect(capacity - n, `n=${n} rows=${rows} cols=${cols}`).toBeLessThanOrEqual(1);
    }
  });
});
