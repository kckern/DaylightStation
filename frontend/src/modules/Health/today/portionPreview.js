import { portionFactor, scaleFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { NUTRIENT_KEYS } from '@shared-contracts/health/foodQuantity.mjs';
import { entryId } from './entryCommands.js';
import { numericFoodPatches } from '@shared-contracts/health/foodNumericEdit.mjs';
import { zoneFor, statusForZone } from '@shared-contracts/health/budgetZone.mjs';

/** A draft overlays the latest read model with its ORIGINAL row snapshots.
 * Polls can update unrelated foods, but cannot change a gesture's baseline. */
export function projectPortion(items, budget, draft) {
  if (!draft) return { items, budget };
  const members = [draft.row, ...(draft.row.children || [])];
  const patches = draft.numericEdit ? numericFoodPatches(draft.row, draft.numericEdit)
    : new Map(members.map(row => [entryId(row), scaleFoodPortion(row, portionFactor(draft.row, draft.portion))]));
  const replacements = new Map(members.map(row => [entryId(row), { ...row, ...patches.get(entryId(row)) }]));
  const projected = items.map(row => replacements.get(entryId(row)) || row);
  if (!budget) return { items: projected, budget };
  const delta = sumCounted(projected, 'calories') - sumCounted(items, 'calories');
  const food = budget.food + delta;
  // The same zone rule the server applies, so a live drag recolours exactly as
  // the reloaded day will. A budget from an older server (no range) keeps the
  // old arithmetic.
  const zoned = budget.range
    ? zoneFor({ food, exercise: budget.exercise, maintenance: budget.maintenance, range: budget.range, declared: budget.declared, fastedMeals: budget.fastedMeals })
    : null;
  return { items: projected, budget: { ...budget,
    food,
    ...(zoned
      ? { zone: zoned.zone, remaining: zoned.remaining, net: zoned.net, complete: zoned.complete, status: statusForZone(zoned.zone) }
      : { remaining: budget.remaining - delta, status: budget.remaining - delta < 0 ? 'over' : 'under' }),
    macros: { ...budget.macros, ...Object.fromEntries(NUTRIENT_KEYS.filter(key => key !== 'calories').map(key =>
      [key, (budget.macros?.[key] || 0) + sumCounted(projected, key) - sumCounted(items, key)])) },
  } };
}
