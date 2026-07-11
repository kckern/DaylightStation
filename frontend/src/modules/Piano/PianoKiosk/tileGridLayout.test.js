import { describe, it, expect } from 'vitest';
import { balancedColumns } from './tileGridLayout.js';

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
