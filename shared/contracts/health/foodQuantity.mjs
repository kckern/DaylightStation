/** Food mass is independent of the original household/serving quantity. */
export function foodGrams(row) {
  if ('grams' in Object(row ?? {})) {
    return typeof row.grams === 'number' && Number.isFinite(row.grams) && row.grams > 0 ? row.grams : null;
  }
  return ['g', 'gram', 'grams'].includes(String(row?.unit).toLowerCase())
    && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0
    ? row.amount : null;
}

/** Only for original capture quantities, never legacy ledger amounts that may
 * already have been overwritten by grams while retaining a serving unit. */
export function capturedFoodGrams(row) {
  if ('grams' in Object(row ?? {})) return foodGrams(row);
  const factor = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 }[String(row?.unit).toLowerCase()];
  const amount = row?.quantity ?? row?.amount;
  return factor && typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount * factor : null;
}

/** Capture boundary only: which keys did the source actually supply? */
export function capturedNutrientProvenance(row, source, grams = foodGrams(row)) {
  return Object.fromEntries(MICRO_KEYS.filter(key => typeof row[key] === 'number' && Number.isFinite(row[key]))
    .map(key => [key, { source, grams }]));
}

export const NUTRIENT_KEYS = Object.freeze(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol']);
export const MICRO_KEYS = Object.freeze(['fiber', 'sugar', 'sodium', 'cholesterol']);

/** All values on an entry describe that entry's portion, including known zeroes. */
export function scaleFoodPortion(row, factor) {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Portion factor must be positive');
  const changes = {};
  for (const key of NUTRIENT_KEYS) {
    if (typeof row[key] === 'number' && Number.isFinite(row[key])) {
      changes[key] = Math.round(row[key] * factor * 100) / 100;
    }
  }
  const grams = foodGrams(row);
  changes.grams = grams === null ? null : Math.round(grams * factor * 100) / 100;
  if (changes.grams !== null) Object.assign(changes, { amount: changes.grams, unit: 'g' });
  else if (typeof row.amount === 'number' && row.amount > 0) changes.amount = Math.round(row.amount * factor * 100) / 100;
  return changes;
}
