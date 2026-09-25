// backend/src/3_applications/agents/health-coach/tools/BudgetToolFactory.mjs
//
// The health budget contract (BudgetService) as agent tools: the SAME floor,
// top, counted food, zone and completeness the Today bar shows. A day is
// complete only when it reached the floor or was declared done/fasted — never
// because of the time of day — so these tools are how the coach tells
// "under-logged" from "a real deficit".
//
// Shapes deliberately match what the assignments already read from the
// retired get_today_nutrition / get_nutrition_history tools: a day has
// `calories` and `protein`; a history is `{ days: [...] }`, oldest first.

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';
import { isCountedRow } from '#shared/contracts/nutrition/countedRows.mjs';

const MAX_DAYS = 62;

const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The contract fields a coach needs — no goals document, no raw sessions. */
export function dayView(b) {
  if (!b || b.error) return b ? { date: b.date, error: b.error } : null;
  return {
    date: b.date,
    calories: b.food,
    protein: b.macros?.protein ?? null,
    exercise: b.exercise,
    net: b.net,
    range: b.range,
    maintenance: b.maintenance,
    deficit: b.deficit,
    deficitSource: b.deficitSource,
    zone: b.zone,
    complete: b.complete,
    declared: b.declared,
    remaining: b.remaining,
  };
}

export class BudgetToolFactory extends ToolFactory {
  static domain = 'budget';

  createTools() {
    const { budgetService, nutriListStore = null, today = () => new Date().toLocaleDateString('en-CA'), logger = console } = this.deps;
    const failed = (err) => ({ error: err.message, code: err.code || null });

    return [
      createTool({
        name: 'get_day_budget',
        description: 'One day\'s calorie budget: food eaten (calories, protein), exercise, net, the goal range '
          + '{floor, top}, break-even, the zone (incomplete|declared|in-range|over|past-even), whether the log is '
          + 'COMPLETE (reached the floor or declared done/fasted — never assumed from the time of day), and the '
          + 'counted foods. An incomplete day is missing data, not a deficit.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } },
          required: ['userId', 'date'],
        },
        execute: async ({ userId, date }) => {
          try {
            const [budget, rows] = await Promise.all([
              budgetService.getBudget(userId, date),
              nutriListStore ? nutriListStore.findByDate(userId, date).catch(() => []) : [],
            ]);
            const items = (rows || []).filter(r => isCountedRow(r) && r?.kind !== 'group')
              .map(r => ({ name: r.name || r.item || null, calories: r.calories ?? null, protein: r.protein ?? null, mealTime: r.mealTime ?? null }));
            return { ...dayView(budget), items };
          } catch (err) {
            logger.warn?.('health-coach.tool.get-day-budget.failed', { userId, date, error: err.message });
            return failed(err);
          }
        },
      }),

      createTool({
        name: 'get_budget_range',
        description: 'The last N days of the calorie budget (oldest first), each with calories, protein, zone and '
          + 'COMPLETE (floor reached or declared). Averages and trends should use complete days only.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' }, days: { type: 'number', description: 'How many days, ending today (max 62)' } },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const n = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 7)));
            const to = today();
            const list = await budgetService.getBudgetRange(userId, shiftDate(to, -(n - 1)), to);
            return { days: (list || []).map(dayView) };
          } catch (err) {
            logger.warn?.('health-coach.tool.get-budget-range.failed', { userId, error: err.message });
            return failed(err);
          }
        },
      }),
    ];
  }
}

export default BudgetToolFactory;
