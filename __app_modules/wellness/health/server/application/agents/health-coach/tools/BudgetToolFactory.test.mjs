import { describe, it, expect, vi } from 'vitest';
import { BudgetToolFactory } from "./BudgetToolFactory.mjs";

const contract = (date, over = {}) => ({
  date, food: 1257, exercise: 248, net: 1009, maintenance: 2291, deficit: 500, deficitSource: 'weekly-rate',
  range: { floor: 1200, top: 1791 }, zone: 'in-range', complete: true, declared: null, remaining: 782,
  macros: { protein: 67 }, sessions: [{}], goals: { secret: true }, ...over,
});

const tools = (deps) => Object.fromEntries(new BudgetToolFactory({ healthStore: { loadNutritionData: async () => ({}), loadDayClosedData: async () => ({}) }, clock: { now: () => new Date(`${deps.today?.() || '2026-09-25'}T18:00:00Z`) }, ...deps }).createTools().map(t => [t.name, t]));

describe('BudgetToolFactory', () => {
  it('get_day_budget returns the day in the shape the assignments read, with its counted foods', async () => {
    const t = tools({
      budgetService: { getBudget: vi.fn().mockResolvedValue(contract('2026-09-24')) },
      today: () => '2026-09-25',
      nutriListStore: { findByDate: vi.fn().mockResolvedValue([
        { name: 'Chili', calories: 319, protein: 20, mealTime: 'evening', status: 'accepted' },
        { name: 'Pending thing', calories: 999, status: 'pending' },
        { kind: 'group', name: 'Dish', calories: 0 },
      ]) },
    });
    const day = await t.get_day_budget.execute({ userId: 'kc', date: '2026-09-24' });
    expect(day).toMatchObject({ date: '2026-09-24', calories: 1257, protein: 67, zone: 'in-range', complete: true,
      declared: null, remaining: 782, range: { floor: 1200, top: 1791 }, assessment: { finished: true, planState: 'within', energyState: 'below-maintenance' } });
    expect(day.items).toEqual([{ name: 'Chili', calories: 319, protein: 20, mealTime: 'evening' }]);
    expect(day).not.toHaveProperty('goals');
  });

  it('get_budget_range returns the last N days, most recent last, with completeness per day', async () => {
    const getBudgetRange = vi.fn().mockResolvedValue([
      contract('2026-09-22', { zone: 'incomplete', complete: false, food: 700 }),
      { date: '2026-09-23', error: 'NO_WEIGHT_DATA' },
      contract('2026-09-24'),
    ]);
    const t = tools({ budgetService: { getBudgetRange, getBudget: async () => contract('2026-09-24') }, today: () => '2026-09-24' });
    const res = await t.get_budget_range.execute({ userId: 'kc', days: 3 });
    expect(getBudgetRange).toHaveBeenCalledWith('kc', '2026-09-21', '2026-09-23');
    expect(res.days.map(d => [d.date, d.calories ?? null, d.complete ?? null])).toEqual([
      ['2026-09-22', 700, false], ['2026-09-23', null, null], ['2026-09-24', 1257, true],
    ]);
    expect(res.days[1]).toMatchObject({ error: 'NO_WEIGHT_DATA', assessment: { availability: 'unavailable' } });
    expect(res.days[0].assessment).toMatchObject({ finished: true, trustworthy: false });
    expect(res.days[2].assessment).toMatchObject({ finished: false, trustworthy: true, planState: 'within' });
  });

  it('reports an error instead of throwing when the budget is unavailable', async () => {
    const t = tools({ healthStore: null, budgetService: { getBudget: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'GOALS_NOT_CONFIGURED' })) } });
    await expect(t.get_day_budget.execute({ userId: 'kc', date: '2026-09-24' })).resolves.toMatchObject({ error: 'x', code: 'GOALS_NOT_CONFIGURED' });
  });
});

it('keeps reconstruction provenance through the tool and the delivered assignment verdict', async () => {
  const { EndOfDayReport } = await import('../assignments/EndOfDayReport.mjs');
  const t = tools({
    budgetService: { getBudget: async (_u, date) => contract(date, { food: 2500, exercise: 0 }), getBudgetRange: async () => [] },
    healthStore: { loadNutritionData: async () => ({ '2026-09-24': { calories: 3000, reconstructed_calories: 500, protein: 180 } }), loadDayClosedData: async () => ({}) },
    today: () => '2026-09-25', clock: { now: () => new Date('2026-09-25T18:00:00Z') },
  });
  const day = await t.get_day_budget.execute({ userId: 'alice', date: '2026-09-24' });
  expect(day).toMatchObject({ userId: 'alice', provenance: 'reconstructed', protein: null,
    assessment: { trustworthy: false, planState: 'unknown', energyState: 'unknown' } });
  const result = await new EndOfDayReport().validate({ output: '{"should_send":true,"text":"surplus; protein target met"}' }, { todayNutrition: day }, {});
  expect(result.text).toContain('Intake is estimated');
  expect(result.text).not.toMatch(/surplus|target met/);
});

it('keeps provenance unknown when the nutrition source fails', async () => {
  const t = tools({ budgetService: { getBudget: async (_u, date) => contract(date), getBudgetRange: async () => [] },
    healthStore: { loadNutritionData: async () => { throw new Error('offline'); } },
    clock: { now: () => new Date('2026-09-25T18:00:00Z') }, today: () => '2026-09-25' });
  const day = await t.get_day_budget.execute({ userId: 'alice', date: '2026-09-24' });
  expect(day).toMatchObject({ provenance: 'unknown', protein: null, assessment: { trustworthy: false, planState: 'unknown' } });
  const { EndOfDayReport } = await import('../assignments/EndOfDayReport.mjs');
  const result = await new EndOfDayReport().validate({ output: '{"should_send":true,"text":"untrusted prose"}' }, { todayNutrition: day }, {});
  expect(result.text).toContain('Calorie-budget evidence is unavailable.');
  expect(result.text).not.toContain('food log is incomplete');
});
