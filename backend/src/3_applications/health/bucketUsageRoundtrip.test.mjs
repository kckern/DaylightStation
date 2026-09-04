import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

// `usageByBucket` is the FIFTH field this program has added that has to survive
// every persistence hop, and the previous four were each dropped once by a
// whitelist one layer below the code that looked correct. A unit test of the
// service alone cannot see that: the service's own tests hold entries in a Map,
// where a field survives whether or not the dehydrator knows about it.
//
// So this walks the REAL stores, and the catalog's dataService double
// SERIALIZES — yaml.dump on write, yaml.load on read — so nothing survives by
// being the same object in memory:
//
//   quickAdd -> FoodCatalogEntry -> #dehydrate -> YAML text
//            -> YAML text -> #hydrate -> FoodCatalogEntry -> suggest ranking
//
// and, on the log side, quickAdd -> saveMany -> YAML on disk -> findByDate,
// which is where `settled` has to arrive verbatim.

const EVENING = new Date('2026-09-02T20:30:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const USER = 'kckern';

let dir, catalogStore, nutriListStore, svc, files, ids;

/** A dataService that stores YAML TEXT, so every read is a genuine re-hydration. */
function makeSerializingDataService(store) {
  return {
    user: {
      read: (rel, uid) => {
        const text = store.get(`${uid}:${rel}`);
        return text === undefined ? null : yaml.load(text);
      },
      write: (rel, data, uid) => { store.set(`${uid}:${rel}`, yaml.dump(data)); },
    },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bucket-roundtrip-'));
  files = new Map();
  ids = 0;
  catalogStore = new YamlFoodCatalogDatastore({
    dataService: makeSerializingDataService(files), logger: silent,
  });
  nutriListStore = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: (rel) => path.join(dir, rel) } }, logger: silent,
  });
  svc = new FoodCatalogService({
    catalogStore, nutriListStore,
    clock: { now: () => EVENING },
    createId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    logger: silent,
  });
});

const seed = async (over) => {
  await catalogStore.save(new FoodCatalogEntry({
    nutrients: { calories: 100, protein: 1, carbs: 1, fat: 1 },
    lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }), USER);
};

describe('usageByBucket survives the real persistence path (Task 9.1)', () => {
  it('a quick-add\'s bucket usage is on disk as TEXT and comes back hydrated', async () => {
    await seed({ id: 'e1', name: 'Oatmeal' });
    await svc.quickAdd('e1', USER, { mealTime: 'morning' });

    // 1. It is really in the serialized bytes — not just on an object in memory.
    const text = files.get(`${USER}:${YamlFoodCatalogDatastore.CATALOG_PATH}`);
    expect(text).toContain('usageByBucket');
    expect(yaml.load(text)[0].usageByBucket.morning).toMatchObject({ count: 1, lastUsed: '2026-09-02' });

    // 2. It comes back through #hydrate as a usable record on the entity.
    const reloaded = await catalogStore.getById('e1', USER);
    expect(reloaded).toBeInstanceOf(FoodCatalogEntry);
    expect(reloaded.usageByBucket.morning).toMatchObject({ count: 1, lastUsed: '2026-09-02' });
  });

  it('counts ACCUMULATE across quick-adds — each one reloads from disk, so a dropped field would reset them', async () => {
    await seed({ id: 'e1', name: 'Oatmeal' });
    await svc.quickAdd('e1', USER, { mealTime: 'morning' });
    await svc.quickAdd('e1', USER, { mealTime: 'morning' });
    await svc.quickAdd('e1', USER, { mealTime: 'evening' });

    const reloaded = await catalogStore.getById('e1', USER);
    expect(reloaded.usageByBucket.morning.count).toBe(2);
    expect(reloaded.usageByBucket.evening.count).toBe(1);
  });

  it('the RANKING reads what came off disk: a breakfast regular leads the morning list', async () => {
    await seed({ id: 'burrito', name: 'Burrito', useCount: 200, lastUsed: '2026-09-02' });
    await seed({ id: 'oatmeal', name: 'Oatmeal', useCount: 1 });
    // Six real morning quick-adds — past the backfill threshold for nothing else,
    // but enough that the blend must beat the burrito's global popularity.
    for (let i = 0; i < 6; i++) await svc.quickAdd('oatmeal', USER, { mealTime: 'morning' });

    const morning = await svc.suggest('', USER, 12, { bucket: 'morning' });
    expect(morning.map((e) => e.id)).toEqual(['oatmeal', 'burrito']);
    const evening = await svc.suggest('', USER, 12, { bucket: 'evening' });
    expect(evening.map((e) => e.id)).toEqual(['burrito', 'oatmeal']);
  });

  it('the remembered portion round-trips, so the next pick logs the same amount', async () => {
    await seed({ id: 'e1', name: 'Oatmeal' });
    // Seed the bucket the way a backfill of real history does.
    await svc.recordUsage({
      name: 'Oatmeal', calories: 100, mealTime: 'morning', grams: 240, unit: 'g', amount: 240,
    }, USER);
    const row = await svc.quickAdd('e1', USER, { mealTime: 'morning' });
    expect([row.grams, row.unit, row.amount]).toEqual([240, 'g', 240]);
    expect((await catalogStore.getById('e1', USER)).usageByBucket.morning.quantity)
      .toEqual({ grams: 240, unit: 'g', amount: 240 });
  });

  it('a catalog file written before this field existed loads as {} and ranks bucket-blind', async () => {
    // Exactly what is on disk in production today: no `usageByBucket` key at all.
    files.set(`${USER}:${YamlFoodCatalogDatastore.CATALOG_PATH}`, yaml.dump([{
      id: 'legacy', name: 'Toast', normalizedName: 'toast',
      nutrients: { calories: 90, protein: 3, carbs: 17, fat: 1 },
      source: 'nutritionix', barcodeUpc: null, useCount: 12, favorite: false, icon: null,
      lastUsed: '2026-09-01', createdAt: '2026-01-01T00:00:00Z',
    }]));
    const loaded = await catalogStore.getById('legacy', USER);
    expect(loaded.usageByBucket).toEqual({});
    expect((await svc.suggest('', USER, 12, { bucket: 'morning' })).map((e) => e.id)).toEqual(['legacy']);
    // And it starts accumulating from its next use rather than staying inert.
    await svc.quickAdd('legacy', USER, { mealTime: 'morning' });
    expect((await catalogStore.getById('legacy', USER)).usageByBucket.morning.count).toBe(1);
  });
});

describe('a quick-added row lands settled, on disk (PRD F8.3)', () => {
  it('settled/settledBy survive saveMany and read back off the YAML file', async () => {
    await seed({ id: 'e1', name: 'Oatmeal' });
    await svc.quickAdd('e1', USER, { mealTime: 'morning' });

    const rows = await nutriListStore.findByDate(USER, '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].settled).toBe(true);
    expect(rows[0].settledBy).toBe('user');
    expect(rows[0].mealTime).toBe('morning');
  });

  it('an ABSENT settled key stays absent — this path never defaults one in (decision 2.6)', async () => {
    // A legacy-shaped row written alongside: `settled` is not merely false, it is
    // not there. `false ?? x` is `false`, so only an OMITTED key can detect a
    // `?? null` / `?? false` creeping into the write path.
    await nutriListStore.saveMany([{
      uuid: '00000000-0000-4000-8000-0000000000ff', userId: USER,
      item: 'Legacy Toast', calories: 90, date: '2026-09-02', mealTime: 'morning',
      log_uuid: 'LEGACY',
    }]);
    await seed({ id: 'e1', name: 'Oatmeal' });
    await svc.quickAdd('e1', USER, { mealTime: 'morning' });

    const rows = await nutriListStore.findByDate(USER, '2026-09-02');
    const legacy = rows.find((r) => r.name === 'Legacy Toast');
    const quick = rows.find((r) => r.name === 'Oatmeal');
    expect(legacy.settled).toBeUndefined();
    expect(quick.settled).toBe(true);
  });
});

// Backfill is the only path that can seed bucket history from a person's
// EXISTING log — a quick-add only knows about foods already quick-added. It
// reads the finished rows, whose `mealTime` is the resolved meal (an explicit
// "for lunch", or the row a capture was launched from, having already beaten
// the clock upstream), so it is the one trustworthy bucket source on disk.
describe('backfill seeds bucket history from the real nutrilist (Task 9.1)', () => {
  /**
   * Both row shapes that exist on the production nutrilist, written through the
   * real store: `saveMany` rows key the name as `item` and DO carry `mealTime`.
   */
  const logRow = (over) => ({
    userId: USER, log_uuid: 'HIST', date: '2026-09-02',
    calories: 200, protein: 5, carbs: 30, fat: 4, ...over,
  });

  it('records each logged row against the bucket and portion it was logged with', async () => {
    await nutriListStore.saveMany([
      logRow({ uuid: 'r1', item: 'Oatmeal', mealTime: 'morning', grams: 240, unit: 'g', amount: 240 }),
      logRow({ uuid: 'r2', item: 'Oatmeal', mealTime: 'morning', grams: 240, unit: 'g', amount: 240 }),
      logRow({ uuid: 'r3', item: 'Burrito', mealTime: 'evening', grams: 300, unit: 'g', amount: 300 }),
    ]);

    const result = await svc.backfill(USER, 2);
    expect(result.processed).toBe(3);

    const oatmeal = await catalogStore.findByNormalizedName('Oatmeal', USER);
    expect(oatmeal.usageByBucket.morning).toEqual({
      count: 2, lastUsed: '2026-09-03', quantity: { grams: 240, unit: 'g', amount: 240 },
    });
    expect(oatmeal.usageByBucket.evening).toBeUndefined();

    const burrito = await catalogStore.findByNormalizedName('Burrito', USER);
    expect(burrito.usageByBucket.evening).toMatchObject({ count: 1 });
  });

  it('a row with no mealTime contributes a use but NO bucket — never a guessed one', async () => {
    await nutriListStore.saveMany([logRow({ uuid: 'r1', item: 'Mystery Stew' })]);
    await svc.backfill(USER, 2);
    const stew = await catalogStore.findByNormalizedName('Mystery Stew', USER);
    expect(stew.useCount).toBeGreaterThan(0);
    expect(stew.usageByBucket).toEqual({});
  });

  it('the seeded history immediately drives the ranking', async () => {
    await nutriListStore.saveMany([
      logRow({ uuid: 'r1', item: 'Burrito', mealTime: 'evening' }),
      ...[1, 2, 3, 4, 5].map((n) => logRow({ uuid: `o${n}`, item: 'Oatmeal', mealTime: 'morning' })),
    ]);
    await svc.backfill(USER, 2);
    expect((await svc.suggest('', USER, 12, { bucket: 'morning' })).map((e) => e.name))
      .toEqual(['Oatmeal', 'Burrito']);
  });
});
