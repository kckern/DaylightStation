// Pure facts projected from a BudgetService day. The shared budget rules remain
// the owners of completeness, exercise credit and food-scale boundaries.
import { budgetLines } from './budgetTiers.mjs';
import { zoneFor } from './budgetZone.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A skipped meal can complete a log, but only a day closure finishes today. */
export function isFinishedDay({ date, today, declared } = {}) {
  return Boolean(date && today && date < today) || declared === 'done' || declared === 'fasting';
}

/**
 * @param {object|null} budget - the assembled BudgetService day (not raw food rows)
 * @param {{date?: string, today?: string, provenance?: string}} context - explicit local dates
 * Unknown facts stay null. Trust describes logging completeness, independently
 * of whether the day has finished. Live positions may be known; period verdicts
 * require a finished day as well.
 */
export function assessBudgetDay(budget, { date = null, today = null, provenance = 'logged' } = {}) {
  const available = Boolean(budget && typeof budget === 'object' && !Array.isArray(budget)
    && !(budget instanceof Error) && !budget.error);
  const result = {
    date, availability: available ? 'available' : 'unavailable',
    finished: isFinishedDay({ date, today, declared: available ? budget.declared : null }),
    trustworthy: false, proteinKnown: false, goalBasis: available ? budget.goalBasis ?? null : null,
    food: null, exercise: null, net: null, floorFood: null, basePlan: null,
    planFood: null, breakEvenFood: null, planState: 'unknown', energyState: 'unknown',
    overPlanKcal: null, surplusKcal: null,
  };
  if (!available) return result;

  const lines = budgetLines(budget);
  const position = zoneFor(budget);
  const foodKnown = finite(budget.food);
  const exerciseKnown = finite(budget.exercise);
  const floorKnown = finite(budget.range?.floor);
  const topKnown = finite(budget.range?.top);
  const closed = budget.declared === 'done' || budget.declared === 'fasting';
  const skipped = Array.isArray(budget.fastedMeals) && budget.fastedMeals.length > 0;
  result.food = foodKnown ? lines.food : null;
  result.exercise = exerciseKnown ? lines.exercise : null;
  result.net = foodKnown && exerciseKnown ? position.net : null;
  result.floorFood = floorKnown ? lines.floor : null;
  // Missing exercise must not silently cap a known base plan using a zero burn.
  result.basePlan = topKnown ? (exerciseKnown || lines.even == null ? lines.top : budget.range.top) : null;
  result.planFood = topKnown && exerciseKnown ? lines.ceiling : null;
  result.breakEvenFood = exerciseKnown ? lines.even : null;
  result.trustworthy = foodKnown && (floorKnown || closed || skipped) && position.complete;
  result.proteinKnown = provenance !== 'reconstructed' && finite(budget.macros?.protein);

  if (!result.trustworthy) return result;
  if (result.planFood != null) {
    result.planState = lines.food > result.planFood ? 'over' : 'within';
    result.overPlanKcal = Math.max(0, lines.food - result.planFood);
  }
  if (result.breakEvenFood != null) {
    result.energyState = lines.food > result.breakEvenFood ? 'surplus'
      : lines.food === result.breakEvenFood ? 'at-maintenance' : 'below-maintenance';
    result.surplusKcal = Math.max(0, lines.food - result.breakEvenFood);
  }
  return result;
}
