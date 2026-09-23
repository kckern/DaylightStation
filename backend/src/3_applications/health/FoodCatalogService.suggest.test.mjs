import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { iconVocabulary } from '#domains/nutrition/services/icons.mjs';

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

  it('empty query blends in a recent-but-rare food; a typed query does not', async () => {
    const svc2 = new FoodCatalogService({
      catalogStore: makeStore([
        entry({ id: 's1', name: 'staple one', useCount: 90, lastUsed: '2026-07-01' }),
        entry({ id: 's2', name: 'staple two', useCount: 80, lastUsed: '2026-07-02' }),
        entry({ id: 'n1', name: 'new soup', useCount: 1, lastUsed: '2026-09-02' }),
      ]),
      clock: { now: () => NOW }, createId: () => 'x', logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    expect((await svc2.suggest('', 'u', 2)).map((e) => e.id)).toEqual(['s1', 'n1']);
    expect((await svc2.suggest('s', 'u', 2)).map((e) => e.id)).toEqual(['s1', 's2']);
  });

  it('setFavorite toggles and persists', async () => {
    await svc.setFavorite('a', 'u', true);
    expect((await store.getById('a')).favorite).toBe(true);
  });

  it('createCustom stores a custom-source entry with the barcode', async () => {
    const e = await svc.createCustom({ name: 'Local Granola', grams: 50, calories: 210, protein: 5, carbs: 30, fat: 8, barcodeUpc: '012345678905' }, 'u');
    expect(e.source).toBe('custom');
    expect((await svc.getByUpc('012345678905', 'u')).name).toBe('Local Granola');
  });

  it('explicit future definitions scale all supplied nutrients without deleting evidence', async () => {
    const before = await store.getById('a');
    before.observations = [{ date: '2026-09-01', grams: 100, kcal: 200, logId: 'old' }];
    const edited = await svc.updateDefinition('a', 'u', { name: 'Roast chicken', grams: 100, nutrients: { calories: 150, protein: 20, sodium: 100, fiber: 0 } });
    expect(edited.normalizedName).toBe('roast chicken');
    expect(edited.observations).toEqual(before.observations);
    expect(edited.nutrientsForGrams(200)).toMatchObject({ calories: 300, protein: 40, sodium: 200, fiber: 0 });
    expect(edited.nutrientsForGrams(200).sugar).toBeUndefined();
    expect(edited.canonicalGrams).toBe(100);
  });

  it('assigns a stable identity before the first capture is logged', async () => {
    const first = await svc.resolveIdentity({ name: 'New food' }, 'u');
    const repeat = await svc.resolveIdentity({ name: 'New food' }, 'u');
    expect(first.foodId).toBe(repeat.foodId);
    await svc.recordUsage({ ...first, calories: 100 }, 'u');
    expect((await store.getById(first.foodId)).name).toBe('New food');
  });
});

// ── Task 9.1: bucket-aware, zero-keystroke suggestions (PRD F8.1) ───────────
// The ranking maths itself is pinned in
// `#domains/health/services/bucketSuggestRanking.test.mjs`. These cases pin the
// SERVICE's half of the contract: that a bucket reaches the ranker at all, that
// the query filter still runs first, and that omitting the bucket leaves the
// shipped behaviour exactly as it was.
describe('FoodCatalogService.suggest — bucket-aware (Task 9.1)', () => {
  const bucketed = (over) => {
    const e = entry(over);
    e.usageByBucket = over.usageByBucket || {};
    return e;
  };
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const svcOver = (entries) => new FoodCatalogService({
    catalogStore: makeStore(entries), clock: { now: () => NOW }, createId: () => 'new-id', logger: silent,
  });

  it('surfaces this bucket\'s regulars ahead of a globally more popular food', async () => {
    const svc = svcOver([
      bucketed({ id: 'burrito', name: 'burrito', useCount: 200, lastUsed: '2026-09-02' }),
      bucketed({ id: 'oatmeal', name: 'oatmeal', useCount: 20, lastUsed: '2026-09-01',
        usageByBucket: { morning: { count: 18, lastUsed: '2026-09-01' } } }),
    ]);
    expect((await svc.suggest('', 'u', 12, { bucket: 'morning' })).map((e) => e.id))
      .toEqual(['oatmeal', 'burrito']);
    // Same catalog, different bucket: no history there, so the global order stands.
    expect((await svc.suggest('', 'u', 12, { bucket: 'evening' })).map((e) => e.id))
      .toEqual(['burrito', 'oatmeal']);
  });

  it('an unknown bucket id is ignored, not passed through as a phantom bucket', async () => {
    const svc = svcOver([
      bucketed({ id: 'burrito', name: 'burrito', useCount: 200, lastUsed: '2026-09-02' }),
      bucketed({ id: 'oatmeal', name: 'oatmeal', useCount: 20, lastUsed: '2026-09-01',
        usageByBucket: { morning: { count: 18, lastUsed: '2026-09-01' } } }),
    ]);
    expect((await svc.suggest('', 'u', 12, { bucket: 'brunch' })).map((e) => e.id))
      .toEqual(['burrito', 'oatmeal']);
  });

  it('the query still filters first — a bucket regular that does not match is not shown', async () => {
    const svc = svcOver([
      bucketed({ id: 'oatmeal', name: 'oatmeal', useCount: 20, lastUsed: '2026-09-01',
        usageByBucket: { morning: { count: 18, lastUsed: '2026-09-01' } } }),
      bucketed({ id: 'omelette', name: 'omelette', useCount: 2, lastUsed: '2026-09-01',
        usageByBucket: { morning: { count: 2, lastUsed: '2026-09-01' } } }),
    ]);
    const out = await svc.suggest('omel', 'u', 12, { bucket: 'morning' });
    expect(out.map((e) => e.id)).toEqual(['omelette']);
  });

  it('with no bucket asked for, the shipped ordering is byte-for-byte unchanged', async () => {
    const svc = svcOver([
      bucketed({ id: 'a', name: 'chicken breast', useCount: 40, lastUsed: '2026-06-01' }),
      bucketed({ id: 'b', name: 'chicken thigh', useCount: 3, lastUsed: '2026-09-01', favorite: true }),
      bucketed({ id: 'c', name: 'chickpeas', useCount: 8, lastUsed: '2026-09-01' }),
    ]);
    expect((await svc.suggest('chick', 'u')).map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('FoodCatalogService.suggest — icon fallback for entries with none', () => {
  const withIcon = (over) => { const e = entry(over); e.icon = over.icon ?? null; return e; };
  const build = (entries, extra = {}) => {
    const store = makeStore(entries);
    const svc = new FoodCatalogService({
      catalogStore: store, clock: { now: () => NOW }, createId: () => 'x',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      iconOffered: (slug) => ['apple', 'banana', 'fried-eggs'].includes(slug),
      iconVocabulary: () => iconVocabulary('apple banana fried-eggs'),
      ...extra,
    });
    return { svc, store };
  };

  it('shows the closest offered icon for a null or default icon, without persisting it', async () => {
    const { svc, store } = build([
      withIcon({ id: 'a', name: 'Honeycrisp Apple', icon: null, useCount: 9 }),
      withIcon({ id: 'b', name: 'Organic Bananas', icon: 'default', useCount: 8 }),
      withIcon({ id: 'c', name: 'Fried Egg', icon: 'banana', useCount: 7 }),
      withIcon({ id: 'd', name: 'Premier Protein Shake', icon: null, useCount: 6 }),
    ]);
    const byId = Object.fromEntries((await svc.suggest('', 'u', 10)).map((e) => [e.id, e.icon]));
    expect(byId).toEqual({ a: 'apple', b: 'banana', c: 'banana', d: null });
    expect((await store.getById('a')).icon).toBeNull();
    expect((await store.getById('b')).icon).toBe('default');
  });

  it('a stored icon the manifest no longer offers is also replaced for display', async () => {
    const { svc } = build([withIcon({ id: 'a', name: 'Fried Eggs', icon: 'retired_flat_egg' })]);
    expect((await svc.suggest('', 'u', 5))[0].icon).toBe('fried-eggs');
  });

  it('without a vocabulary, suggestions are unchanged', async () => {
    const { svc } = build([withIcon({ id: 'a', name: 'Apple', icon: null })], { iconVocabulary: undefined });
    expect((await svc.suggest('', 'u', 5))[0].icon).toBeNull();
  });
});
