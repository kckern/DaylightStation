import { describe, it, expect } from 'vitest';
import { assessBudgetDay } from './budgetAssessment.mjs';
import { summarizeBudgetPeriod } from './budgetPeriod.mjs';

const today = '2026-10-25';
const assess = (date, food, extra = {}, ctx = {}) => assessBudgetDay({
  food, exercise: 0, maintenance: 2000, range: { floor: 1200, top: 1600 },
  macros: { protein: 90 }, goalBasis: 'current', ...extra,
}, { date, today, ...ctx });

describe('summarizeBudgetPeriod', () => {
  it('uses each trusted finished day\'s own plan and exercise, retaining missing-date coverage', () => {
    const rows = [
      assess('2026-10-19', 1704, { exercise: 997 }),
      assess('2026-10-20', 2100, { exercise: 100, range: { floor: 1200, top: 1800 }, maintenance: 2100 }),
      assess('2026-10-21', 330),
      assess('2026-10-22', 1800, {}, { provenance: 'reconstructed' }),
      assessBudgetDay(null, { date: '2026-10-23', today }),
      assess('2026-10-24', 2200),
      assess(today, 4000),
    ];
    // Eligible: food 1704+2100+1800+2200; exercise 997+100+0+0;
    // plan deltas -893+200+200+600; maintenance deltas -1293-100-200+200.
    expect(summarizeBudgetPeriod(rows)).toEqual({
      coverage: { total: 7, available: 6, trustedFinished: 4, proteinKnown: 3, planKnown: 4, maintenanceKnown: 4 },
      averages: { food: 1951, exercise: 274.25, net: 1676.75, planDelta: 26.75, maintenanceDelta: -348.25 },
      counts: { withinPlan: 1, overPlan: 3, surplus: 1 }, goalBasis: 'current',
    });
  });

  it('excludes a complete in-progress day from every average and count', () => {
    expect(summarizeBudgetPeriod([assess(today, 2100)])).toEqual({
      coverage: { total: 1, available: 1, trustedFinished: 0, proteinKnown: 0, planKnown: 0, maintenanceKnown: 0 },
      averages: { food: null, exercise: null, net: null, planDelta: null, maintenanceDelta: null },
      counts: { withinPlan: 0, overPlan: 0, surplus: 0 }, goalBasis: 'current',
    });
  });

  it('includes a declared fast but not an unfinished skipped-meal day', () => {
    expect(summarizeBudgetPeriod([
      assess(today, 0, { declared: 'fasting', macros: {} }),
      assess(today, 330, { fastedMeals: ['morning'] }),
    ])).toMatchObject({ coverage: { total: 2, available: 2, trustedFinished: 1, proteinKnown: 0 },
      averages: { food: 0, exercise: 0, net: 0, planDelta: -1600, maintenanceDelta: -2000 },
      counts: { withinPlan: 1, overPlan: 0, surplus: 0 } });
  });

  it('keeps an unknown maintenance average unknown without discarding known plan evidence', () => {
    expect(summarizeBudgetPeriod([assess('2026-10-24', 1800, { maintenance: null })])).toMatchObject({
      coverage: { trustedFinished: 1, planKnown: 1, maintenanceKnown: 0 },
      averages: { food: 1800, exercise: 0, net: 1800, planDelta: 200, maintenanceDelta: null },
      counts: { withinPlan: 0, overPlan: 1, surplus: 0 },
    });
  });

  it('does not change the maintenance denominator when one eligible day is unknown', () => {
    expect(summarizeBudgetPeriod([
      assess('2026-10-23', 1800),
      assess('2026-10-24', 1600, { maintenance: null }),
    ])).toMatchObject({
      coverage: { trustedFinished: 2, planKnown: 2, maintenanceKnown: 1 },
      averages: { food: 1700, exercise: 0, net: 1700, planDelta: 100, maintenanceDelta: null },
    });
  });

  it('retains unknown plan coverage without shrinking energy-average denominators', () => {
    expect(summarizeBudgetPeriod([
      assess('2026-10-23', 1500),
      assess('2026-10-24', 1800, { range: { floor: 1200 } }),
    ])).toMatchObject({
      coverage: { trustedFinished: 2, planKnown: 1, maintenanceKnown: 2 },
      averages: { food: 1650, exercise: 0, net: 1650, planDelta: null, maintenanceDelta: -350 },
      counts: { withinPlan: 1, overPlan: 0, surplus: 0 },
    });
  });

  it('empty coverage has null averages and goal basis', () => {
    expect(summarizeBudgetPeriod([])).toEqual({
      coverage: { total: 0, available: 0, trustedFinished: 0, proteinKnown: 0, planKnown: 0, maintenanceKnown: 0 },
      averages: { food: null, exercise: null, net: null, planDelta: null, maintenanceDelta: null },
      counts: { withinPlan: 0, overPlan: 0, surplus: 0 }, goalBasis: null,
    });
  });

  it('does not claim a common basis when available days have mixed or unknown bases', () => {
    const current = assess('2026-10-23', 1300);
    expect(summarizeBudgetPeriod([current, assess('2026-10-24', 1300, { goalBasis: 'historical' })]).goalBasis).toBeNull();
    expect(summarizeBudgetPeriod([current, assess('2026-10-24', 1300, { goalBasis: null })]).goalBasis).toBeNull();
  });
});
