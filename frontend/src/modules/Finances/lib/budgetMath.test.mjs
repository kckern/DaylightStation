import { budgetProgress } from './budgetMath.mjs';

describe('budgetProgress', () => {
  test('mid-budget progress is fractional', () => {
    const p = budgetProgress('2026-01-01', '2026-12-31', '2026-07-01');
    expect(p.progress).toBeGreaterThan(0.4);
    expect(p.progress).toBeLessThan(0.6);
    expect(p.weeksLeft).toBeGreaterThan(0);
  });
  test('after the budget ends, progress clamps to 1 and weeksLeft to 0', () => {
    const p = budgetProgress('2024-01-01', '2024-12-31', '2026-07-01');
    expect(p.progress).toBe(1);
    expect(p.weeksLeft).toBe(0);
  });
  test('before the budget starts, progress clamps to 0', () => {
    const p = budgetProgress('2027-01-01', '2027-12-31', '2026-07-01');
    expect(p.progress).toBe(0);
  });
  test('degenerate zero-length budget does not divide by zero', () => {
    const p = budgetProgress('2026-07-01', '2026-07-01', '2026-07-01');
    expect(Number.isFinite(p.progress)).toBe(true);
    expect(p.progress).toBe(1);
  });
});
