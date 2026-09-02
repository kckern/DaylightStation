//
// Daily calorie budget: Mifflin-St Jeor BMR x activity baseline minus the
// weekly-rate deficit, floored. Pure and deterministic — age arrives as a
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

export function computeDailyBudget({
  weightLbs, heightIn, ageYears, sex,
  activityBaseline = 1.35, weeklyRateLbs = 1, budgetFloor = 1200,
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
  const budget = Math.round(tdee - (weeklyRateLbs * KCAL_PER_LB) / 7);
  return Math.max(budget, Math.round(budgetFloor));
}

export default computeDailyBudget;
