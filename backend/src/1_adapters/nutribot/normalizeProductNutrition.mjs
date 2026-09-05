const fields = { calories: 'energy-kcal', protein: 'proteins', carbs: 'carbohydrates',
  fat: 'fat', fiber: 'fiber', sugar: 'sugars', sodium: 'sodium', cholesterol: 'cholesterol' };
const numeric = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

/** OFF's suffixed values are explicit bases. Bare values require nutrition_data_per.
 * No mass is inferred for liquid servings; the returned serving remains ml.
 */
export function normalizeProductNutrition(product) {
  const n = product.nutriments || {};
  const quantity = numeric(product.serving_quantity);
  const unit = product.serving_quantity_unit || null;
  const servingKnown = quantity > 0 && ['g', 'ml'].includes(unit);
  const warnings = [];
  if (!servingKnown) warnings.push('Serving size or unit is missing. Check the product label.');
  const serving = { size: servingKnown ? quantity : 1, unit: servingKnown ? unit : 'serving' };
  const nutrition = {}, basis = {}, missing = [];
  for (const [key, source] of Object.entries(fields)) {
    let value = numeric(n[`${source}_serving`]);
    let selectedBasis = 'serving';
    const per100 = numeric(n[`${source}_100g`]);
    if (value === null && servingKnown && per100 !== null) {
      value = per100 * quantity / 100;
      selectedBasis = unit === 'ml' ? '100ml' : '100g';
    }
    if (value === null) {
      const bare = numeric(n[source]);
      if (bare !== null && product.nutrition_data_per === 'serving') value = bare;
      else if (bare !== null && servingKnown && ['100g', '100ml'].includes(product.nutrition_data_per)) {
        value = bare * quantity / 100;
        selectedBasis = product.nutrition_data_per;
      }
    }
    if (value === null) missing.push(key);
    if (numeric(n[`${source}_serving`]) !== null && per100 !== null && servingKnown
      && Math.abs(value - per100 * quantity / 100) > Math.max(1, value * 0.1)) {
      warnings.push(`Conflicting serving and per-100 values for ${key}. Check the label.`);
    }
    const multiplier = ['sodium', 'cholesterol'].includes(key) ? 1000 : 1;
    nutrition[key] = value === null ? null : Math.round(value * multiplier * 1000) / 1000;
    basis[key] = value === null ? null : selectedBasis;
  }
  if (missing.length) warnings.push(`Nutrition unavailable: ${missing.join(', ')}.`);
  return { serving, nutrition, nutritionLookup: { source: 'openfoodfacts', basis, missing, warnings } };
}

/** Nutritionix nf_* fields describe one serving; serving_weight_grams is mass,
 * never a count of bottles/cups. Missing mass stays unknown. */
export function normalizeNutritionixNutrition(food) {
  const keys = { calories: 'nf_calories', protein: 'nf_protein', carbs: 'nf_total_carbohydrate',
    fat: 'nf_total_fat', fiber: 'nf_dietary_fiber', sugar: 'nf_sugars',
    sodium: 'nf_sodium', cholesterol: 'nf_cholesterol' };
  const nutrition = Object.fromEntries(Object.entries(keys).map(([key, source]) => [key, numeric(food[source])]));
  const grams = numeric(food.serving_weight_grams);
  const missing = Object.keys(nutrition).filter(key => nutrition[key] === null);
  const warnings = missing.length ? [`Nutrition unavailable: ${missing.join(', ')}.`] : [];
  return { serving: grams > 0 ? { size: grams, unit: 'g' } : { size: 1, unit: 'serving' },
    nutrition, nutritionLookup: { source: 'nutritionix', basis: 'serving', missing, warnings } };
}
