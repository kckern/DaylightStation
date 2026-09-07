import { foodGrams, foodPortion, scaleFoodPortion } from './foodQuantity.mjs';

const MACROS = { protein: 4, carbs: 4, fat: 9 };
const idOf = row => row.uuid || row.id;
const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const fail = message => { throw Object.assign(new Error(message), { status: 422, code: 'INVALID_NUTRITION_EDIT' }); };
const nameOf = row => row.name || row.item || row.label || idOf(row);
const membersOf = row => row.kind === 'group' ? row.children || [] : [row];
const round = value => Math.round(value * 100) / 100;

export function numericFoodValue(row, field) {
  if (field === 'portion') return foodPortion(row).value;
  if (field === 'grams') return row.kind === 'group' ? foodPortion(row).value : foodGrams(row);
  const members = membersOf(row);
  if (!members.length) return null;
  const key = field === 'density' ? 'calories' : field;
  if (!members.every(item => known(item[key]))) return null;
  const total = members.reduce((sum, item) => sum + item[key], 0);
  if (field !== 'density') return total;
  if (!members.every(item => foodGrams(item) !== null)) return null;
  return total / members.reduce((sum, item) => sum + foodGrams(item), 0);
}

/** Pure, shared by the gesture preview and the versioned server command.
 * Patches contain portion changes OR composition corrections, never both.
 * A group parent never acquires additive nutrition totals. */
export function numericFoodPatches(row, { field, value }) {
  if (!['portion', 'grams', 'calories', 'density', ...Object.keys(MACROS)].includes(field)
    || !known(value)) fail('A finite non-negative nutrition value is required');
  const members = membersOf(row);
  if (!members.length || members.some(item => item.kind === 'group')) fail('Edit the individual ingredients of this dish first');
  const patches = new Map([[idOf(row), {}]]);
  const current = numericFoodValue(row, field);
  if (current === null) {
    const key = field === 'density' ? 'calories' : field;
    const missing = members.find(item => !known(item[key])) || members.find(item => foodGrams(item) === null) || row;
    fail(`Enter an exact ${field} value for ${nameOf(missing)} first`);
  }
  if (field === 'portion' || field === 'grams' || field === 'calories') {
    if (!(current > 0 && value > 0)) fail('A positive existing and target portion or calorie value is required');
    for (const item of [row, ...members]) patches.set(idOf(item), scaleFoodPortion(item, value / current));
  } else if (field === 'density') {
    if (!(current > 0)) fail('Enter ingredient calories first to establish density ratios');
    for (const item of members) {
      patches.set(idOf(item), Object.fromEntries(['calories', ...Object.keys(MACROS)]
        .filter(key => known(item[key])).map(key => [key, round(item[key] * value / current)])));
    }
  } else {
    const weights = members.length === 1 ? [1] : current > 0 ? members.map(item => item[field]) : members.map(foodGrams);
    if (weights.some(weight => weight === null)) fail('Enter ingredient weights first to distribute a zero-macro increase');
    const weight = weights.reduce((sum, item) => sum + item, 0);
    let allocated = 0;
    let cumulativeWeight = 0;
    members.forEach((item, index) => {
      // The final member receives the rounding remainder, so the displayed
      // group target is also the sum of the persisted ingredients.
      cumulativeWeight += weights[index];
      const cumulativeTarget = index === members.length - 1 ? round(value) : round(value * cumulativeWeight / weight);
      const next = round(cumulativeTarget - allocated);
      allocated = round(allocated + next);
      const patch = { [field]: next };
      if (known(item.calories)) patch.calories = round(item.calories + (next - item[field]) * MACROS[field]);
      patches.set(idOf(item), patch);
    });
  }
  for (const patch of patches.values()) {
    if (Object.values(patch).some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) {
      fail('This edit would create negative or non-finite nutrition');
    }
  }
  return patches;
}
