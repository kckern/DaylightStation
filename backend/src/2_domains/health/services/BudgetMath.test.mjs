import { describe, it, expect } from 'vitest';
import { computeDailyBudget } from './BudgetMath.mjs';

const base = {
  weightLbs: 200, heightIn: 70, ageYears: 40, sex: 'male',
  activityBaseline: 1.35, weeklyRateLbs: 1, budgetFloor: 1200,
};

describe('computeDailyBudget', () => {
  it('computes Mifflin-St Jeor male fixture', () => {
    // kg=90.718, cm=177.8 → BMR = 10*90.718 + 6.25*177.8 - 5*40 + 5 = 1823.4
    // TDEE = 1823.4*1.35 = 2461.6; deficit 3500/7=500 → 1962
    expect(computeDailyBudget(base)).toBe(1962);
  });

  it('female offset is -161', () => {
    const m = computeDailyBudget(base);
    const f = computeDailyBudget({ ...base, sex: 'female' });
    expect(m - f).toBe(Math.round(166 * 1.35)); // (5 - -161) * activity
  });

  it('applies the floor', () => {
    expect(computeDailyBudget({ ...base, weeklyRateLbs: 5 })).toBeGreaterThanOrEqual(1200);
    expect(computeDailyBudget({ ...base, weightLbs: 100, weeklyRateLbs: 3 })).toBe(1200);
  });

  it('rejects non-finite inputs without coercion', () => {
    expect(() => computeDailyBudget({ ...base, weightLbs: '200' })).toThrow(/INVALID_BUDGET_INPUT/);
    expect(() => computeDailyBudget({ ...base, ageYears: NaN })).toThrow(/INVALID_BUDGET_INPUT/);
  });

  it('rejects unknown sex', () => {
    expect(() => computeDailyBudget({ ...base, sex: 'x' })).toThrow(/INVALID_BUDGET_INPUT/);
  });
});
