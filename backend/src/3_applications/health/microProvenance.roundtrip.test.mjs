import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { BudgetService } from './BudgetService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

// A field this program has lost THREE times to a silent whitelist drop. Unit
// tests of the validator, the dehydrator, or the service in isolation each pass
// while the field vanishes one layer down, so this test uses the REAL YAML
// datastore against a temp directory and walks the whole path:
//
//   catalog entry -> quickAdd -> saveMany -> YAML on disk -> findByDate
//                 -> BudgetService.getBudget -> microCoverage
//
// If `microsSource` is dropped anywhere in there, the coverage number is wrong
// and this test fails.

const NOW = new Date('2026-09-02T20:30:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const GOALS = { weeklyRateLbs: 1, activityBaseline: 1.35, budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male' };

let dir, nutriListStore, ids;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micro-roundtrip-'));
  ids = 0;
  nutriListStore = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: (rel) => path.join(dir, rel) } },
    logger: silent,
  });
});

const makeCatalogService = (entries) => {
  const map = new Map(entries.map((e) => [e.id, e]));
  return new FoodCatalogService({
    catalogStore: {
      getById: async (id) => map.get(id) || null,
      findByNormalizedName: async () => null,
      save: async (e) => { map.set(e.id, e); },
    },
    nutriListStore,
    clock: { now: () => NOW },
    createId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    logger: silent,
  });
};

const makeBudgetService = () => new BudgetService({
  goalsStore: { load: async () => GOALS, save: async () => {} },
  healthStore: {
    loadWeightData: async () => ({ '2026-09-01': { lbs_adjusted_average: 200 } }),
    getWorkoutsForDate: async () => [],
  },
  nutriListStore,
  clock: { now: () => NOW },
  logger: silent,
});

const entry = (id, name, nutrients) => new FoodCatalogEntry({
  id, name, nutrients, lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
});

describe('microsSource survives the real persistence path (Task 6.2)', () => {
  it('a catalog quick-add with micros lands covered, and one without lands uncovered — read back off disk', async () => {
    const catalog = makeCatalogService([
      entry('with', 'Canned Soup', { calories: 200, protein: 8, carbs: 24, fat: 6, sodium: 890, fiber: 3 }),
      entry('without', 'Plain Toast', { calories: 90, protein: 3, carbs: 17, fat: 1 }),
    ]);
    await catalog.quickAdd('with', 'u1');
    await catalog.quickAdd('without', 'u1');

    // Straight off the YAML file, not from an in-memory handle.
    const rows = await nutriListStore.findByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(2);
    const soup = rows.find((r) => r.name === 'Canned Soup');
    const toast = rows.find((r) => r.name === 'Plain Toast');
    expect(soup.microsSource).toBe('catalog');
    expect(soup.sodium).toBe(890);
    expect(toast.microsSource).toBeNull();

    const budget = await makeBudgetService().getBudget('u1', '2026-09-02');
    expect(budget.microCoverage.sodium).toEqual({ covered: 1, total: 2 });
    expect(budget.macros.sodium).toBe(890);
    expect(budget.food).toBe(290);
  });

  it('an AI-shaped row saved directly keeps its provenance through the file', async () => {
    await nutriListStore.saveMany([{
      uuid: '11111111-1111-4111-8111-111111111111', userId: 'u1', label: 'Chili',
      calories: 400, protein: 25, carbs: 30, fat: 15,
      fiber: 9, sugar: 6, sodium: 980, cholesterol: 55,
      date: '2026-09-02', microsSource: 'ai',
    }]);
    const rows = await nutriListStore.findByDate('u1', '2026-09-02');
    expect(rows[0].microsSource).toBe('ai');
    const budget = await makeBudgetService().getBudget('u1', '2026-09-02');
    expect(budget.microCoverage.cholesterol).toEqual({ covered: 1, total: 1 });
  });

  // FINDING 3 (review): the quickAdd cases above only walk `saveMany`. A real AI
  // capture reaches the nutrilist through `syncFromLog`, which dehydrates through
  // a DIFFERENT whitelist (`dehydrateNutriListItem`). Deleting `microsSource`
  // from that one left 28 files / 324 tests green — this case is what closes it.
  it('a NutriLog synced through syncFromLog keeps provenance — the path a real AI capture takes', async () => {
    const item = (over) => ({
      id: 'aAaAaAaAaA', uuid: '33333333-3333-4333-8333-333333333333',
      label: 'Chili', icon: 'default', grams: 300, unit: 'g', amount: 300, color: 'orange',
      calories: 400, protein: 25, carbs: 30, fat: 15,
      fiber: 9, sugar: 6, sodium: 980, cholesterol: 55, kind: 'item', ...over,
    });
    await nutriListStore.syncFromLog({
      id: 'lLlLlLlLlL', userId: 'u1', isAccepted: true, status: 'accepted',
      items: [
        item({ microsSource: 'ai' }),
        item({ id: 'bBbBbBbBbB', uuid: '44444444-4444-4444-8444-444444444444', label: 'Rice', microsSource: null }),
      ],
      meal: { date: '2026-09-02', time: 'evening' },
      createdAt: '2026-09-02 18:00:00', acceptedAt: '2026-09-02 18:00:00',
    });

    const rows = await nutriListStore.findByDate('u1', '2026-09-02');
    expect(rows.find((r) => r.label === 'Chili').microsSource).toBe('ai');
    expect(rows.find((r) => r.label === 'Rice').microsSource).toBeNull();

    const budget = await makeBudgetService().getBudget('u1', '2026-09-02');
    expect(budget.microCoverage.sodium).toEqual({ covered: 1, total: 2 });
  });

  it('a legacy row with no microsSource key at all reads as uncovered, not as a crash', async () => {
    await nutriListStore.saveMany([{
      uuid: '22222222-2222-4222-8222-222222222222', userId: 'u1', label: 'Legacy Rice',
      calories: 200, date: '2026-09-02',
    }]);
    const budget = await makeBudgetService().getBudget('u1', '2026-09-02');
    expect(budget.microCoverage.fiber).toEqual({ covered: 0, total: 1 });
    // Every micro reads 0 on this row — which is exactly why coverage, not the
    // value, is what the UI is allowed to believe.
    expect(budget.macros.fiber).toBe(0);
  });
});
