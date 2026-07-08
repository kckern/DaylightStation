// Characterization test: the STORED YAML SHAPE of the food catalog must not
// change across the serialization-ownership migration (docs/_wip/plans/
// 2026-07-08-serialization-ownership-migration.md, phase 2 — nutrition group).
// It drives YamlFoodCatalogDatastore over an in-memory dataService stub and
// asserts the exact plain-object array written to the catalog file key.
// The prototype assertion is the load-bearing one: js-yaml/JSON round-trips
// only own enumerable properties, so an accidentally-persisted entity instance
// would still serialize its public fields — but the datastore contract is that
// it writes PLAIN objects (dehydrated), never entities. This test must pass
// BEFORE (entry.toJSON path) and AFTER (datastore #dehydrate path) the refactor.
import { describe, it, expect, beforeEach } from 'vitest';
import yaml from 'js-yaml';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const USER = 'kckern';
const PATH = YamlFoodCatalogDatastore.CATALOG_PATH; // lifelog/nutrition/food_catalog

function makeDataService() {
  const files = new Map();
  return {
    files,
    user: {
      read: (rel, uid) => files.get(`${uid}:${rel}`) ?? null,
      write: (rel, data, uid) => { files.set(`${uid}:${rel}`, data); },
    },
  };
}

describe('food catalog stored YAML shape (characterization)', () => {
  let ds;
  let store;
  const stored = () => ds.files.get(`${USER}:${PATH}`);

  beforeEach(() => {
    ds = makeDataService();
    store = new YamlFoodCatalogDatastore({ dataService: ds, logger: noopLogger });
  });

  it('save() persists a plain-object entry with the exact catalog field shape', async () => {
    const entry = new FoodCatalogEntry({
      id: 'fc-1',
      name: 'Greek Yogurt',
      nutrients: { calories: 120, protein: 17, carbs: 7, fat: 0 },
      source: 'manual',
      barcodeUpc: '012345678905',
      useCount: 3,
      lastUsed: '2026-07-08',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    await store.save(entry, USER);
    const arr = stored();

    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    // Exact stored shape (order-independent via yaml.dump of a canonical object)
    expect(yaml.dump(arr[0])).toBe(yaml.dump({
      id: 'fc-1',
      name: 'Greek Yogurt',
      normalizedName: 'greek yogurt',
      nutrients: { calories: 120, protein: 17, carbs: 7, fat: 0 },
      source: 'manual',
      barcodeUpc: '012345678905',
      useCount: 3,
      lastUsed: '2026-07-08',
      createdAt: '2026-07-01T00:00:00.000Z',
    }));
    // The datastore must write a PLAIN object, never a FoodCatalogEntry instance.
    expect(Object.getPrototypeOf(arr[0])).toBe(Object.prototype);
  });

  it('round-trips through the datastore back into an equivalent entity', async () => {
    const entry = new FoodCatalogEntry({ id: 'fc-2', name: 'Oats', nutrients: { calories: 150, protein: 5, carbs: 27, fat: 3 } });
    await store.save(entry, USER);

    const loaded = await store.getById('fc-2', USER);
    expect(loaded).toBeInstanceOf(FoodCatalogEntry);
    expect(loaded.id).toBe('fc-2');
    expect(loaded.name).toBe('Oats');
    expect(loaded.nutrients).toEqual({ calories: 150, protein: 5, carbs: 27, fat: 3 });
    expect(loaded.matches('oats')).toBe(true);
  });
});
