import { describe, expect, it } from 'vitest';
import {
  adjustmentMinimum,
  adjustmentValue,
  canAdjustFood,
  projectFoodAdjustment,
} from './foodAdjustment.mjs';

const constant = [
  { level: 1, kcal_per_g: 1, macros: { protein_pct: 40, carb_pct: 40, fat_pct: 20 } },
  { level: 2, kcal_per_g: 2, macros: { protein_pct: 40, carb_pct: 40, fat_pct: 20 } },
];

const shifting = [
  { level: 1, kcal_per_g: 1, macros: { protein_pct: 40, carb_pct: 24, fat_pct: 36 } },
  { level: 2, kcal_per_g: 2, macros: { protein_pct: 30, carb_pct: 14, fat_pct: 56 } },
];

const group = children => ({
  uuid: 'group', kind: 'group', grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0, children,
});

describe('food adjustment values and eligibility', () => {
  it('uses the current portion unit and preserves known zero eligibility', () => {
    const serving = { uuid: 'x', amount: 1.5, unit: 'serving', calories: 0, protein: 0 };
    expect(adjustmentValue(serving, 'portion')).toBe(1.5);
    expect(adjustmentMinimum(serving, 'portion')).toBe(0.1);
    expect(canAdjustFood(serving, 'calories')).toBe(true);
    expect(canAdjustFood(serving, 'protein')).toBe(true);
    expect(canAdjustFood(serving, 'density')).toBe(false);
    expect(adjustmentValue(serving, 'unknown')).toBeNull();
    expect(canAdjustFood(serving, 'unknown')).toBe(false);
  });

  it('requires complete counted group coverage without counting excluded children', () => {
    const row = group([
      { uuid: 'a', grams: 100, calories: 100, protein: 10 },
      { uuid: 'b', grams: null, calories: null, protein: null, status: 'pending' },
    ]);
    expect(adjustmentValue(row, 'portion')).toBe(100);
    expect(adjustmentValue(row, 'calories')).toBe(100);
    expect(adjustmentValue(row, 'protein')).toBe(10);
    expect(adjustmentValue(row, 'density')).toBe(1);
    expect(canAdjustFood(row, 'protein')).toBe(true);

    row.children[1].status = undefined;
    expect(adjustmentValue(row, 'portion')).toBeNull();
    expect(adjustmentValue(row, 'calories')).toBeNull();
    expect(adjustmentValue(row, 'protein')).toBeNull();
    expect(adjustmentValue(row, 'density')).toBeNull();
    expect(canAdjustFood(row, 'protein')).toBe(false);
  });

  it('requires positive group allocation baselines and calories for macro corrections', () => {
    expect(canAdjustFood(group([
      { uuid: 'a', grams: 10, calories: 0, protein: 0 },
      { uuid: 'b', grams: 10, calories: 0, protein: 0 },
    ]), 'calories')).toBe(false);
    expect(canAdjustFood(group([
      { uuid: 'a', grams: 10, calories: 10, protein: 0 },
      { uuid: 'b', grams: 10, calories: 20, protein: 0 },
    ]), 'protein')).toBe(false);
    expect(canAdjustFood(group([
      { uuid: 'a', grams: 10, calories: null, protein: 1 },
      { uuid: 'b', grams: 10, calories: 20, protein: 2 },
    ]), 'protein')).toBe(false);
  });

  it('computes individual and child-feasible group macro minimums', () => {
    expect(adjustmentMinimum({ uuid: 'x', calories: 100, protein: 30 }, 'protein')).toBe(5);
    const lowResidual = { uuid: 'x', calories: 0.03, protein: 1 };
    expect(adjustmentMinimum(lowResidual, 'protein')).toBe(1);
    expect(() => projectFoodAdjustment(lowResidual, { field: 'protein', value: 0.9925 })).toThrow(RangeError);
    expect(adjustmentMinimum(group([
      { uuid: 'a', calories: 4, protein: 10 },
      { uuid: 'b', calories: 196, protein: 10 },
    ]), 'protein')).toBe(18);
    expect(adjustmentMinimum({ uuid: 'x', amount: 4, unit: 'g' }, 'portion')).toBe(1);
    expect(adjustmentMinimum({ uuid: 'x', calories: 10 }, 'calories')).toBe(0);
  });
});

describe('individual food adjustment projection', () => {
  it('preserves a calorie residual during a protein correction', () => {
    const row = { uuid: 'x', grams: 100, calories: 100, protein: 10, carbs: 8, fat: 2 };
    expect(projectFoodAdjustment(row, { field: 'protein', value: 15 }))
      .toEqual([{ id: 'x', changes: { protein: 15, calories: 120 } }]);
    expect(projectFoodAdjustment(row, { field: 'protein', value: 10 })).toEqual([]);
  });

  it('does not infer unknown macros or change micros at fixed mass', () => {
    const row = { uuid: 'x', grams: 100, calories: 100, protein: null, carbs: 10, fat: 2, sodium: 50 };
    expect(projectFoodAdjustment(row, { field: 'calories', value: 200 }))
      .toEqual([{ id: 'x', changes: { calories: 200, carbs: 20, fat: 4 } }]);
  });

  it('applies literal constant and shifting ladder share corrections', () => {
    expect(projectFoodAdjustment(
      { uuid: 'x', grams: 100, calories: 100, protein: 10, carbs: 8, fat: 2 },
      { field: 'calories', value: 200 }, constant,
    )).toEqual([{ id: 'x', changes: { calories: 200, protein: 20, carbs: 16, fat: 4 } }]);

    expect(projectFoodAdjustment(
      { uuid: 'x', grams: 100, calories: 100, protein: 10, carbs: 6, fat: 4 },
      { field: 'calories', value: 200 }, shifting,
    )).toEqual([{ id: 'x', changes: { calories: 200, protein: 15, carbs: 7, fat: 12.44 } }]);
  });

  it('uses endpoint shares outside the ladder without imposing a maximum', () => {
    expect(projectFoodAdjustment(
      { uuid: 'x', grams: 100, calories: 100, protein: 10, carbs: 6, fat: 4 },
      { field: 'density', value: 3 }, shifting,
    )).toEqual([{ id: 'x', changes: { calories: 300, protein: 22.5, carbs: 10.5, fat: 18.67 } }]);
  });

  it('uses each macro energy coefficient', () => {
    const row = { uuid: 'x', calories: 100, protein: 10, carbs: 10, fat: 10 };
    expect(projectFoodAdjustment(row, { field: 'carbs', value: 12 }))
      .toEqual([{ id: 'x', changes: { carbs: 12, calories: 108 } }]);
    expect(projectFoodAdjustment(row, { field: 'fat', value: 12 }))
      .toEqual([{ id: 'x', changes: { fat: 12, calories: 118 } }]);
  });

  it('preserves macro fields when starting calories or macro energy are zero', () => {
    expect(projectFoodAdjustment(
      { uuid: 'x', grams: 100, calories: 0, protein: 0, carbs: null, fat: 0 },
      { field: 'calories', value: 100 }, constant,
    )).toEqual([{ id: 'x', changes: { calories: 100 } }]);
    expect(projectFoodAdjustment(
      { uuid: 'x', grams: 100, calories: 20, protein: 0, carbs: 0, fat: 0 },
      { field: 'calories', value: 100 }, constant,
    )).toEqual([{ id: 'x', changes: { calories: 100 } }]);
  });

  it('uses zero ladder-share movement when mass is unknown', () => {
    expect(projectFoodAdjustment(
      { uuid: 'x', grams: null, calories: 100, protein: 10, carbs: 6, fat: 4 },
      { field: 'calories', value: 200 }, shifting,
    )).toEqual([{ id: 'x', changes: { calories: 200, protein: 20, carbs: 12, fat: 8 } }]);
  });

  it('scales portions in their existing unit and emits only changed approved keys', () => {
    const row = { uuid: 'x', amount: 2, unit: 'serving', calories: 100, protein: 5, sodium: 40, name: 'Soup' };
    expect(projectFoodAdjustment(row, { field: 'portion', value: 3 })).toEqual([{ id: 'x', changes: {
      calories: 150, protein: 7.5, sodium: 60, amount: 3,
    } }]);
  });

  it('rejects unavailable, non-finite, coerced, negative, and below-minimum requests', () => {
    const row = { uuid: 'x', grams: 100, calories: 100, protein: 30, carbs: 0, fat: 0 };
    for (const request of [
      { field: 'fiber', value: 1 },
      { field: 'calories', value: '200' },
      { field: 'calories', value: Number.NaN },
      { field: 'calories', value: -1 },
      { field: 'protein', value: 4.99 },
    ]) expect(() => projectFoodAdjustment(row, request)).toThrow(RangeError);
    expect(() => projectFoodAdjustment({ uuid: 'x', calories: null }, { field: 'calories', value: 10 })).toThrow(RangeError);
    expect(() => projectFoodAdjustment(
      { uuid: 'x', amount: 1, unit: 'serving', calories: 2 },
      { field: 'portion', value: Number.MAX_VALUE },
    )).toThrow(RangeError);
  });

  it('rejects density ladders with coerced or non-increasing positions', () => {
    const row = { uuid: 'x', grams: 100, calories: 100, protein: 10, carbs: 6, fat: 4 };
    expect(() => projectFoodAdjustment(row, { field: 'calories', value: 200 }, [
      { ...constant[0], kcal_per_g: '1' }, constant[1],
    ])).toThrow(RangeError);
    expect(() => projectFoodAdjustment(row, { field: 'calories', value: 200 }, [
      constant[0], { ...constant[1], kcal_per_g: 1 },
    ])).toThrow(RangeError);
  });

  it('returns an exact no-op without quantizing stored values and never mutates input', () => {
    const row = { uuid: 'x', grams: 3.333, calories: 7.777, protein: 1.111, carbs: 0, fat: 0 };
    const before = structuredClone(row);
    expect(projectFoodAdjustment(row, { field: 'calories', value: 7.777 })).toEqual([]);
    expect(row).toEqual(before);
    expect(projectFoodAdjustment({ uuid: 'zero', calories: 0 }, { field: 'calories', value: -0 })).toEqual([]);
    expect(projectFoodAdjustment(
      { uuid: 'small', grams: 0.5, amount: 0.5, unit: 'g', calories: 2 },
      { field: 'portion', value: 0.5 },
    )).toEqual([]);
  });
});

describe('group food adjustment projection', () => {
  it('allocates calorie and selected macro targets proportionally', () => {
    const row = group([
      { uuid: 'a', grams: 100, calories: 100, protein: 10, carbs: 8, fat: 2 },
      { uuid: 'b', grams: 200, calories: 200, protein: 20, carbs: 16, fat: 4 },
    ]);
    expect(projectFoodAdjustment(row, { field: 'calories', value: 450 }, constant)).toEqual([
      { id: 'a', changes: { calories: 150, protein: 15, carbs: 12, fat: 3 } },
      { id: 'b', changes: { calories: 300, protein: 30, carbs: 24, fat: 6 } },
    ]);
    expect(projectFoodAdjustment(row, { field: 'protein', value: 45 })).toEqual([
      { id: 'a', changes: { protein: 15, calories: 120 } },
      { id: 'b', changes: { protein: 30, calories: 240 } },
    ]);
  });

  it('applies one group-density ladder delta to every child', () => {
    const row = group([
      { uuid: 'a', grams: 50, calories: 100, protein: 10, carbs: 6, fat: 4 },
      { uuid: 'b', grams: 150, calories: 100, protein: 10, carbs: 6, fat: 4 },
    ]);
    expect(projectFoodAdjustment(row, { field: 'density', value: 2 }, shifting)).toEqual([
      { id: 'a', changes: { calories: 200, protein: 15, carbs: 7, fat: 12.44 } },
      { id: 'b', changes: { calories: 200, protein: 15, carbs: 7, fat: 12.44 } },
    ]);
  });

  it('allocates integer cents by remainder and ID tie-break without reordering patches', () => {
    const row = group([
      { uuid: 'b', calories: 1, protein: null, carbs: null, fat: null },
      { uuid: 'a', calories: 1, protein: null, carbs: null, fat: null },
    ]);
    expect(projectFoodAdjustment(row, { field: 'calories', value: 2.01 }, constant)).toEqual([
      { id: 'a', changes: { calories: 1.01 } },
    ]);
  });

  it('keeps group parent nutrients non-additive while scaling counted portions', () => {
    const row = group([
      { uuid: 'a', grams: 10, amount: 10, unit: 'g', calories: 20, protein: 1, sodium: null },
      { uuid: 'b', grams: 30, amount: 30, unit: 'g', calories: 60, protein: 3, sodium: 8 },
      { uuid: 'pending', grams: 50, calories: 100, protein: 5, status: 'pending' },
    ]);
    expect(projectFoodAdjustment(row, { field: 'portion', value: 80 })).toEqual([
      { id: 'group', changes: { grams: 80, amount: 80, unit: 'g' } },
      { id: 'a', changes: { calories: 40, protein: 2, grams: 20, amount: 20 } },
      { id: 'b', changes: { calories: 120, protein: 6, sodium: 16, grams: 60, amount: 60 } },
    ]);
  });

  it('preserves unknown micros, exact identity, and input immutability', () => {
    const row = group([
      { uuid: 'a', grams: 100, calories: 100, protein: 10, carbs: null, fat: 2, sodium: null },
      { uuid: 'b', grams: null, calories: 200, protein: 20, carbs: null, fat: 4, sodium: 9 },
    ]);
    const before = structuredClone(row);
    expect(projectFoodAdjustment(row, { field: 'calories', value: 300 }, shifting)).toEqual([]);
    expect(row).toEqual(before);
    expect(projectFoodAdjustment(row, { field: 'calories', value: 450 }, shifting)).toEqual([
      { id: 'a', changes: { calories: 150, protein: 15, fat: 3 } },
      { id: 'b', changes: { calories: 300, protein: 30, fat: 6 } },
    ]);
  });

  it('rejects a macro correction below any proportional child feasibility bound', () => {
    const row = group([
      { uuid: 'a', calories: 4, protein: 10 },
      { uuid: 'b', calories: 196, protein: 10 },
    ]);
    expect(() => projectFoodAdjustment(row, { field: 'protein', value: 17.99 })).toThrow(RangeError);
    expect(projectFoodAdjustment(row, { field: 'protein', value: 18 })).toEqual([
      { id: 'a', changes: { protein: 9, calories: 0 } },
      { id: 'b', changes: { protein: 9, calories: 192 } },
    ]);
  });

  it('publishes a minimum whose deterministic cent allocation is child-feasible', () => {
    const row = group([
      { uuid: 'b', calories: 19.99, protein: 10 },
      { uuid: 'a', calories: 100, protein: 10 },
    ]);
    expect(adjustmentMinimum(row, 'protein')).toBe(10.02);
    expect(() => projectFoodAdjustment(row, { field: 'protein', value: 10.01 })).toThrow(RangeError);
    expect(projectFoodAdjustment(row, { field: 'protein', value: 10.02 })).toEqual([
      { id: 'b', changes: { protein: 5.01, calories: 0.03 } },
      { id: 'a', changes: { protein: 5.01, calories: 80.04 } },
    ]);
  });
});
