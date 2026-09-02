import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NOW = new Date('2026-09-02T12:00:00Z').getTime();
const entry = (over) => new FoodCatalogEntry({
  id: over.id, name: over.name, nutrients: { calories: 100, protein: 1, carbs: 1, fat: 1 },
  useCount: over.useCount ?? 1, favorite: over.favorite ?? false,
  barcodeUpc: over.barcodeUpc ?? null,
  lastUsed: over.lastUsed ?? '2026-09-01', createdAt: '2026-01-01T00:00:00Z',
});

const makeStore = (entries) => {
  const map = new Map(entries.map((e) => [e.id, e]));
  return {
    getAll: async () => [...map.values()],
    getById: async (id) => map.get(id) || null,
    findByNormalizedName: async (name) =>
      [...map.values()].find((e) => e.matches(FoodCatalogEntry.normalize(name))) || null,
    findByUpc: async (upc) => [...map.values()].find((e) => e.barcodeUpc === upc) || null,
    search: async () => [],
    getRecent: async () => [],
    save: async (e) => { map.set(e.id, e); },
  };
};

describe('FoodCatalogService.suggest', () => {
  let svc, store;
  beforeEach(() => {
    store = makeStore([
      entry({ id: 'a', name: 'chicken breast', useCount: 40, lastUsed: '2026-06-01' }),
      entry({ id: 'b', name: 'chicken thigh', useCount: 3, lastUsed: '2026-09-01', favorite: true }),
      entry({ id: 'c', name: 'chickpeas', useCount: 8, lastUsed: '2026-09-01' }),
      entry({ id: 'd', name: 'oatmeal', useCount: 90, lastUsed: '2026-09-01' }),
    ]);
    svc = new FoodCatalogService({
      catalogStore: store, clock: { now: () => NOW }, createId: () => 'new-id',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('query filters and puts favorites first', async () => {
    const out = await svc.suggest('chick', 'u');
    expect(out.map((e) => e.id)[0]).toBe('b'); // favorite outranks higher useCount
    expect(out.map((e) => e.id)).not.toContain('d');
  });

  it('recency-weighted frequency orders non-favorites', async () => {
    const out = await svc.suggest('chick', 'u');
    // c: 8/(1+1/30) ≈ 7.7 vs a: 40/(1+93/30) ≈ 9.8 → a before c
    expect(out.map((e) => e.id).slice(1)).toEqual(['a', 'c']);
  });

  it('empty query returns favorites + recents ranked', async () => {
    const out = await svc.suggest('', 'u', 3);
    expect(out[0].id).toBe('b');
    expect(out).toHaveLength(3);
  });

  it('setFavorite toggles and persists', async () => {
    await svc.setFavorite('a', 'u', true);
    expect((await store.getById('a')).favorite).toBe(true);
  });

  it('createCustom stores a custom-source entry with the barcode', async () => {
    const e = await svc.createCustom({ name: 'Local Granola', calories: 210, protein: 5, carbs: 30, fat: 8, barcodeUpc: '012345678905' }, 'u');
    expect(e.source).toBe('custom');
    expect((await svc.getByUpc('012345678905', 'u')).name).toBe('Local Granola');
  });
});
