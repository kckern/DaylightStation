import { portionFactor, scaleFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { NUTRIENT_KEYS } from '@shared-contracts/health/foodQuantity.mjs';
import { entryId } from './entryCommands.js';

/** A draft overlays the latest read model with its ORIGINAL row snapshots.
 * Polls can update unrelated foods, but cannot change a gesture's baseline. */
export function projectPortion(items, budget, draft) {
  if (!draft) return { items, budget };
  const factor = portionFactor(draft.row, draft.portion);
  const members = [draft.row, ...(draft.row.children || [])];
  const replacements = new Map(members.map(row => [entryId(row), { ...row, ...scaleFoodPortion(row, factor) }]));
  const projected = items.map(row => replacements.get(entryId(row)) || row);
  if (!budget) return { items: projected, budget };
  const delta = sumCounted(projected, 'calories') - sumCounted(items, 'calories');
  return { items: projected, budget: { ...budget,
    food: budget.food + delta, remaining: budget.remaining - delta,
    status: budget.remaining - delta < 0 ? 'over' : 'under',
    macros: { ...budget.macros, ...Object.fromEntries(NUTRIENT_KEYS.filter(key => key !== 'calories').map(key =>
      [key, (budget.macros?.[key] || 0) + sumCounted(projected, key) - sumCounted(items, key)])) },
  } };
}
