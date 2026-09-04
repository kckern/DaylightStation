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
    expect(map.get('e1').nutrients).toMatchObject({ sodium: 320, fiber: 2, calories: 150 });
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

  it('a MEASURED zero in the catalog still counts as micro data', async () => {
    const { svc } = makeService([makeEntry({ calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 })]);
    expect((await svc.quickAdd('e1', 'u')).microsSource).toBe('catalog');
  });
});
