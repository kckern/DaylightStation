import { budgetLines } from '../../portable/contracts/health/budgetTiers.mjs';

const n = value => Math.round(value).toLocaleString('en-US');

/** Independent comparisons with the food-scale goal and estimated expenditure. */
export function budgetPresentation(budget, { finished = false } = {}) {
  const { food, floor, ceiling, even } = budgetLines(budget);
  const position = food > ceiling ? { value: Math.round(food - ceiling), text: 'over goal range' }
    : food < floor ? { value: Math.round(floor - food), text: 'under goal range' }
      : { value: null, text: 'Within goal range' };
  const tone = even != null && food > even ? 'past-even'
    : even != null && food === even ? 'even'
      : food > ceiling ? 'over'
        : food < floor ? (finished ? 'under-finished' : 'under') : 'in-range';
  const balance = even == null ? 'Estimated calorie balance unavailable'
    : food === even ? 'At estimated break-even'
      : `${n(Math.abs(even - food))} kcal estimated ${food < even ? 'deficit' : 'surplus'}`;
  return { tone, position, balance };
}
