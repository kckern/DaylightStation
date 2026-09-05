import { describe, it, expect } from 'vitest';
import { normalizeProductNutrition, normalizeNutritionixNutrition } from './normalizeProductNutrition.mjs';
describe('barcode nutrition basis', () => {
  it('does not label Nutritionix serving mass as a count of bottles or invent missing nutrients', () => {
    expect(normalizeNutritionixNutrition({ serving_weight_grams: 325, serving_unit: 'bottle', nf_calories: 160, nf_sugars: 0 }))
      .toMatchObject({ serving: { size: 325, unit: 'g' }, nutrition: { calories: 160, sugar: 0, protein: null } });
    expect(normalizeNutritionixNutrition({ nf_calories: 160 }).serving).toEqual({ size: 1, unit: 'serving' });
  });
  it('does not multiply explicitly per-serving nutrition a second time', () => {
    const value = normalizeProductNutrition({ serving_quantity: 325, serving_quantity_unit: 'ml',
      nutrition_data_per: 'serving', nutriments: { 'energy-kcal': 140, proteins: 30, sodium: 0.34 } });
    expect(value.nutrition).toMatchObject({ calories: 140, protein: 30, sodium: 340 });
    expect(value.serving).toEqual({ size: 325, unit: 'ml' });
  });
  it('prefers serving suffixes, preserves zero, and flags contradictory bases', () => {
    const value = normalizeProductNutrition({ serving_quantity: 325, serving_quantity_unit: 'ml',
      nutriments: { 'energy-kcal_serving': 140, 'energy-kcal_100g': 140, proteins_serving: 30, sugars_serving: 0, sugars: 5 } });
    expect(value.nutrition).toMatchObject({ calories: 140, protein: 30, sugar: 0 });
    expect(value.nutritionLookup.warnings.join(' ')).toContain('Conflicting');
  });
  it('scales explicit per-100 values once and leaves unavailable values unknown', () => {
    const value = normalizeProductNutrition({ serving_quantity: 50, serving_quantity_unit: 'g', nutriments: { 'energy-kcal_100g': 200, proteins_100g: 20 } });
    expect(value.nutrition).toMatchObject({ calories: 100, protein: 10, sodium: null });
    expect(value.nutritionLookup.missing).toContain('sodium');
  });
  it('does not guess the basis or the weight of a serving', () => {
    const value = normalizeProductNutrition({ nutriments: { 'energy-kcal': 140 } });
    expect(value.nutrition.calories).toBeNull();
    expect(value.serving).toEqual({ size: 1, unit: 'serving' });
  });
});
