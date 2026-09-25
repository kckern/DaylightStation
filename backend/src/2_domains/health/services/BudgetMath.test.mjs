import { describe, it, expect } from 'vitest';
import { computeDailyBudget, computeDailyEnergy, daysBetween, solveDailyDeficit } from './BudgetMath.mjs';

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

describe('computeDailyEnergy', () => {
  it('keeps break-even (TDEE) beside the budget', () => {
    expect(computeDailyEnergy(base)).toEqual({ maintenance: 2462, budget: 1962 });
  });

  it('the floor raises the budget, never break-even', () => {
    expect(computeDailyEnergy({ ...base, weightLbs: 100, weeklyRateLbs: 3 })).toEqual({ maintenance: 1849, budget: 1200 });
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days across a DST change', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0);
  });
});

describe('solveDailyDeficit', () => {
  const plan = { weightLbs: 200, targetWeightLbs: 180, day: '2026-09-24', weeklyRateLbs: 1, maxWeeklyRateLbs: 2 };

  it('solves pounds-to-go over days-to-go', () => {
    // 20 lb × 3500 / 100 days = 700
    expect(solveDailyDeficit({ ...plan, targetDate: '2027-01-02' })).toEqual({ deficit: 700, deficitSource: 'target-date' });
  });

  it('caps the solved deficit at maxWeeklyRateLbs', () => {
    // 20 lb in 10 days = 7000/day → cap 2 lb/wk = 1000
    expect(solveDailyDeficit({ ...plan, targetDate: '2026-10-04' })).toEqual({ deficit: 1000, deficitSource: 'target-date' });
  });

  it('is zero at or under the target weight', () => {
    expect(solveDailyDeficit({ ...plan, weightLbs: 180, targetDate: '2027-01-02' })).toEqual({ deficit: 0, deficitSource: 'at-target' });
    expect(solveDailyDeficit({ ...plan, weightLbs: 175 })).toEqual({ deficit: 0, deficitSource: 'at-target' });
  });

  it('falls back to the weekly rate with no date, a passed date, or the date itself (never divides by zero)', () => {
    for (const targetDate of [null, '2026-09-01', '2026-09-24']) {
      expect(solveDailyDeficit({ ...plan, targetDate })).toEqual({ deficit: 500, deficitSource: 'weekly-rate' });
    }
  });

  it('falls back to the weekly rate with no target weight', () => {
    expect(solveDailyDeficit({ ...plan, targetWeightLbs: null, targetDate: '2027-01-02' })).toEqual({ deficit: 500, deficitSource: 'weekly-rate' });
  });
});

describe('computeDailyEnergy with a solved deficit', () => {
  it('uses the given deficit instead of the weekly rate', () => {
    const e = computeDailyEnergy({ ...base, deficit: 700 });
    expect(e.budget).toBe(e.maintenance - 700);
  });

  it('never returns a top below the floor', () => {
    expect(computeDailyEnergy({ ...base, deficit: 5000 }).budget).toBe(1200);
  });
});
