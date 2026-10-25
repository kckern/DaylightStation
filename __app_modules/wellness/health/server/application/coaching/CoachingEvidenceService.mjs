import { assessBudgetDay } from '../../../portable/contracts/health/budgetAssessment.mjs';
import { summarizeBudgetPeriod } from '../../../portable/contracts/health/budgetPeriod.mjs';
import { classifyDay, closureStatus, fastedMealsOf, resolveMinCalories, shiftDate } from './dayCompleteness.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Reusable coach projection. Lifecycle context is explicit; no hidden clock. */
export function budgetDayView(budget, { today = null, provenance = 'logged', date = budget?.date ?? null } = {}) {
  const assessment = assessBudgetDay(budget, { date, today, provenance });
  if (!budget || budget.error) return { date, ...(budget?.error ? { error: budget.error } : {}), assessment };
  return {
    date, calories: budget.food, protein: assessment.proteinKnown ? budget.macros.protein : null,
    exercise: budget.exercise, net: budget.net, range: budget.range, maintenance: budget.maintenance,
    deficit: budget.deficit, deficitSource: budget.deficitSource, zone: budget.zone,
    complete: budget.complete, declared: budget.declared, fastedMeals: budget.fastedMeals || [],
    remaining: budget.remaining, assessment,
  };
}

/** Period summaries for existing status-block builders, with explicit coverage. */
export function evidenceAverage(days) {
  const period = summarizeBudgetPeriod(days.map(day => day.assessment));
  const proteinDays = days.filter(day => day.assessment.finished && day.assessment.trustworthy && day.assessment.proteinKnown && finite(day.protein));
  return {
    calories: period.averages.food == null ? null : Math.round(period.averages.food),
    protein: proteinDays.length ? Math.round(proteinDays.reduce((sum, day) => sum + day.protein, 0) / proteinDays.length) : null,
    trustedDays: period.coverage.trustedFinished, totalDays: period.coverage.total,
  };
}

/** BudgetService owns all food/exercise/goal assembly; this reader preserves evidence. */
export class CoachingEvidenceService {
  #budgetService; #healthStore; #clock; #timezoneForUser; #minCalories; #logger;

  constructor({ budgetService = null, healthStore, clock = { now: () => new Date() }, timezoneForUser = () => 'America/Los_Angeles', completeness, logger = {} }) {
    this.#budgetService = budgetService;
    this.#healthStore = healthStore;
    this.#clock = clock;
    this.#timezoneForUser = timezoneForUser;
    this.#minCalories = resolveMinCalories(completeness);
    this.#logger = logger;
  }

  async load({ userId, date, historyDays = 7 }) {
    if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 62) throw new RangeError('historyDays must be 1–62');
    const timezone = this.#timezoneForUser(userId) || 'America/Los_Angeles';
    const today = new Date(this.#clock.now()).toLocaleDateString('en-CA', { timeZone: timezone });
    date = date || today;
    const sourceState = {};
    const read = async (dimension, operation, fallback) => {
      try {
        if (!operation) { sourceState[dimension] = 'unavailable'; return fallback; }
        const value = await operation();
        sourceState[dimension] = value == null ? 'unavailable' : 'available';
        return value ?? fallback;
      } catch (error) {
        sourceState[dimension] = 'unavailable';
        this.#logger.warn?.('coaching.evidence.source_unavailable', { userId, date, dimension, error: error.message });
        return fallback;
      }
    };
    const [rows, nutrition, closures, currentBudget] = await Promise.all([
      read('budgetHistory', this.#budgetService?.getBudgetRange && (() => this.#budgetService.getBudgetRange(userId, shiftDate(date, historyDays), shiftDate(date, 1))), []),
      read('nutrition', this.#healthStore?.loadNutritionData && (() => this.#healthStore.loadNutritionData(userId)), {}),
      read('closures', this.#healthStore?.loadDayClosedData && (() => this.#healthStore.loadDayClosedData(userId)), {}),
      read('currentBudget', this.#budgetService?.getBudget && (() => this.#budgetService.getBudget(userId, date)), null),
    ]);
    const byDate = new Map(rows.map(row => [row.date, row]));
    const evidenceDay = (dayDate, budget) => {
      const entry = nutrition[dayDate];
      const provenance = sourceState.nutrition === 'unavailable' ? 'unknown'
        : Number(entry?.reconstructed_calories) > 0 ? 'reconstructed' : 'logged';
      const assessment = assessBudgetDay(budget, { date: dayDate, today, provenance });
      if (provenance === 'unknown') assessment.proteinKnown = false;
      // BudgetService counts measured food only. The summary's backfill must
      // not turn that partial measured amount into a verdict on estimated intake.
      if (provenance === 'reconstructed') {
        assessment.trustworthy = false;
        assessment.planState = 'unknown';
        assessment.energyState = 'unknown';
        assessment.overPlanKcal = null;
        assessment.surplusKcal = null;
      }
      const available = assessment.availability === 'available';
      const calories = available ? assessment.food : finite(entry?.calories) ? entry.calories : null;
      const declared = available ? budget.declared : closureStatus(closures[dayDate]);
      const fastedMeals = available ? budget.fastedMeals || [] : fastedMealsOf(closures[dayDate]);
      const status = available
        ? declared || (provenance === 'reconstructed' ? 'reconstructed'
          : assessment.trustworthy ? 'complete' : calories > 0 ? 'incomplete' : 'unlogged')
        : sourceState.nutrition === 'unavailable' && !declared && !fastedMeals.length ? 'unavailable'
          : classifyDay(entry, closures[dayDate], this.#minCalories);
      return {
        date: dayDate, budget: budget || null, assessment, provenance,
        ...(provenance === 'reconstructed' && finite(entry?.calories) ? { estimatedCalories: entry.calories } : {}),
        calories: finite(calories) ? Math.round(calories) : null,
        protein: assessment.proteinKnown ? budget.macros.protein : null,
        status, ...(fastedMeals.length ? { fastedMeals } : {}),
        // Summary-only logging amounts are display facts, never assessed intake.
        ...(!available && provenance !== 'reconstructed' && finite(entry?.protein) ? { protein: entry.protein } : {}),
      };
    };
    const days = Array.from({ length: historyDays }, (_, index) => {
      const dayDate = shiftDate(date, historyDays - index);
      return evidenceDay(dayDate, byDate.get(dayDate));
    });
    if (sourceState.budgetHistory === 'available' && days.some(day => day.assessment.availability === 'unavailable')) sourceState.budgetHistory = 'partial';
    const current = evidenceDay(date, currentBudget);
    if (current.assessment.availability === 'unavailable') sourceState.currentBudget = 'unavailable';
    return { userId, date, today, timezone, current, days, period: summarizeBudgetPeriod(days.map(day => day.assessment)), sourceState };
  }
}
