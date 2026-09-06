/** Food mass is independent of the original household/serving quantity. */
export function foodGrams(row) {
  if ('grams' in Object(row ?? {})) {
    return typeof row.grams === 'number' && Number.isFinite(row.grams) && row.grams > 0 ? row.grams : null;
  }
  return ['g', 'gram', 'grams'].includes(String(row?.unit).toLowerCase())
    && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0
    ? row.amount : null;
}

/** The current ledger quantity wins over the historical capture quantity.
 * Volume and servings are useful quantities, but are never assumed to be mass. */
export function foodPortion(row) {
  if (row?.kind === 'group' && row.children?.length) {
    const masses = row.children.map(foodGrams);
    return { value: masses.every(value => value !== null) ? masses.reduce((a, b) => a + b, 0) : null, unit: 'g' };
  }
  const grams = foodGrams(row);
  if (grams !== null) return { value: grams, unit: 'g' };
  const unit = String(row?.unit || 'serving').toLowerCase();
  const value = typeof row?.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0 ? row.amount : null;
  return { value, unit: ['gram', 'grams'].includes(unit) ? 'g' : unit };
}

export function formatFoodPortion(row) {
  const { value, unit } = foodPortion(row);
  return value === null ? '—' : `${unit === 'g' ? Math.round(value) : Number(value.toFixed(1))} ${unit}`;
}

export function portionFactor(row, portion) {
  const current = foodPortion(row);
  if (!current.value || portion?.unit !== current.unit || !Number.isFinite(portion.value) || portion.value <= 0) {
    throw Object.assign(new Error('A positive portion in the existing unit is required'), { status: 400 });
  }
  return portion.value / current.value;
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
  const grams = row.kind === 'group' && row.children?.length ? foodPortion(row).value : foodGrams(row);
  changes.grams = grams === null ? null : Math.round(grams * factor * 100) / 100;
  if (changes.grams !== null) Object.assign(changes, { amount: changes.grams, unit: 'g' });
  else if (typeof row.amount === 'number' && row.amount > 0) changes.amount = Math.round(row.amount * factor * 100) / 100;
  if (Object.values(changes).some(value => typeof value === 'number' && !Number.isFinite(value))) {
    throw Object.assign(new Error('The requested portion is too large'), { status: 400 });
  }
  return changes;
}
