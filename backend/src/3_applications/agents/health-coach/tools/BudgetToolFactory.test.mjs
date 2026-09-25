import { describe, it, expect, vi } from 'vitest';
import { BudgetToolFactory } from './BudgetToolFactory.mjs';

const contract = (date, over = {}) => ({
  date, food: 1257, exercise: 248, net: 1009, maintenance: 2291, deficit: 500, deficitSource: 'weekly-rate',
  range: { floor: 1200, top: 1791 }, zone: 'in-range', complete: true, declared: null, remaining: 782,
  macros: { protein: 67 }, sessions: [{}], goals: { secret: true }, ...over,
});

const tools = (deps) => Object.fromEntries(new BudgetToolFactory(deps).createTools().map(t => [t.name, t]));

describe('BudgetToolFactory', () => {
  it('get_day_budget returns the day in the shape the assignments read, with its counted foods', async () => {
    const t = tools({
      budgetService: { getBudget: vi.fn().mockResolvedValue(contract('2026-09-24')) },
      nutriListStore: { findByDate: vi.fn().mockResolvedValue([
        { name: 'Chili', calories: 319, protein: 20, mealTime: 'evening', status: 'accepted' },
        { name: 'Pending thing', calories: 999, status: 'pending' },
        { kind: 'group', name: 'Dish', calories: 0 },
      ]) },
    });
    const day = await t.get_day_budget.execute({ userId: 'kc', date: '2026-09-24' });
    expect(day).toMatchObject({ date: '2026-09-24', calories: 1257, protein: 67, zone: 'in-range', complete: true,
      declared: null, remaining: 782, range: { floor: 1200, top: 1791 } });
    expect(day.items).toEqual([{ name: 'Chili', calories: 319, protein: 20, mealTime: 'evening' }]);
    expect(day).not.toHaveProperty('goals');
  });

  it('get_budget_range returns the last N days, most recent last, with completeness per day', async () => {
    const getBudgetRange = vi.fn().mockResolvedValue([
      contract('2026-09-22', { zone: 'incomplete', complete: false, food: 700 }),
      { date: '2026-09-23', error: 'NO_WEIGHT_DATA' },
      contract('2026-09-24'),
    ]);
    const t = tools({ budgetService: { getBudgetRange }, today: () => '2026-09-24' });
    const res = await t.get_budget_range.execute({ userId: 'kc', days: 3 });
    expect(getBudgetRange).toHaveBeenCalledWith('kc', '2026-09-22', '2026-09-24');
    expect(res.days.map(d => [d.date, d.calories ?? null, d.complete ?? null])).toEqual([
      ['2026-09-22', 700, false], ['2026-09-23', null, null], ['2026-09-24', 1257, true],
    ]);
    expect(res.days[1]).toMatchObject({ error: 'NO_WEIGHT_DATA' });
  });

  it('reports an error instead of throwing when the budget is unavailable', async () => {
    const t = tools({ budgetService: { getBudget: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'GOALS_NOT_CONFIGURED' })) } });
    await expect(t.get_day_budget.execute({ userId: 'kc', date: '2026-09-24' })).resolves.toMatchObject({ error: 'x', code: 'GOALS_NOT_CONFIGURED' });
  });
});
