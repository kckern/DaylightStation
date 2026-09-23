import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { iconVocabulary } from '#domains/nutrition/services/icons.mjs';

const NOON = new Date('2026-09-22T13:00:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

// The 2026-09-22 incident: a barcode-scanned 325 ml Strawberry Milkshake
// (label grams unknown, product photo saved) became a catalog entry with no
// serving, no icon, no photo and a remembered afternoon portion of `0 g`.
const scan = (over = {}) => ({
  foodId: 'shake', name: 'Strawberry Milkshake', calories: 140, protein: 30, carbs: 5, fat: 1,
  grams: null, unit: 'ml', amount: 325, source: 'upc', barcodeUpc: '749826002033',
  icon: 'milkshake', photoRef: 'ph_2DyAMj3lb6osrZzr', serving: { amount: 325, unit: 'ml', grams: null },
  mealTime: 'evening', logId: 'a5c6ad81',
  ...over,
});

function build({ entries = [], vocabulary = 'milkshake strawberry apple' } = {}) {
  const map = new Map(entries.map(e => [e.id, e]));
  const store = {
    getById: async id => map.get(id) || null,
    findByNormalizedName: async name => [...map.values()].find(e => e.matches(FoodCatalogEntry.normalize(name))) || null,
    save: async e => { map.set(e.id, e); },
  };
  const nutriList = { saveMany: async items => { nutriList.saved = items; } };
  const offered = vocabulary.split(' ');
  const svc = new FoodCatalogService({
    catalogStore: store, nutriListStore: nutriList,
    clock: { now: () => NOON }, createId: () => 'new-id', logger: silent,
    iconOffered: slug => offered.includes(slug),
    iconVocabulary: () => iconVocabulary(vocabulary),
  });
  return { svc, map, nutriList };
}

const existing = (over = {}) => new FoodCatalogEntry({
  id: 'shake', name: 'Strawberry Milkshake', nutrients: { calories: 140, protein: 30, carbs: 5, fat: 1 },
  source: 'upc', barcodeUpc: '749826002033', lastUsed: '2026-09-17', createdAt: '2026-09-17T17:42:48.717Z',
  ...over,
});

describe('FoodCatalogService.recordUsage — a portion of nothing is never recorded', () => {
  it('null grams with a real ml amount records the ml portion, not 0 g', async () => {
    const { svc, map } = build();
    await svc.recordUsage(scan(), 'u');
    expect(map.get('shake').usageByBucket.evening.quantity).toEqual({ grams: null, unit: 'ml', amount: 325 });
  });

  it('a quantity with neither grams nor amount is not recorded at all', async () => {
    const { svc, map } = build({ entries: [existing({ usageByBucket: { evening: { count: 1, lastUsed: '2026-09-19', quantity: { grams: null, unit: 'ml', amount: 325 } } } })] });
    await svc.recordUsage(scan({ grams: null, amount: null, unit: 'g' }), 'u');
    expect(map.get('shake').usageByBucket.evening).toMatchObject({ count: 2, quantity: { grams: null, unit: 'ml', amount: 325 } });
  });

  it("'' and undefined read as unknown, never 0", async () => {
    const { svc, map } = build();
    await svc.recordUsage(scan({ grams: '', amount: undefined, unit: 'g' }), 'u');
    expect(map.get('shake').usageByBucket.evening.quantity).toBeNull();
  });
});

describe('FoodCatalogService.recordUsage — serving, photo and icon from the barcode capture', () => {
  it('a new entry keeps the serving, the photo and the resolved icon', async () => {
    const { svc, map } = build();
    await svc.recordUsage(scan(), 'u');
    const entry = map.get('shake');
    expect(entry.serving).toEqual({ amount: 325, unit: 'ml', grams: null });
    expect(entry.photoRef).toBe('ph_2DyAMj3lb6osrZzr');
    expect(entry.icon).toBe('milkshake');
  });

  it('fills an existing entry that lacks them', async () => {
    const { svc, map } = build({ entries: [existing()] });
    await svc.recordUsage(scan(), 'u');
    const entry = map.get('shake');
    expect(entry.serving).toEqual({ amount: 325, unit: 'ml', grams: null });
    expect(entry.photoRef).toBe('ph_2DyAMj3lb6osrZzr');
    expect(entry.icon).toBe('milkshake');
  });

  it('never overwrites real values the entry already holds', async () => {
    const { svc, map } = build({ entries: [existing({ serving: { amount: 1, unit: 'bottle', grams: 330 }, photoRef: 'ph_first', icon: 'strawberry' })] });
    await svc.recordUsage(scan(), 'u');
    const entry = map.get('shake');
    expect(entry.serving).toEqual({ amount: 1, unit: 'bottle', grams: 330 });
    expect(entry.photoRef).toBe('ph_first');
    expect(entry.icon).toBe('strawberry');
  });

  it('derives the serving from the row quantity when no explicit serving is passed', async () => {
    const { svc, map } = build();
    await svc.recordUsage(scan({ serving: undefined, originalQuantity: { amount: 325, unit: 'ml', grams: null } }), 'u');
    expect(map.get('shake').serving).toEqual({ amount: 325, unit: 'ml', grams: null });
  });
});

describe('FoodCatalogService.quickAdd — the milkshake case', () => {
  it('uses the serving and the photo, and a real icon, never amount null', async () => {
    const broken = existing({ usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 0, unit: 'g', amount: 0 } } },
      serving: { amount: 325, unit: 'ml', grams: null }, photoRef: 'ph_2DyAMj3lb6osrZzr' });
    const { svc, map, nutriList } = build({ entries: [broken] });
    const row = await svc.quickAdd('shake', 'u', { mealTime: 'afternoon' });
    expect(row).toMatchObject({ amount: 325, unit: 'ml', grams: null, photoRef: 'ph_2DyAMj3lb6osrZzr', calories: 140 });
    expect(row.icon).toBe('milkshake');
    expect(nutriList.saved[0].amount).toBe(325);
    // The guess is persisted, and the remembered portion is now the real one.
    expect(map.get('shake').icon).toBe('milkshake');
    expect(map.get('shake').usageByBucket.afternoon.quantity).toEqual({ grams: null, unit: 'ml', amount: 325 });
  });

  it('an iconOverride wins over the icon and any guess', async () => {
    const { svc } = build({ entries: [existing({ icon: 'milkshake', iconOverride: 'strawberry' })] });
    expect((await svc.quickAdd('shake', 'u', { mealTime: 'afternoon' })).icon).toBe('strawberry');
  });

  it('a food with no mass, no serving and no guessable icon lands as one serving', async () => {
    const { svc, map } = build({ entries: [existing({ name: 'Mystery Bar', normalizedName: 'mystery bar' })], vocabulary: 'apple' });
    const row = await svc.quickAdd('shake', 'u', { mealTime: 'afternoon' });
    expect(row).toMatchObject({ amount: 1, unit: 'serving', grams: null, icon: null, photoRef: null });
    expect(map.get('shake').icon).toBeNull();
  });
});
