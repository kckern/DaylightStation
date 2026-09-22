import { describe, it, expect } from 'vitest';
import { foodDensity, foodDensityOfRows, densityBracket, densityRevision } from './foodDensity.mjs';
import { DEFAULT_DENSITY_LEVELS } from './densityLevels.mjs';
import { foodMass } from './foodQuantity.mjs';
import { normalizeScaleNutribotConfig } from '../../../backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs';

describe('food density', () => {
  it('requires actual mass and counts children once', () => {
    expect(foodDensity({ grams: 100, calories: 250 })).toBe(2.5);
    expect(foodDensity({ grams: null, amount: 100, unit: 'ml', calories: 250 })).toBe(2.5);
    expect(foodDensity({ grams: null, amount: 414, unit: 'ml', calories: 230 })).toBeCloseTo(0.556, 3);
    expect(foodDensity({ grams: null, amount: 1, unit: 'l', calories: 400 })).toBe(0.4);
    expect(foodDensity({ grams: null, amount: 1, unit: 'serving', calories: 0 })).toBeNull();
    expect(foodDensity({ grams: null, amount: 355, unit: 'ml', calories: null })).toBeNull();
    expect(foodDensity({ grams: 100, calories: 0 })).toBe(0);
    expect(foodDensity({
      kind: 'group',
      grams: 999,
      calories: 999,
      children: [{ grams: 100, calories: 250 }, { grams: 50, calories: 50 }],
    })).toBe(2);
    expect(foodDensityOfRows([
      { kind: 'group', calories: 0 },
      { grams: 100, calories: 250 }, { grams: 50, calories: 50 },
    ])).toBe(2);
    expect(foodDensityOfRows([{ grams: 100, calories: null }])).toBeNull();
  });

  it('derives mass from household volumes and weights, never from counts', () => {
    const mass = (amount, unit) => foodMass({ grams: null, amount, unit, calories: 100 });
    expect(mass(1, 'cup')).toBe(240);
    expect(mass(2, 'cups')).toBe(480);
    expect(mass(1, 'tbsp')).toBeCloseTo(14.787, 3);
    expect(mass(2, 'Tablespoons')).toBeCloseTo(29.574, 3);
    expect(mass(1, 'tablespoon')).toBeCloseTo(14.787, 3);
    expect(mass(1, 'tsp')).toBeCloseTo(4.929, 3);
    expect(mass(3, 'teaspoons')).toBeCloseTo(14.787, 3);
    expect(mass(1, 'teaspoon')).toBeCloseTo(4.929, 3);
    expect(mass(250, 'ml')).toBe(250);
    expect(mass(33, 'cl')).toBe(330);
    expect(mass(2, 'dl')).toBe(200);
    expect(mass(1, 'litre')).toBe(1000);
    expect(mass(2, 'litres')).toBe(2000);
    expect(mass(12, 'fl oz')).toBeCloseTo(354.88, 2);
    expect(mass(0.5, 'kg')).toBe(500);
    expect(mass(1, 'oz')).toBeCloseTo(28.3495, 4);
    expect(mass(2, 'ounces')).toBeCloseTo(56.699, 3);
    expect(mass(1, 'ounce')).toBeCloseTo(28.3495, 4);
    expect(mass(1, 'lb')).toBeCloseTo(453.592, 3);
    expect(mass(2, 'lbs')).toBeCloseTo(907.184, 3);
    expect(mass(1, 'pound')).toBeCloseTo(453.592, 3);
    expect(mass(1, 'pounds')).toBeCloseTo(453.592, 3);
    for (const unit of ['serving', 'servings', 'piece', 'pieces', 'bowl', 'slice', 'can', 'bottle', 'cube', 'cubes', 'bunch', 'item']) {
      expect(mass(1, unit)).toBeNull();
    }
    expect(mass(0, 'cup')).toBeNull();
    expect(mass(null, 'cup')).toBeNull();
    expect(foodMass({ grams: 80, amount: 1, unit: 'cup' })).toBe(80);
    expect(foodDensity({ grams: null, amount: 1, unit: 'cup', calories: 120 })).toBe(0.5);
    expect(foodDensity({ grams: null, amount: 1, unit: 'lb', calories: 453.592 })).toBeCloseTo(1, 6);
  });

  it('requires complete counted food coverage', () => {
    expect(foodDensityOfRows([])).toBeNull();
    expect(foodDensityOfRows([
      { grams: 100, calories: 250 },
      { grams: null, calories: 20, status: 'pending' },
      { grams: null, calories: 20, status: 'deleted' },
    ])).toBe(2.5);
    expect(foodDensityOfRows([
      { grams: 100, calories: 250 },
      { grams: null, calories: 20 },
    ])).toBeNull();
    expect(foodDensity({ kind: 'group', children: [
      { grams: 100, calories: 250 },
      { grams: 50, calories: null },
    ] })).toBeNull();
  });

  it('brackets exact, interpolated, and outside densities by physical position', () => {
    expect(densityBracket(0.2)).toEqual({
      lower: DEFAULT_DENSITY_LEVELS[0], upper: DEFAULT_DENSITY_LEVELS[0], fraction: 0, outside: null,
    });
    expect(densityBracket(8.5)).toEqual({
      lower: DEFAULT_DENSITY_LEVELS[8], upper: DEFAULT_DENSITY_LEVELS[8], fraction: 0, outside: null,
    });
    expect(densityBracket(0)).toEqual({
      lower: DEFAULT_DENSITY_LEVELS[0], upper: DEFAULT_DENSITY_LEVELS[0], fraction: 0, outside: 'below',
    });
    expect(densityBracket(9)).toEqual({
      lower: DEFAULT_DENSITY_LEVELS[8], upper: DEFAULT_DENSITY_LEVELS[8], fraction: 0, outside: 'above',
    });
    expect(densityBracket(0.4)).toEqual({
      lower: DEFAULT_DENSITY_LEVELS[0], upper: DEFAULT_DENSITY_LEVELS[1], fraction: 0.5, outside: null,
    });
    expect(densityBracket(null)).toBeNull();
  });

  it('has a stable revision across serialization', () => {
    expect(densityRevision(JSON.parse(JSON.stringify(DEFAULT_DENSITY_LEVELS))))
      .toBe(densityRevision(DEFAULT_DENSITY_LEVELS));
  });

  it('rejects non-finite and non-increasing configured ladder positions', () => {
    const density_levels = DEFAULT_DENSITY_LEVELS.map(level => ({ ...level }));
    density_levels[1] = { ...density_levels[1], kcal_per_g: density_levels[0].kcal_per_g };
    expect(() => normalizeScaleNutribotConfig({ nutribot: { density_levels } }))
      .toThrow(/strictly increasing/);

    density_levels[1] = { ...density_levels[1], kcal_per_g: 'not-a-number' };
    expect(() => normalizeScaleNutribotConfig({ nutribot: { density_levels } }))
      .toThrow(/finite/);
  });
});

import { numericFoodPatches, numericFoodValue } from './foodNumericEdit.mjs';
describe('density on a volume row', () => {
  const shake = { uuid: 's', unit: 'ml', amount: 325, grams: null, calories: 140, protein: 30, carbs: 5, fat: 1 };
  it('reads kcal per ml as kcal per g', () => {
    expect(numericFoodValue(shake, 'density')).toBeCloseTo(140 / 325, 6);
  });
  it('a density edit scales calories and macros, keeping the volume', () => {
    const s = numericFoodPatches(shake, { field: 'density', value: 0.86 }).get('s');
    expect(s.calories).toBeCloseTo(279.5, 0);
    expect(s.amount).toBeUndefined();
  });
});
