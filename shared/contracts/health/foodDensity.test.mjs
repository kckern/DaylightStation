import { describe, it, expect } from 'vitest';
import { foodDensity, foodDensityOfRows, densityBracket, densityRevision } from './foodDensity.mjs';
import { DEFAULT_DENSITY_LEVELS } from './densityLevels.mjs';
import { normalizeScaleNutribotConfig } from '../../../backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs';

describe('food density', () => {
  it('requires actual mass and counts children once', () => {
    expect(foodDensity({ grams: 100, calories: 250 })).toBe(2.5);
    expect(foodDensity({ grams: null, amount: 100, unit: 'ml', calories: 250 })).toBeNull();
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
