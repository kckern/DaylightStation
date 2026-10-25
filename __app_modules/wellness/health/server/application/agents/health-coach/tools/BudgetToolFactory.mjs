// __backend/src/3_applications/agents/health-coach/tools/BudgetToolFactory.mjs
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

import { ToolFactory } from "../../../../../../../../__capabilities/agent-runtime/server/application/framework/ToolFactory.mjs";
import { createTool } from "../../../../../../../../__capabilities/agent-runtime/server/application/ports/ITool.mjs";
import { isCountedRow } from '../../../../../portable/contracts/nutrition/countedRows.mjs';

import { CoachingEvidenceService, budgetDayView } from '../../../coaching/CoachingEvidenceService.mjs';

const MAX_DAYS = 62;

const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export class BudgetToolFactory extends ToolFactory {
  static domain = 'budget';

  createTools() {
    const { budgetService, healthStore, nutriListStore = null, today = () => new Date().toLocaleDateString('en-CA'), logger = {} } = this.deps;
    const evidenceService = this.deps.evidenceService || (healthStore ? new CoachingEvidenceService({
      budgetService, healthStore, clock: this.deps.clock, timezoneForUser: this.deps.timezoneForUser, logger,
    }) : null);
    const project = (day, evidence) => {
      const { budget, ...facts } = day;
      return { ...budgetDayView(budget, { today: evidence.today, date: day.date, userId: evidence.userId, provenance: day.provenance }),
        ...facts, today: evidence.today, userId: evidence.userId };
    };
    const failed = (err) => ({ error: err.message, code: err.code || null });

    return [
      createTool({
        name: 'get_day_budget',
        description: 'One day of canonical budget evidence: logged food, known or unknown protein, maintenance, '
          + 'exercise credited once, net, assessment, lifecycle, provenance and counted foods. '
          + 'assessment.floorFood is the food logging floor, not an intake target. Compare food to the '
          + 'exercise-adjusted assessment.planFood and breakEvenFood. Incomplete or reconstructed logs support no intake verdict.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } },
          required: ['userId', 'date'],
        },
        execute: async ({ userId, date }) => {
          try {
            const [loaded, rows] = await Promise.all([
              evidenceService ? evidenceService.load({ userId, date, historyDays: 1 }) : budgetService.getBudget(userId, date),
              nutriListStore ? nutriListStore.findByDate(userId, date).catch(() => []) : [],
            ]);
            const items = (rows || []).filter(r => isCountedRow(r) && r?.kind !== 'group')
              .map(r => ({ name: r.name || r.item || null, calories: r.calories ?? null, protein: r.protein ?? null, mealTime: r.mealTime ?? null }));
            return { ...(evidenceService ? project(loaded.current, loaded) : budgetDayView(loaded, { today: today(userId), userId, provenance: 'unknown' })), items };
          } catch (err) {
            logger.warn?.('health-coach.tool.get-day-budget.failed', { userId, date, error: err.message });
            return failed(err);
          }
        },
      }),

      createTool({
        name: 'get_budget_range',
        description: 'Exactly the last N calendar dates ending today (oldest first), with canonical assessment, '
          + 'provenance, finished lifecycle, logging floor, exercise-adjusted plan and explicit unknowns. '
          + 'Use matched trustworthy finished dates for period comparisons; disclose coverage and current configured goal basis.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' }, days: { type: 'number', description: 'How many days, ending today (max 62)' } },
          required: ['userId'],
        },
        execute: async ({ userId, days = 7 }) => {
          try {
            const n = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 7)));
            const to = today(userId);
            if (evidenceService) {
              const evidence = await evidenceService.load({ userId, date: to, historyDays: n });
              return { userId, today: evidence.today, days: [...evidence.days, evidence.current].slice(-n).map(day => project(day, evidence)) };
            }
            const list = await budgetService.getBudgetRange(userId, shiftDate(to, -(n - 1)), to);
            return { days: (list || []).map(budget => budgetDayView(budget, { today: to, userId, provenance: 'unknown' })) };
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
