import { describe, it, expect } from 'vitest';
import { FoodCatalogEntry } from './FoodCatalogEntry.mjs';

const base = (over = {}) => new FoodCatalogEntry({
  id: 'shake', name: 'Strawberry Milkshake',
  nutrients: { calories: 140, protein: 30, carbs: 5, fat: 1 },
  lastUsed: '2026-09-22', createdAt: '2026-09-17T17:42:48.717Z',
  ...over,
});

describe('FoodCatalogEntry — serving and photo from a barcode capture', () => {
  it('an entry written before these fields existed loads with null serving and photo', () => {
    const entry = base();
    expect(entry.serving).toBeNull();
    expect(entry.photoRef).toBeNull();
  });

  it('keeps a measurable serving (325 ml, grams unknown) and a photoRef', () => {
    const entry = base({ serving: { amount: 325, unit: 'ml', grams: null }, photoRef: 'ph_2DyAMj3lb6osrZzr' });
    expect(entry.serving).toEqual({ amount: 325, unit: 'ml', grams: null });
    expect(entry.photoRef).toBe('ph_2DyAMj3lb6osrZzr');
  });

  it('refuses a serving with no positive amount or no unit', () => {
    expect(base({ serving: { amount: 0, unit: 'ml' } }).serving).toBeNull();
    expect(base({ serving: { amount: 325, unit: '' } }).serving).toBeNull();
    expect(base({ serving: 'one cup' }).serving).toBeNull();
    expect(base({ photoRef: '' }).photoRef).toBeNull();
  });

  it('reads a stored {grams: 0, amount: 0} bucket portion as absent', () => {
    const entry = base({ usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 0, unit: 'g', amount: 0 } } } });
    expect(entry.usageByBucket.afternoon.quantity).toBeNull();
    expect(entry.usageByBucket.afternoon.count).toBe(1);
  });

  it('proposes the serving when nothing better is known', () => {
    const entry = base({ serving: { amount: 325, unit: 'ml', grams: null },
      usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 0, unit: 'g', amount: 0 } } } });
    const portion = entry.proposedPortion('afternoon');
    expect(portion).toMatchObject({ grams: null, amount: 325, unit: 'ml' });
    expect(portion.nutrients.calories).toBe(140);
  });

  it('a serving with grams proposes those grams', () => {
    const entry = base({ serving: { amount: 1, unit: 'bar', grams: 60 } });
    expect(entry.proposedPortion('morning')).toMatchObject({ grams: 60, amount: 60, unit: 'g' });
  });

  it('a remembered non-gram portion wins, scaled against a serving in the same unit', () => {
    const entry = base({ serving: { amount: 325, unit: 'ml', grams: null },
      usageByBucket: { evening: { count: 2, lastUsed: '2026-09-22', quantity: { grams: null, unit: 'ml', amount: 650 } } } });
    const portion = entry.proposedPortion('evening');
    expect(portion).toMatchObject({ grams: null, amount: 650, unit: 'ml' });
    expect(portion.nutrients.calories).toBe(280);
    expect(portion.nutrients.protein).toBe(60);
  });

  it('with no mass, no serving and no memory proposes one serving, never a null amount', () => {
    expect(base().proposedPortion('morning')).toMatchObject({ grams: null, amount: 1, unit: 'serving' });
  });

  it('a remembered gram portion still wins over the serving', () => {
    const entry = base({ serving: { amount: 325, unit: 'ml', grams: null },
      observations: [{ date: '2026-09-01', kcal: 140, protein: 30, carbs: 5, fat: 1, grams: 330, logId: 'r1' }],
      usageByBucket: { morning: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 165, unit: 'g', amount: 165 } } } });
    const portion = entry.proposedPortion('morning');
    expect(portion).toMatchObject({ grams: 165, amount: 165, unit: 'g' });
    expect(portion.nutrients.calories).toBe(70);
  });
});
