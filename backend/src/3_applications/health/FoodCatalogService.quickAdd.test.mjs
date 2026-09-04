import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

// 2026-09-02T20:30:00-07:00 is 2026-09-03T03:30:00Z — a naive
// `.toISOString().split('T')[0]` reads this as tomorrow (2026-09-03).
// The local (household, America/Los_Angeles) date is 2026-09-02.
const EVENING = new Date('2026-09-02T20:30:00-07:00').getTime();

describe('FoodCatalogService.quickAdd — local date, not UTC', () => {
  let store, nutriList, svc, entry;

  beforeEach(() => {
    entry = new FoodCatalogEntry({
      id: 'e1', name: 'Eggs',
      nutrients: { calories: 140, protein: 12, carbs: 1, fat: 10 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    });
    const map = new Map([[entry.id, entry]]);
    store = {
      getById: async (id) => map.get(id) || null,
      save: async (e) => { map.set(e.id, e); },
    };
    nutriList = { saveMany: async (items) => { nutriList.saved = items; } };
    svc = new FoodCatalogService({
      catalogStore: store, nutriListStore: nutriList,
      clock: { now: () => EVENING },
      createId: () => 'log-1',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('logs the quick-add on the LOCAL evening date, not the UTC date (which would be tomorrow)', async () => {
    const item = await svc.quickAdd('e1', 'u');
    expect(item.date).toBe('2026-09-02');
  });

  it('carries the same local date into the catalog entry lastUsed it bumps', async () => {
    await svc.quickAdd('e1', 'u');
    expect(entry.lastUsed).toBe('2026-09-02');
  });
});

// ── Task 9.1: direct mealTime, a settled row, and remembered portions ───────
describe('FoodCatalogService.quickAdd — mealTime, settlement and per-bucket usage', () => {
  let store, nutriList, svc, entry;

  const build = (over = {}) => {
    entry = new FoodCatalogEntry({
      id: 'e1', name: 'Eggs',
      nutrients: { calories: 140, protein: 12, carbs: 1, fat: 10 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
      ...over,
    });
    const map = new Map([[entry.id, entry]]);
    store = { getById: async (id) => map.get(id) || null, save: async (e) => { map.set(e.id, e); } };
    nutriList = { saveMany: async (items) => { nutriList.saved = items; } };
    svc = new FoodCatalogService({
      catalogStore: store, nutriListStore: nutriList,
      clock: { now: () => EVENING }, createId: () => 'log-1',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  };
  beforeEach(() => build());

  it('writes the row into the bucket the caller named, not the clock\'s bucket', async () => {
    // EVENING is 20:30 local -> the clock would say 'night'.
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.mealTime).toBe('morning');
    expect(nutriList.saved[0].mealTime).toBe('morning');
  });

  it('falls back to the clock when no mealTime is supplied (Telegram / coach / scale)', async () => {
    expect((await svc.quickAdd('e1', 'u')).mealTime).toBe('night');
    build();
    expect((await svc.quickAdd('e1', 'u', {})).mealTime).toBe('night');
  });

  it('ignores a mealTime that is not one of the four buckets', async () => {
    expect((await svc.quickAdd('e1', 'u', { mealTime: 'brunch' })).mealTime).toBe('night');
  });

  it('lands SETTLED — a one-tap pick of a known food is a deliberate choice (PRD F8.3)', async () => {
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.settled).toBe(true);
    expect(item.settledBy).toBe('user');
    expect(typeof item.settledAt).toBe('string');
    expect(item.settledAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('records the usage against that bucket, not just the global count', async () => {
    await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(entry.usageByBucket.morning).toMatchObject({ count: 1, lastUsed: '2026-09-02' });
    expect(entry.usageByBucket.evening).toBeUndefined();
    await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(entry.usageByBucket.morning.count).toBe(2);
  });

  it('defaults the portion to the last one logged for this food IN THIS BUCKET (PRD F8.3)', async () => {
    build({ usageByBucket: {
      morning: { count: 4, lastUsed: '2026-09-01', quantity: { grams: 120, unit: 'g', amount: 120 } },
    } });
    const morning = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect([morning.grams, morning.unit, morning.amount]).toEqual([120, 'g', 120]);
    // A bucket this food has never been eaten in falls back to the catalog default.
    build({ usageByBucket: {
      morning: { count: 4, lastUsed: '2026-09-01', quantity: { grams: 120, unit: 'g', amount: 120 } },
    } });
    const evening = await svc.quickAdd('e1', 'u', { mealTime: 'evening' });
    expect([evening.grams, evening.unit, evening.amount]).toEqual([0, 'serving', 1]);
  });

  it('carries the whole Phase 6/7 payload through unchanged — micros with provenance, and the icon', async () => {
    build({
      icon: 'fried-eggs',
      nutrients: { calories: 140, protein: 12, carbs: 1, fat: 10, sodium: 320, fiber: 2 },
    });
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'morning' });
    expect(item.icon).toBe('fried-eggs');
    expect(item.microsSource).toBe('catalog');
    expect(item.sodium).toBe(320);
    expect(item.fiber).toBe(2);
  });
});

// ── Task 9.1: recordUsage keeps its three generations of additions ──────────
describe('FoodCatalogService.recordUsage — bucket history without clobbering micros or icon', () => {
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const makeSvc = (entries) => {
    const map = new Map(entries.map((e) => [e.id, e]));
    return [new FoodCatalogService({
      catalogStore: {
        findByNormalizedName: async (name) =>
          [...map.values()].find((e) => e.matches(FoodCatalogEntry.normalize(name))) || null,
        getById: async (id) => map.get(id) || null,
        save: async (e) => { map.set(e.id, e); },
      },
      clock: { now: () => EVENING }, createId: () => 'new-id', logger: silent,
    }), map];
  };

  it('a brand-new entry starts its bucket history at the first use', async () => {
    const [svc, map] = makeSvc([]);
    await svc.recordUsage({ name: 'Congee', calories: 200, mealTime: 'morning', grams: 300, unit: 'g', amount: 300 }, 'u');
    const created = [...map.values()][0];
    expect(created.usageByBucket.morning).toEqual({
      count: 1, lastUsed: '2026-09-03', quantity: { grams: 300, unit: 'g', amount: 300 },
    });
  });

  it('a caller that cannot name a bucket advances nothing — no guessed bucket', async () => {
    const [svc, map] = makeSvc([]);
    await svc.recordUsage({ name: 'Congee', calories: 200 }, 'u');
    expect([...map.values()][0].usageByBucket).toEqual({});
  });

  it('a bucket-carrying donation does not clear micros or the icon it does not carry', async () => {
    const existing = new FoodCatalogEntry({
      id: 'e1', name: 'Chili', icon: 'chili-bowl',
      nutrients: { calories: 300, protein: 20, carbs: 30, fat: 10, sodium: 700, fiber: 8 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    });
    const [svc] = makeSvc([existing]);
    // A later capture that answered only sodium, and carries no icon at all.
    await svc.recordUsage({
      name: 'Chili', calories: 310, protein: 21, carbs: 31, fat: 11,
      sodium: 640, microsSource: 'ai', mealTime: 'evening',
    }, 'u');
    expect(existing.usageByBucket.evening).toMatchObject({ count: 1 });
    expect(existing.icon).toBe('chili-bowl');          // Phase 7: fill, never overwrite
    expect(existing.nutrients.sodium).toBe(640);       // donated, per key
    expect(existing.nutrients.fiber).toBe(8);          // NOT cleared by a donation that omits it
    expect(existing.nutrients.calories).toBe(310);
  });

  it('a donation with no provenance still records the bucket but donates no micros', async () => {
    const existing = new FoodCatalogEntry({
      id: 'e1', name: 'Chili',
      nutrients: { calories: 300, protein: 20, carbs: 30, fat: 10, sodium: 700 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    });
    const [svc] = makeSvc([existing]);
    await svc.recordUsage({ name: 'Chili', calories: 300, sodium: 0, mealTime: 'evening' }, 'u');
    expect(existing.usageByBucket.evening).toMatchObject({ count: 1 });
    expect(existing.nutrients.sodium).toBe(700);
  });

  it('a later usage with no portion keeps the portion the bucket already knew', async () => {
    const existing = new FoodCatalogEntry({
      id: 'e1', name: 'Chili', nutrients: { calories: 300 },
      usageByBucket: { evening: { count: 2, lastUsed: '2026-08-30', quantity: { grams: 250, unit: 'g', amount: 250 } } },
      lastUsed: '2026-08-30', createdAt: '2026-01-01T00:00:00Z',
    });
    const [svc] = makeSvc([existing]);
    await svc.recordUsage({ name: 'Chili', calories: 300, mealTime: 'evening' }, 'u');
    expect(existing.usageByBucket.evening).toEqual({
      count: 3, lastUsed: '2026-09-03', quantity: { grams: 250, unit: 'g', amount: 250 },
    });
  });
});
