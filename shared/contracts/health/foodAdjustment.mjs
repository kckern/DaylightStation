import { DEFAULT_DENSITY_LEVELS } from './densityLevels.mjs';
import { densityBracket, foodDensity } from './foodDensity.mjs';
import { foodGrams, foodPortion, NUTRIENT_KEYS, scaleFoodPortion } from './foodQuantity.mjs';
import { isCountedRow } from '../nutrition/countedRows.mjs';

const FIELDS = new Set(['portion', 'protein', 'carbs', 'fat', 'calories', 'density']);
const MACRO_COEFFICIENTS = Object.freeze({ protein: 4, carbs: 4, fat: 9 });
const MACROS = Object.keys(MACRO_COEFFICIENTS);
const PORTION_KEYS = new Set([...NUTRIENT_KEYS, 'grams', 'amount', 'unit']);

const known = value => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

const entryId = row => row?.uuid ?? row?.id;

const groupMembers = row => (
  Array.isArray(row?.children)
    ? row.children.filter(child => child?.kind !== 'group' && isCountedRow(child))
    : []
);

const aggregate = (rows, field) => {
  if (!rows.length) return null;
  const values = rows.map(row => known(row?.[field]));
  return values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
};

const effectivePortionRow = row => (
  row?.kind === 'group' ? { kind: 'group', children: groupMembers(row) } : row
);

export function adjustmentValue(row, field) {
  if (!FIELDS.has(field)) return null;
  if (field === 'portion') return foodPortion(effectivePortionRow(row)).value;
  if (field === 'density') {
    return foodDensity(row?.kind === 'group' ? { kind: 'group', children: groupMembers(row) } : row);
  }
  if (row?.kind === 'group') return aggregate(groupMembers(row), field);
  return known(row?.[field]);
}

export function canAdjustFood(row, field) {
  const value = adjustmentValue(row, field);
  if (value === null) return false;
  if (row?.kind !== 'group') {
    if (field === 'portion') return value > 0;
    if (field === 'density') return foodGrams(row) !== null;
    if (field in MACRO_COEFFICIENTS) return known(row?.calories) !== null;
    return true;
  }

  const members = groupMembers(row);
  if (!members.length) return false;
  if (field === 'portion') return value > 0;
  if (field === 'density') {
    return value !== null && aggregate(members, 'calories') > 0
      && members.every(member => foodGrams(member) !== null);
  }
  if (field === 'calories') return value > 0;
  return value > 0 && aggregate(members, 'calories') !== null;
}

const macroMinimumCents = (macro, calories, coefficient) => {
  const continuous = Math.max(0, macro - calories / coefficient);
  let cents = Math.ceil(continuous * 100);
  if (!Number.isSafeInteger(cents)) return Infinity;
  const isFeasible = candidate => calories + coefficient * (candidate / 100 - macro) >= 0;
  while (cents > 0 && isFeasible(cents - 1)) cents -= 1;
  while (!isFeasible(cents)) cents += 1;
  return cents;
};

const proportionalFloorMinimumCents = (childCents, childBaseline, totalBaseline) => {
  let totalCents = Math.ceil(childCents * totalBaseline / childBaseline);
  if (!Number.isSafeInteger(totalCents)) return Infinity;
  const allocatedFloor = candidate => Math.floor(candidate * childBaseline / totalBaseline);
  while (totalCents > 0 && allocatedFloor(totalCents - 1) >= childCents) totalCents -= 1;
  while (allocatedFloor(totalCents) < childCents) totalCents += 1;
  return totalCents;
};

export function adjustmentMinimum(row, field) {
  if (field === 'portion') {
    return foodPortion(effectivePortionRow(row)).unit === 'g' ? 1 : 0.1;
  }
  const coefficient = MACRO_COEFFICIENTS[field];
  if (!coefficient) return 0;

  if (row?.kind !== 'group') {
    const macro = known(row?.[field]);
    const calories = known(row?.calories);
    return macro === null || calories === null ? 0 : macroMinimumCents(macro, calories, coefficient) / 100;
  }

  const members = groupMembers(row);
  const total = aggregate(members, field);
  if (!(total > 0) || aggregate(members, 'calories') === null) return 0;
  return members.reduce((minimum, member) => {
    const macro = known(member[field]);
    if (!(macro > 0)) return minimum;
    const childCents = macroMinimumCents(macro, member.calories, coefficient);
    return Math.max(minimum, proportionalFloorMinimumCents(childCents, macro, total));
  }, 0) / 100;
}

const roundStored = value => Math.round(value * 100) / 100;

const checkedStored = value => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Adjustment is outside stored numeric range');
  const rounded = roundStored(value);
  if (!Number.isFinite(rounded) || rounded < 0) throw new RangeError('Adjustment is outside stored numeric range');
  return rounded;
};

const changedValues = (row, projected, allowed = PORTION_KEYS) => Object.fromEntries(
  Object.entries(projected).filter(([key, value]) => allowed.has(key)
    && ((typeof value === 'number' && Number.isFinite(value)) || (key === 'unit' && typeof value === 'string'))
    && row?.[key] !== value),
);

const patch = (row, changes) => {
  const id = entryId(row);
  if (id === null || id === undefined) throw new RangeError('Every adjusted food requires an entry ID');
  return Object.keys(changes).length ? { id, changes } : null;
};

const allocateCents = (target, rows, field) => {
  const targetCents = Math.round(target * 100);
  if (!Number.isSafeInteger(targetCents) || targetCents < 0) {
    throw new RangeError('Adjustment is outside stored numeric range');
  }
  const total = rows.reduce((sum, row) => sum + row[field], 0);
  const allocations = rows.map(row => {
    const exact = targetCents * row[field] / total;
    const cents = Math.floor(exact);
    return { row, cents, fraction: exact - cents };
  });
  let remainder = targetCents - allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
  const priority = [...allocations].sort((a, b) => (
    b.fraction - a.fraction || String(entryId(a.row)).localeCompare(String(entryId(b.row)))
  ));
  for (let index = 0; index < remainder; index += 1) priority[index].cents += 1;
  return new Map(allocations.map(allocation => [allocation.row, allocation.cents / 100]));
};

const validateLevels = levels => {
  if (!Array.isArray(levels) || !levels.length) throw new RangeError('A valid density ladder is required');
  let prior = -Infinity;
  for (const level of levels) {
    if (typeof level?.kcal_per_g !== 'number' || !Number.isFinite(level.kcal_per_g)
      || level.kcal_per_g <= prior) {
      throw new RangeError('Density ladder positions must be finite and strictly increasing');
    }
    prior = level.kcal_per_g;
    for (const key of ['protein_pct', 'carb_pct', 'fat_pct']) {
      const value = level?.macros?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError('Density ladder macro shares must be finite and non-negative');
      }
    }
  }
};

const ladderShares = (density, levels) => {
  const bracket = densityBracket(density, levels);
  if (!bracket) throw new RangeError('A valid density ladder is required');
  const read = (level, key) => level.macros[key] / 100;
  const fraction = bracket.fraction;
  return [
    ['protein_pct'], ['carb_pct'], ['fat_pct'],
  ].map(([key]) => read(bracket.lower, key) + (read(bracket.upper, key) - read(bracket.lower, key)) * fraction);
};

const ladderDelta = (oldDensity, newDensity, levels) => {
  if (oldDensity === null || newDensity === null) return [0, 0, 0];
  validateLevels(levels);
  const before = ladderShares(oldDensity, levels);
  const after = ladderShares(newDensity, levels);
  return after.map((share, index) => share - before[index]);
};

const calorieChanges = (row, targetCalories, shareDelta) => {
  const oldCalories = known(row.calories);
  const target = checkedStored(targetCalories);
  const changes = {};
  if (oldCalories !== target) changes.calories = target;

  const values = MACROS.map(field => known(row[field]));
  if (oldCalories === 0) return changes;
  if (values.some(value => value === null)) {
    const factor = target / oldCalories;
    MACROS.forEach((field, index) => {
      if (values[index] === null) return;
      const projected = checkedStored(values[index] * factor);
      if (row[field] !== projected) changes[field] = projected;
    });
    return changes;
  }

  const energy = values.reduce((sum, value, index) => sum + value * MACRO_COEFFICIENTS[MACROS[index]], 0);
  if (energy === 0) return changes;
  const measuredShares = values.map((value, index) => value * MACRO_COEFFICIENTS[MACROS[index]] / energy);
  const shifted = measuredShares.map((share, index) => Math.max(0, share + shareDelta[index]));
  const shiftedTotal = shifted.reduce((sum, share) => sum + share, 0);
  const shares = shiftedTotal > 0 ? shifted.map(share => share / shiftedTotal) : measuredShares;
  const targetEnergy = target - (oldCalories - energy) * (target / oldCalories);
  MACROS.forEach((field, index) => {
    const projected = checkedStored(targetEnergy * shares[index] / MACRO_COEFFICIENTS[field]);
    if (row[field] !== projected) changes[field] = projected;
  });
  return changes;
};

const scaledPortion = (row, factor) => {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Adjustment is outside stored numeric range');
  try {
    return scaleFoodPortion(row, factor);
  } catch (error) {
    throw new RangeError('Adjustment is outside stored numeric range', { cause: error });
  }
};

const projectPortion = (row, value, current) => {
  const factor = value / current;
  if (row.kind !== 'group') {
    const changes = changedValues(row, scaledPortion(row, factor));
    return [patch(row, changes)].filter(Boolean);
  }

  const members = groupMembers(row);
  const parentProjection = scaledPortion({ ...row, children: members }, factor);
  const parentChanges = changedValues(row, parentProjection, new Set(['grams', 'amount', 'unit']));
  return [
    patch(row, parentChanges),
    ...members.map(member => patch(member, changedValues(member, scaledPortion(member, factor)))),
  ].filter(Boolean);
};

const projectMacro = (row, field, value) => {
  const coefficient = MACRO_COEFFICIENTS[field];
  if (row.kind !== 'group') {
    const target = checkedStored(value);
    const calories = checkedStored(row.calories + coefficient * (target - row[field]));
    return [patch(row, changedValues(row, { [field]: target, calories }))].filter(Boolean);
  }

  const members = groupMembers(row);
  const allocations = allocateCents(value, members, field);
  return members.map(member => {
    const target = allocations.get(member);
    const calories = checkedStored(member.calories + coefficient * (target - member[field]));
    return patch(member, changedValues(member, { [field]: target, calories }));
  }).filter(Boolean);
};

const projectCalories = (row, field, value, levels) => {
  if (row.kind !== 'group') {
    const grams = foodGrams(row);
    const target = field === 'density' ? checkedStored(grams * value) : checkedStored(value);
    const delta = grams === null ? [0, 0, 0] : ladderDelta(row.calories / grams, target / grams, levels);
    return [patch(row, calorieChanges(row, target, delta))].filter(Boolean);
  }

  const members = groupMembers(row);
  const totalCalories = aggregate(members, 'calories');
  const totalGrams = members.reduce((sum, member) => sum + (foodGrams(member) ?? 0), 0);
  const target = field === 'density' ? checkedStored(totalGrams * value) : checkedStored(value);
  const completeMass = members.every(member => foodGrams(member) !== null);
  const delta = completeMass
    ? ladderDelta(totalCalories / totalGrams, target / totalGrams, levels)
    : [0, 0, 0];
  const allocations = allocateCents(target, members, 'calories');
  return members.map(member => patch(member, calorieChanges(member, allocations.get(member), delta))).filter(Boolean);
};

export function projectFoodAdjustment(row, request, levels = DEFAULT_DENSITY_LEVELS) {
  const field = request?.field;
  const value = request?.value;
  if (!FIELDS.has(field) || typeof value !== 'number' || !Number.isFinite(value) || !canAdjustFood(row, field)) {
    throw new RangeError('Food adjustment is unavailable');
  }
  const current = adjustmentValue(row, field);
  if (value === current) return [];
  const minimum = adjustmentMinimum(row, field);
  if (value < minimum) throw new RangeError(`Food adjustment must be at least ${minimum}`);

  if (field === 'portion') return projectPortion(row, value, current);
  if (field in MACRO_COEFFICIENTS) return projectMacro(row, field, value);
  return projectCalories(row, field, value, levels);
}
