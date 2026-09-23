import { describe, it, expect } from 'vitest';
import { planCatalogServingRepair } from './CatalogServingRepair.mjs';
import { iconVocabulary } from '#domains/nutrition/services/icons.mjs';

// The real 2026-09-22 shapes, trimmed.
const shakeEntry = (over = {}) => ({
  id: 'd594990f', name: 'Strawberry Milkshake', source: 'upc', barcodeUpc: '749826002033',
  icon: null, iconOverride: null, lastUsed: '2026-09-22', createdAt: '2026-09-17T17:42:48.717Z',
  usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 0, unit: 'g', amount: 0 } } },
  ...over,
});
const scanRow = (over = {}) => ({
  id: 'a5c6ad81', uuid: 'a5c6ad81', item: 'Strawberry Milkshake', foodId: 'd594990f', version: 4, icon: 'default',
  originalQuantity: { amount: 325, unit: 'ml', grams: null }, grams: null, unit: 'ml', amount: 325,
  captureEvidence: { source: 'upc', upc: '749826002033', serving: { size: 325, unit: 'ml' }, assumption: 'one-serving' },
  photoRef: 'ph_2DyAMj3lb6osrZzr', date: '2026-09-19', review: { startedAt: '2026-09-20T03:19:06.225Z', source: 'upc' },
  ...over,
});
const quickAddRow = (over = {}) => ({
  id: 'e9pTSn1fpl', uuid: '68af3799', item: 'Strawberry Milkshake', foodId: 'd594990f', version: 1, icon: 'default',
  originalQuantity: { amount: null, unit: 'g' }, grams: null, unit: 'g', amount: null, photoRef: null,
  date: '2026-09-22', settledBy: 'user', manualFields: [],
  ...over,
});

describe('planCatalogServingRepair', () => {
  it('fills the milkshake entry from its scan row and fixes the quick-added row', () => {
    const plan = planCatalogServingRepair({ entries: [shakeEntry()], rows: [scanRow(), quickAddRow()],
      vocabulary: iconVocabulary('milkshake apple') });
    expect(plan.catalogUpdates).toEqual([{ id: 'd594990f', name: 'Strawberry Milkshake',
      changes: { serving: { amount: 325, unit: 'ml', grams: null }, photoRef: 'ph_2DyAMj3lb6osrZzr', icon: 'milkshake' },
      clearedBuckets: ['afternoon'], evidence: ['a5c6ad81'] }]);
    expect(plan.rowUpdates).toEqual([{ id: '68af3799', expectedVersion: 1, name: 'Strawberry Milkshake', date: '2026-09-22', foodId: 'd594990f',
      changes: { amount: 325, unit: 'ml', grams: null, photoRef: 'ph_2DyAMj3lb6osrZzr' } }]);
    expect(plan.report).toMatchObject({ upcEntries: 1, filled: { serving: 1, photoRef: 1, icon: 1 }, zeroQuantitiesCleared: 1, rowsFilled: 1, unresolved: [] });
  });

  it('never links a photo whose file is gone, and reports what stays unresolved', () => {
    const plan = planCatalogServingRepair({ entries: [shakeEntry()], rows: [scanRow()], photoExists: () => false,
      vocabulary: iconVocabulary('apple') });
    expect(plan.catalogUpdates[0].changes.photoRef).toBeUndefined();
    expect(plan.report.unresolved).toEqual([{ id: 'd594990f', name: 'Strawberry Milkshake', missing: ['photoRef', 'icon'], scans: 1 }]);
  });

  it('keeps real values, pins and a person-set amount', () => {
    const plan = planCatalogServingRepair({
      entries: [shakeEntry({ serving: { amount: 1, unit: 'bottle', grams: 330 }, photoRef: 'ph_first', iconOverride: 'strawberry', usageByBucket: {} })],
      rows: [scanRow(), quickAddRow({ manualFields: ['amount'] })],
    });
    expect(plan.catalogUpdates).toEqual([]);
    expect(plan.rowUpdates).toEqual([]);
  });

  it('clears zero portions on non-barcode foods too, and leaves them otherwise alone', () => {
    const plan = planCatalogServingRepair({ entries: [{ id: 'eggs', name: 'Eggs', source: 'nutritionix', lastUsed: '2026-09-01', createdAt: 'x',
      usageByBucket: { morning: { count: 3, quantity: { grams: 0, unit: 'g', amount: 0 } }, evening: { count: 1, quantity: { grams: 100, unit: 'g', amount: 100 } } } }],
    rows: [quickAddRow({ foodId: 'eggs' })] });
    expect(plan.catalogUpdates).toEqual([{ id: 'eggs', name: 'Eggs', changes: {}, clearedBuckets: ['morning'], evidence: [] }]);
    // No serving is known for eggs, so its null-amount row is not guessed at.
    expect(plan.rowUpdates).toEqual([]);
    expect(plan.report.upcEntries).toBe(0);
  });

  it('is deterministic and counts a row stored twice once', () => {
    const input = { entries: [shakeEntry()], rows: [quickAddRow(), scanRow(), quickAddRow()] };
    const first = planCatalogServingRepair(input);
    expect(planCatalogServingRepair(input)).toEqual(first);
    expect(first.rowUpdates).toHaveLength(1);
  });
});
