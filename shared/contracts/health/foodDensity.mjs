import { foodGrams } from './foodQuantity.mjs';
import { isCountedRow } from '../nutrition/countedRows.mjs';
import { DEFAULT_DENSITY_LEVELS } from './densityLevels.mjs';

const knownCalories = row => (
  typeof row?.calories === 'number' && Number.isFinite(row.calories) && row.calories >= 0
    ? row.calories
    : null
);

export function foodDensity(row) {
  if (row?.kind === 'group') return foodDensityOfRows(row.children);
  const grams = foodGrams(row);
  const calories = knownCalories(row);
  return grams === null || calories === null ? null : calories / grams;
}

export function foodDensityOfRows(rows) {
  const foods = (Array.isArray(rows) ? rows : [])
    .filter(row => row?.kind !== 'group' && isCountedRow(row));
  if (!foods.length) return null;

  let sumCalories = 0;
  let sumGrams = 0;
  for (const row of foods) {
    const grams = foodGrams(row);
    const calories = knownCalories(row);
    if (grams === null || calories === null) return null;
    sumGrams += grams;
    sumCalories += calories;
  }
  return sumCalories / sumGrams;
}

export function densityBracket(value, levels = DEFAULT_DENSITY_LEVELS) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Array.isArray(levels) || !levels.length) return null;
  const first = levels[0];
  const last = levels.at(-1);
  if (value < first.kcal_per_g) return { lower: first, upper: first, fraction: 0, outside: 'below' };
  if (value > last.kcal_per_g) return { lower: last, upper: last, fraction: 0, outside: 'above' };

  for (let index = 0; index < levels.length; index += 1) {
    const lower = levels[index];
    if (value === lower.kcal_per_g) return { lower, upper: lower, fraction: 0, outside: null };
    const upper = levels[index + 1];
    if (upper && value < upper.kcal_per_g) {
      return {
        lower,
        upper,
        fraction: Number(((value - lower.kcal_per_g) / (upper.kcal_per_g - lower.kcal_per_g)).toPrecision(15)),
        outside: null,
      };
    }
  }
  return null;
}

export function densityRevision(levels) {
  return JSON.stringify((Array.isArray(levels) ? levels : []).map(row => [
    row.level,
    row.kcal_per_g,
    row.macros?.protein_pct,
    row.macros?.carb_pct,
    row.macros?.fat_pct,
  ]));
}
