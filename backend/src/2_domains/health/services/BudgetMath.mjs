//
// Daily calorie budget: Mifflin-St Jeor BMR x activity baseline minus the
// day's planned deficit (solved from a target date, or the weekly rate), floored. Pure and deterministic — age arrives as a
// number (domains carry no clock).

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;
const KCAL_PER_LB = 3500;

const finite = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    const err = new Error(`INVALID_BUDGET_INPUT: ${name} must be a finite number`);
    err.code = 'INVALID_BUDGET_INPUT';
    throw err;
  }
  return v;
};

const DAY_MS = 86400000;
const dayNumber = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

/** Whole calendar days from `fromISO` to `toISO` (YYYY-MM-DD); DST-proof. */
export function daysBetween(fromISO, toISO) {
  return Math.round(dayNumber(toISO) - dayNumber(fromISO));
}

/**
 * The day's planned deficit. Solved from "lose to targetWeightLbs by
 * targetDate" while that plan is live for `day`, capped at maxWeeklyRateLbs;
 * zero once the target weight is reached; otherwise the fixed weekly rate.
 */
export function solveDailyDeficit({
  weightLbs, targetWeightLbs = null, targetDate = null, day,
  weeklyRateLbs = 1, maxWeeklyRateLbs = 2,
}) {
  finite(weightLbs, 'weightLbs');
  finite(weeklyRateLbs, 'weeklyRateLbs');
  finite(maxWeeklyRateLbs, 'maxWeeklyRateLbs');
  const hasTarget = typeof targetWeightLbs === 'number' && Number.isFinite(targetWeightLbs);
  if (hasTarget && weightLbs <= targetWeightLbs) return { deficit: 0, deficitSource: 'at-target' };
  if (hasTarget && targetDate && day && day < targetDate) {
    const solved = ((weightLbs - targetWeightLbs) * KCAL_PER_LB) / daysBetween(day, targetDate);
    const cap = (maxWeeklyRateLbs * KCAL_PER_LB) / 7;
    return { deficit: Math.round(Math.min(solved, cap)), deficitSource: 'target-date' };
  }
  return { deficit: Math.round((weeklyRateLbs * KCAL_PER_LB) / 7), deficitSource: 'weekly-rate' };
}

export function computeDailyBudget(input) {
  return computeDailyEnergy(input).budget;
}

/**
 * The same equation with its break-even kept: `maintenance` is the day's
 * estimated burn (BMR x activity baseline) — eating exactly that holds weight —
 * and `budget` is maintenance less the weekly-rate deficit, floored.
 */
export function computeDailyEnergy({
  weightLbs, heightIn, ageYears, sex,
  activityBaseline = 1.35, weeklyRateLbs = 1, budgetFloor = 1200, deficit = null,
}) {
  finite(weightLbs, 'weightLbs');
  finite(heightIn, 'heightIn');
  finite(ageYears, 'ageYears');
  finite(activityBaseline, 'activityBaseline');
  finite(weeklyRateLbs, 'weeklyRateLbs');
  finite(budgetFloor, 'budgetFloor');
  if (sex !== 'male' && sex !== 'female') {
    const err = new Error('INVALID_BUDGET_INPUT: sex must be male|female');
    err.code = 'INVALID_BUDGET_INPUT';
    throw err;
  }

  const kg = weightLbs * LB_TO_KG;
  const cm = heightIn * IN_TO_CM;
  const bmr = 10 * kg + 6.25 * cm - 5 * ageYears + (sex === 'male' ? 5 : -161);
  const tdee = bmr * activityBaseline;
  // A solved deficit (solveDailyDeficit) replaces the fixed weekly rate.
  const daily = deficit == null ? (weeklyRateLbs * KCAL_PER_LB) / 7 : finite(deficit, 'deficit');
  const budget = Math.round(tdee - daily);
  return { maintenance: Math.round(tdee), budget: Math.max(budget, Math.round(budgetFloor)) };
}

export default computeDailyBudget;
