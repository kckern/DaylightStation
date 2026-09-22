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

// Real Open Food Facts payloads from the 2026-09 scan audit, trimmed to the fields used.
const OIKOS = { serving_size: '0.75 cup (170 g)', serving_quantity: 170, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_serving': 160, 'energy-kcal_100g': 94.1 } };
const CHEESE = { serving_size: '1/4 cup (28 g)', serving_quantity: 28, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_100g': 392.86 } };
const DIET_COKE = { serving_size: null, serving_quantity: null, serving_quantity_unit: null, quantity: '12 fl oz',
  nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } };
const PEANUT_BUTTER = { serving_size: '2 tbsp (2 tbsp)', serving_quantity: null, serving_quantity_unit: 'g',
  nutriments: { 'energy-kcal_100g': 656.25 } };
const SHAKE = { serving_size: '11 fl oz (325 mL)', serving_quantity: 325, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_serving': 160 } };

describe('label grams and per-100 fallback', () => {
  it('prefers the gram figure printed on the label over OFF\'s ml guess', () => {
    expect(normalizeProductNutrition(OIKOS).serving).toEqual({ size: 170, unit: 'g' });
    const cheese = normalizeProductNutrition(CHEESE);
    expect(cheese.serving).toEqual({ size: 28, unit: 'g' });
    expect(cheese.nutrition.calories).toBeCloseTo(110, 0);
  });
  it('keeps a real volume as ml', () => {
    expect(normalizeProductNutrition(SHAKE).serving).toEqual({ size: 325, unit: 'ml' });
  });
  it('falls back to the per-100 basis instead of discarding known values', () => {
    const coke = normalizeProductNutrition(DIET_COKE);
    expect(coke.serving).toEqual({ size: 100, unit: 'ml' });
    expect(coke.nutrition.calories).toBe(0);
    expect(coke.nutritionLookup.servingFallback).toBe('per100');
    const pb = normalizeProductNutrition(PEANUT_BUTTER);
    expect(pb.serving).toEqual({ size: 100, unit: 'g' });
    expect(pb.nutrition.calories).toBeCloseTo(656.25, 2);
    expect(pb.nutritionLookup.servingText).toBe('2 tbsp (2 tbsp)');
  });
});
