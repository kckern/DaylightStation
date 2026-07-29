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
    const { rows, cols } = balancedGrid(30);
    expect(cols).toBeGreaterThanOrEqual(6);
    expect(rows * cols).toBeGreaterThanOrEqual(30);
    // Widening (not just endlessly stacking rows) keeps the row count sane —
    // a naive fixed max=5 would need 6 rows for 30; this should need fewer.
    expect(rows).toBeLessThan(6);
  });

  it('handles degenerate counts', () => {
    expect(balancedGrid(0)).toEqual({ rows: 1, cols: 1 });
    expect(balancedGrid(-3)).toEqual({ rows: 1, cols: 1 });
  });

  it('honors a custom minimum column cap', () => {
    expect(balancedGrid(6, { minCols: 3 })).toEqual({ rows: 2, cols: 3 });
  });
});
