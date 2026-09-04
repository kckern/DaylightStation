import { describe, it, expect } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const EVENING = new Date('2026-09-02T20:30:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

const bottle = (n, over = {}) => ({
  date: `2026-08-${String(n).padStart(2, '0')}`,
  kcal: 160, protein: 30, carbs: 5, fat: 3, grams: 330, logId: `r${n}`, ...over,
});

const makeEntry = (over = {}) => new FoodCatalogEntry({
  id: 'e1', name: 'Premier Protein Shake',
  nutrients: { calories: 610, protein: 66, carbs: 10, fat: 6 },
  lastUsed: '2026-08-19', createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const makeService = (entries, { nutriList = { saveMany: async () => {} } } = {}) => {
  const map = new Map(entries.map((e) => [e.id, e]));
  const svc = new FoodCatalogService({
    catalogStore: {
      findByNormalizedName: async (name) =>
        [...map.values()].find((e) => e.matches(FoodCatalogEntry.normalize(name))) || null,
      getById: async (id) => map.get(id) || null,
      getAll: async () => [...map.values()],
      save: async (e) => { map.set(e.id, e); },
    },
    nutriListStore: nutriList,
    clock: { now: () => EVENING },
    createId: () => 'new-id',
    logger: silent,
  });
  return { svc, map };
};

describe('recordUsage — a capture CONTRIBUTES, it no longer overwrites', () => {
  it('a doubled row does not become the definition of a serving', async () => {
    const entry = makeEntry({ nutrients: { calories: 160, protein: 30, carbs: 5, fat: 3 },
      observations: [bottle(1), bottle(5), bottle(9)] });
    const { svc } = makeService([entry]);
    await svc.recordUsage({
      name: 'Premier Protein Shake', calories: 610, protein: 66, carbs: 10, fat: 6,
      grams: 385, unit: 'g', amount: 385, logId: 'bad-row',
    }, 'u');
    expect(entry.observations).toHaveLength(4);
    expect(entry.nutrients.calories).toBe(160);
  });

  it('a row with no usable mass is not recorded as an observation at all', async () => {
    const entry = makeEntry({ observations: [bottle(1)] });
    const { svc } = makeService([entry]);
    await svc.recordUsage({ name: 'Premier Protein Shake', calories: 610, unit: 'serving', amount: 1 }, 'u');
    expect(entry.observations).toHaveLength(1);
  });

  it('re-recording the same row id leaves one observation, not two', async () => {
    const entry = makeEntry();
    const { svc } = makeService([entry]);
    const item = { name: 'Premier Protein Shake', calories: 160, grams: 330, unit: 'g', amount: 330, logId: 'same' };
    await svc.recordUsage(item, 'u');
    await svc.recordUsage(item, 'u');
    expect(entry.observations).toHaveLength(1);
  });

  it('a brand-new entry starts its ring at the first capture that carries a mass', async () => {
    const { svc, map } = makeService([]);
    await svc.recordUsage({
      name: 'Congee', calories: 200, protein: 6, grams: 300, unit: 'g', amount: 300, logId: 'first',
    }, 'u');
    const created = [...map.values()][0];
    expect(created.observations).toHaveLength(1);
    expect(created.nutrients.calories).toBe(200);
  });

  it('a UPC capture fills provenance on an entry that had none, and never renames one that has', async () => {
    const entry = makeEntry();
    const { svc } = makeService([entry]);
    await svc.recordUsage({
      name: 'Premier Protein Shake', calories: 160, grams: 330, unit: 'g', amount: 330,
      source: 'upc', barcodeUpc: '012345678905', logId: 'scan-1',
    }, 'u');
    expect(entry.barcodeUpc).toBe('012345678905');
    expect(entry.source).toBe('upc');
    expect(entry.observations[0].source).toBe('upc');

    await svc.recordUsage({
      name: 'Premier Protein Shake', calories: 160, grams: 330, unit: 'g', amount: 330,
      source: 'upc', barcodeUpc: '999999999999', logId: 'scan-2',
    }, 'u');
    expect(entry.barcodeUpc).toBe('012345678905');
  });
});

describe('quickAdd — density x the remembered portion, not a copied total', () => {
  it('the 385 g portion of the shake yields 187 kcal, not 610', async () => {
    const entry = makeEntry({
      observations: [bottle(1), bottle(5), bottle(9)],
      usageByBucket: { morning: { count: 3, lastUsed: '2026-09-01', quantity: { grams: 385, unit: 'g', amount: 385 } } },
    });
    const saved = [];
    const { svc } = makeService([entry], { nutriList: { saveMany: async (rows) => saved.push(...rows) } });
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.calories).toBe(187);
    expect(saved[0].calories).toBe(187);
  });

  it('a bucket with no remembered portion gets the canonical serving unscaled', async () => {
    const entry = makeEntry({ observations: [bottle(1), bottle(5), bottle(9)] });
    const { svc } = makeService([entry]);
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'evening' });
    expect(item.calories).toBe(160);
    expect(item.grams).toBe(0);
  });

  it('an entry with no derivation keeps working on what it holds — never a zero', async () => {
    const entry = makeEntry({
      usageByBucket: { morning: { count: 1, lastUsed: '2026-09-01', quantity: { grams: 385, unit: 'g', amount: 385 } } },
    });
    const { svc } = makeService([entry]);
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.calories).toBe(610);
    expect(item.protein).toBe(66);
  });

  it('scales the macros with the calories', async () => {
    const entry = makeEntry({
      observations: [bottle(1), bottle(5), bottle(9)],
      usageByBucket: { morning: { count: 3, lastUsed: '2026-09-01', quantity: { grams: 660, unit: 'g', amount: 660 } } },
    });
    const { svc } = makeService([entry]);
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.calories).toBe(320);
    expect(item.protein).toBe(60);
  });
});

describe('densityForName / assessDensity — the capture-time guard', () => {
  const withHistory = () => makeService([makeEntry({ observations: [bottle(1), bottle(5), bottle(9)] })]);

  it('reports the food\'s own median density', async () => {
    const { svc } = withHistory();
    const known = await svc.densityForName('premier protein shake', 'u');
    expect(known.density).toBeCloseTo(160 / 330, 6);
    expect(known.sampleCount).toBe(3);
  });

  it('is null for a food the catalog has never seen with a mass', async () => {
    const { svc } = makeService([makeEntry()]);
    expect(await svc.densityForName('Premier Protein Shake', 'u')).toBeNull();
    expect(await svc.densityForName('Kimchi Stew', 'u')).toBeNull();
  });

  it('flags the 610 kcal / 385 g parse and says what history expected', async () => {
    const { svc } = withHistory();
    const findings = await svc.assessDensity(
      [{ label: 'Premier Protein Shake', calories: 610, grams: 385, unit: 'g', amount: 385 }], 'u');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      name: 'Premier Protein Shake', calories: 610, grams: 385, expectedCalories: 187, sampleCount: 3,
    });
    expect(findings[0].ratio).toBeCloseTo((610 / 385) / (160 / 330), 6);
  });

  it('says nothing about a normal helping, even a generous one', async () => {
    const { svc } = withHistory();
    const findings = await svc.assessDensity(
      [{ label: 'Premier Protein Shake', calories: 240, grams: 495, unit: 'g', amount: 495 }], 'u');
    expect(findings).toEqual([]);
  });

  it('says nothing when there is no history to compare against', async () => {
    const { svc } = makeService([]);
    const findings = await svc.assessDensity(
      [{ label: 'Kimchi Stew', calories: 900, grams: 300, unit: 'g', amount: 300 }], 'u');
    expect(findings).toEqual([]);
  });

  it('says nothing about an item with no mass — there is nothing to compare', async () => {
    const { svc } = withHistory();
    const findings = await svc.assessDensity(
      [{ label: 'Premier Protein Shake', calories: 610, unit: 'serving', amount: 1 }], 'u');
    expect(findings).toEqual([]);
  });

  it('CHANGES NOTHING — the parsed number and the entry both survive the check', async () => {
    const { svc, map } = withHistory();
    const item = { label: 'Premier Protein Shake', calories: 610, grams: 385, unit: 'g', amount: 385 };
    await svc.assessDensity([item], 'u');
    expect(item.calories).toBe(610);
    expect(map.get('e1').observations).toHaveLength(3);
    expect(map.get('e1').nutrients.calories).toBe(160);
  });
});
