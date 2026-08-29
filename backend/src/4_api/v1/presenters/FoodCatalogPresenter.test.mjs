import { describe, expect, it } from 'vitest';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { presentFoodCatalogEntry } from './FoodCatalogPresenter.mjs';

describe('presentFoodCatalogEntry', () => {
  it('preserves the established nine-field API record', () => {
    const entry = new FoodCatalogEntry({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(presentFoodCatalogEntry(entry)).toEqual({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
  });
});
