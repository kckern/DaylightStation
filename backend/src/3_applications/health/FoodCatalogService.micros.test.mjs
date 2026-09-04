import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

// Task 6.2 — the catalog half of micro provenance.
//
// The catalog is where micros SURVIVE between captures: an AI parse donates
// them, and a later quick-add off that entry inherits both the numbers and the
// 'catalog' provenance. The rule that keeps this honest is that an entry only
// gains micros from a row that carried provenance — otherwise the structural
// zeros every row stores would be laundered into "catalog micro data" and every
// quick-add would claim coverage it never had.

const NOW = new Date('2026-09-02T20:30:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeService(entries = []) {
  const map = new Map(entries.map((e) => [e.id, e]));
  const catalogStore = {
    getById: async (id) => map.get(id) || null,
    findByNormalizedName: async (name) => [...map.values()]
      .find((e) => e.normalizedName === FoodCatalogEntry.normalize(name)) || null,
    save: async (e) => { map.set(e.id, e); },
  };
  const nutriList = { saved: null, saveMany: async (items) => { nutriList.saved = items; } };
  let n = 0;
  const svc = new FoodCatalogService({
    catalogStore, nutriListStore: nutriList,
    clock: { now: () => NOW },
    createId: () => `id-${++n}`,
    logger: silent,
  });
  return { svc, map, nutriList };
}

const makeEntry = (nutrients) => new FoodCatalogEntry({
  id: 'e1', name: 'Eggs', nutrients, lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
});

describe('FoodCatalogService.recordUsage — micro donation', () => {
  it('stores micros from a PROVENANCED row', async () => {
    const { svc, map } = makeService();
    await svc.recordUsage({
      name: 'Chili', calories: 400, protein: 25, carbs: 30, fat: 15,
      fiber: 9, sugar: 6, sodium: 980, cholesterol: 55, microsSource: 'ai',
    }, 'u');
    const entry = [...map.values()][0];
    expect(entry.nutrients).toMatchObject({ fiber: 9, sugar: 6, sodium: 980, cholesterol: 55 });
  });

  it('stores NO micros from an unprovenanced row — structural zeros are not laundered into the catalog', async () => {
    const { svc, map } = makeService();
    await svc.recordUsage({
      name: 'Chili', calories: 400, protein: 25, carbs: 30, fat: 15,
      fiber: 0, sugar: 0, sodium: 0, cholesterol: 0, microsSource: null,
    }, 'u');
    const entry = [...map.values()][0];
    for (const key of ['fiber', 'sugar', 'sodium', 'cholesterol']) {
      expect(Object.prototype.hasOwnProperty.call(entry.nutrients, key)).toBe(false);
    }
  });

  it('an unprovenanced re-log does not erase micros an earlier provenanced one donated', async () => {
    const existing = makeEntry({ calories: 140, protein: 12, carbs: 1, fat: 10, sodium: 320, fiber: 2 });
    const { svc, map } = makeService([existing]);
    await svc.recordUsage({ name: 'Eggs', calories: 150, protein: 13, carbs: 1, fat: 11 }, 'u');
    // The micros survive, which is what this test is about. The CALORIES no
    // longer move: "latest wins" is gone (catalog-density fix, step 1), and a
    // row with no mass is not an observation at all — it carries a total with
    // nothing to divide by. 140 is the entry's own canonical value, unchanged.
    expect(map.get('e1').nutrients).toMatchObject({ sodium: 320, fiber: 2, calories: 140 });
  });

  // C2 (review): the bug this pair exists to keep dead. A model that answers
  // sodium and nothing else used to donate `fiber: 0, sugar: 0, cholesterol: 0`
  // alongside it, because the capture mapper had already defaulted them —
  // whereupon every later quick-add of that food inherited a hard `fiber: 0`
  // stamped 'catalog', fully "covered", permanently, and self-propagating.
  it('donates ONLY the micros the row actually carries — a partially answered capture leaks no zeros', async () => {
    const { svc, map } = makeService();
    await svc.recordUsage({
      name: 'Ramen', calories: 400, protein: 10, carbs: 60, fat: 14,
      sodium: 1900, microsSource: 'ai', // fiber/sugar/cholesterol were never answered
    }, 'u');
    const { nutrients } = [...map.values()][0];
    expect(nutrients.sodium).toBe(1900);
    for (const key of ['fiber', 'sugar', 'cholesterol']) {
      expect(Object.prototype.hasOwnProperty.call(nutrients, key)).toBe(false);
    }
  });

  it('accumulates micros across captures without clearing keys a later one omits', async () => {
    const { svc, map } = makeService();
    await svc.recordUsage({ name: 'Ramen', calories: 400, sodium: 1900, microsSource: 'ai' }, 'u');
    await svc.recordUsage({ name: 'Ramen', calories: 400, fiber: 3, microsSource: 'ai' }, 'u');
    const { nutrients } = [...map.values()][0];
    expect(nutrients).toMatchObject({ sodium: 1900, fiber: 3 });
    expect(Object.prototype.hasOwnProperty.call(nutrients, 'sugar')).toBe(false);
  });

  it('a provenanced re-log updates the micros it carries', async () => {
    const existing = makeEntry({ calories: 140, protein: 12, carbs: 1, fat: 10, sodium: 320, fiber: 2 });
    const { svc, map } = makeService([existing]);
    await svc.recordUsage({ name: 'Eggs', calories: 150, sodium: 180, microsSource: 'ai' }, 'u');
    expect(map.get('e1').nutrients.sodium).toBe(180);
    expect(map.get('e1').nutrients.fiber).toBe(2); // untouched, not clobbered to 0
  });
});

describe('FoodCatalogService.quickAdd — micro provenance', () => {
  it("sets microsSource:'catalog' and copies the micros when the entry HAS micro data", async () => {
    const { svc, nutriList } = makeService([
      makeEntry({ calories: 140, protein: 12, carbs: 1, fat: 10, sodium: 320, cholesterol: 370 }),
    ]);
    const item = await svc.quickAdd('e1', 'u');
    expect(item.microsSource).toBe('catalog');
    expect(item.sodium).toBe(320);
    expect(item.cholesterol).toBe(370);
    expect(nutriList.saved[0].microsSource).toBe('catalog');
  });

  it('leaves microsSource NULL — and writes no micros — when the entry has none', async () => {
    const { svc, nutriList } = makeService([makeEntry({ calories: 140, protein: 12, carbs: 1, fat: 10 })]);
    const item = await svc.quickAdd('e1', 'u');
    expect(item.microsSource).toBeNull();
    expect(item.sodium).toBeUndefined();
    expect(nutriList.saved[0].microsSource).toBeNull();
  });

  it('inherits only the micros the entry holds — an unanswered one stays absent on the row', async () => {
    const { svc, nutriList } = makeService([makeEntry({ calories: 400, protein: 10, carbs: 60, fat: 14, sodium: 1900 })]);
    const item = await svc.quickAdd('e1', 'u');
    expect(item.sodium).toBe(1900);
    expect(item.fiber).toBeUndefined();
    expect(nutriList.saved[0].fiber).toBeUndefined();
    // Still provenanced: the entry does carry micro data, just not all four.
    expect(item.microsSource).toBe('catalog');
  });

  it('a MEASURED zero in the catalog still counts as micro data', async () => {
    const { svc } = makeService([makeEntry({ calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 })]);
    expect((await svc.quickAdd('e1', 'u')).microsSource).toBe('catalog');
  });
});

describe('FoodCatalogService.backfill — micros', () => {
  it('donates NO micros from history — a stored row\'s zeros are already defaulted, so per-key provenance is gone', async () => {
    const { svc, map } = makeService();
    // Exactly what a stored row looks like: all four micros present as numbers,
    // provenance saying only that the model answered about SOME micro.
    // `backfill` walks dates off its own clock; with daysBack:1 there is exactly
    // one call, so the stub answers unconditionally rather than guessing the ISO
    // day the use case will ask for.
    const nutriList = { findByDate: async () => ([
      { label: 'Ramen', calories: 400, protein: 10, carbs: 60, fat: 14, fiber: 0, sugar: 0, sodium: 1900, cholesterol: 0, microsSource: 'ai' },
    ]) };
    const svcWithHistory = new FoodCatalogService({
      catalogStore: {
        getById: async () => null,
        findByNormalizedName: async (name) => [...map.values()].find((e) => e.normalizedName === FoodCatalogEntry.normalize(name)) || null,
        save: async (e) => { map.set(e.id, e); },
      },
      nutriListStore: nutriList,
      clock: { now: () => NOW },
      createId: () => 'bf-1',
      logger: silent,
    });
    await svcWithHistory.backfill('u1', 1);
    const entry = [...map.values()][0];
    expect(entry.nutrients.calories).toBe(400);
    for (const key of ['fiber', 'sugar', 'sodium', 'cholesterol']) {
      expect(Object.prototype.hasOwnProperty.call(entry.nutrients, key)).toBe(false);
    }
    expect(svc).toBeTruthy();
  });
});
