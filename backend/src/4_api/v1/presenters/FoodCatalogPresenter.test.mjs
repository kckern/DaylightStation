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
  it('preserves the established API record, now fifteen fields', () => {
    const entry = new FoodCatalogEntry({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(presentFoodCatalogEntry(entry)).toEqual({
      id: 'food-1', name: 'Apple', normalizedName: 'apple', nutrients: { calories: 95 },
      source: 'manual', barcodeUpc: null, useCount: 2, icon: null,
      // Never pinned, so the pin is an explicit null rather than an absence —
      // the same statement `icon` makes, for the same reason.
      iconOverride: null,
      // Presented as a hard boolean, never the stored value: a catalog entry
      // written before favorites existed has no `favorite` key at all, and the
      // client must not have to tell `undefined` from `false`.
      favorite: false,
      // An entry with no observation that carries a mass says so — explicit
      // nulls and a zero count, never a guessed density.
      canonicalGrams: null, densityKcalPerGram: null, observationCount: 0,
      lastUsed: '2026-08-28', createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it("carries a pinned icon out to the client, so the override's own response can be checked", () => {
    const entry = new FoodCatalogEntry({
      id: 'food-2', name: 'Fried Eggs', icon: 'fried-eggs', iconOverride: 'fried-eggs',
      nutrients: { calories: 200 },
      lastUsed: '2026-09-03', createdAt: '2026-09-03T00:00:00.000Z',
    });
    const presented = presentFoodCatalogEntry(entry);
    expect(presented.icon).toBe('fried-eggs');
    // `setIcon` writes both, so a pin presents the same slug twice. The second
    // one is the part a caller cannot derive: it says a PERSON chose this.
    expect(presented.iconOverride).toBe('fried-eggs');
  });

  it('distinguishes an inferred icon from a pinned one', () => {
    // What `recordUsage` leaves behind: the first capture to name an icon fills
    // it, and nobody was asked. Same `icon` as the pinned entry above, and the
    // difference is only visible because the override is presented.
    const inferred = new FoodCatalogEntry({
      id: 'food-3', name: 'Fried Eggs', icon: 'fried-eggs', nutrients: { calories: 200 },
      lastUsed: '2026-09-03', createdAt: '2026-09-03T00:00:00.000Z',
    });
    expect(presentFoodCatalogEntry(inferred)).toMatchObject({ icon: 'fried-eggs', iconOverride: null });
  });

  it('reports the derived serving, its mass and its density once the ring has evidence', () => {
    const entry = new FoodCatalogEntry({
      id: 'food-3', name: 'Premier Protein Shake', nutrients: { calories: 610, protein: 66 },
      observations: [
        { date: '2026-08-01', kcal: 160, protein: 30, grams: 330, logId: 'r1' },
        { date: '2026-08-19', kcal: 610, protein: 66, grams: 385, logId: 'r2' },
        { date: '2026-08-20', kcal: 160, protein: 30, grams: 330, logId: 'r3' },
      ],
      lastUsed: '2026-08-20', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const view = presentFoodCatalogEntry(entry);
    expect(view.nutrients.calories).toBe(160);
    expect(view.canonicalGrams).toBe(330);
    expect(view.densityKcalPerGram).toBeCloseTo(160 / 330, 6);
    expect(view.observationCount).toBe(3);
  });
});
