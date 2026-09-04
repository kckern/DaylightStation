import { describe, expect, it } from 'vitest';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { presentFoodCatalogEntry } from './FoodCatalogPresenter.mjs';

describe('presentFoodCatalogEntry', () => {
  // Task 7.3 widened the record from nine fields to ten. `icon` is part of the
  // projection deliberately, not incidentally: `PUT /nutrition/catalog/icon`
  // answers with a presented entry, and a response that silently drops the
  // field the request just set is a contract that cannot be checked by its
  // own caller. An entry with no icon presents an explicit null rather than
  // omitting the key, so "no picture chosen" is stated rather than inferred
  // from an absence.
  it('preserves the established API record, now ten fields', () => {
    const entry = new FoodCatalogEntry({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(presentFoodCatalogEntry(entry)).toEqual({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2, icon: null,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it("carries a pinned icon out to the client, so the override's own response can be checked", () => {
    const entry = new FoodCatalogEntry({
      id: 'food-2', name: 'Fried Eggs', icon: 'fried-eggs', nutrients: { calories: 200 },
      lastUsed: '2026-09-03', createdAt: '2026-09-03T00:00:00.000Z',
    });
    expect(presentFoodCatalogEntry(entry).icon).toBe('fried-eggs');
  });
});
