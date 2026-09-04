/**
 * The viewed day, once past the HTTP boundary.
 *
 * Two services write food rows directly (the third path, nutribot, is covered
 * in 3_applications/nutribot). Both used to date every row from the server
 * clock, which is what put yesterday's food on today.
 *
 * Also pinned here: the LOGICAL date follows the viewed day, but `settledAt`
 * is a real instant and must NOT — backdating a row must not backdate the
 * moment it was actually entered.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { TemplateService } from './TemplateService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

// Local 8:30pm on 2026-09-04 -> the clock's bucket is 'night'.
const EVENING = new Date(2026, 8, 4, 20, 30).getTime();
const YESTERDAY = '2026-09-03';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe('FoodCatalogService.quickAdd — the viewed day', () => {
  let entry, nutriList, svc;
  beforeEach(() => {
    entry = new FoodCatalogEntry({
      id: 'e1', name: 'Eggs',
      nutrients: { calories: 140, protein: 12, carbs: 1, fat: 10 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    });
    const map = new Map([[entry.id, entry]]);
    nutriList = { saveMany: async (items) => { nutriList.saved = items; } };
    svc = new FoodCatalogService({
      catalogStore: { getById: async (id) => map.get(id) || null, save: async (e) => { map.set(e.id, e); } },
      nutriListStore: nutriList,
      clock: { now: () => EVENING },
      createId: () => 'log-1',
      logger: silent,
    });
  });

  it('writes the row on the day the client is LOOKING AT, not the server clock day', async () => {
    const item = await svc.quickAdd('e1', 'u', { date: YESTERDAY, mealTime: 'evening' });
    expect(item.date).toBe(YESTERDAY);
    expect(nutriList.saved[0].date).toBe(YESTERDAY);
  });

  it('records the catalog usage against the same viewed day', async () => {
    await svc.quickAdd('e1', 'u', { date: YESTERDAY, mealTime: 'evening' });
    expect(entry.lastUsed).toBe(YESTERDAY);
    expect(entry.usageByBucket?.evening?.lastUsed).toBe(YESTERDAY);
  });

  it('an ABSENT date still means today', async () => {
    const item = await svc.quickAdd('e1', 'u', { mealTime: 'evening' });
    expect(item.date).toBe('2026-09-04');
  });

  it('backdating the row does NOT backdate settledAt — that is a real instant', async () => {
    const item = await svc.quickAdd('e1', 'u', { date: YESTERDAY, mealTime: 'evening' });
    expect(item.date).toBe(YESTERDAY);
    expect(item.settledAt.startsWith('2026-09-04')).toBe(true);
  });

  it('on a PAST day with no meal named, the clock is silent and the day starts at its first meal', async () => {
    // The clock would say 'night'. On a day that has already ended, 8:30pm
    // names no meal on that day (decision 2.24).
    expect((await svc.quickAdd('e1', 'u', { date: YESTERDAY })).mealTime).toBe('morning');
  });

  it('on TODAY with no meal named, the clock still speaks', async () => {
    expect((await svc.quickAdd('e1', 'u', { date: '2026-09-04' })).mealTime).toBe('night');
    expect((await svc.quickAdd('e1', 'u')).mealTime).toBe('night');
  });
});

describe('TemplateService.instantiate — the viewed day', () => {
  let saved, svc;
  const template = {
    id: 't1', name: 'Oatmeal bowl', status: 'active', useCount: 0,
    components: [{ name: 'Oats', role: 'core', calories: 150, protein: 5, carbs: 27, fat: 3, grams: 40, unit: 'g', amount: 40, color: 'green' }],
  };
  beforeEach(() => {
    saved = null;
    svc = new TemplateService({
      templateStore: { getById: async () => template, save: async () => {} },
      nutriListStore: { saveMany: async (rows) => { saved = rows; } },
      clock: { now: () => EVENING },
      createId: (() => { let n = 0; return () => `id-${n++}`; })(),
      logger: silent,
    });
  });

  it('on a PAST day with no meal named, fills from the first meal rather than the clock', async () => {
    await svc.instantiate('t1', 'u', { date: YESTERDAY });
    expect(saved.every((r) => r.date === YESTERDAY)).toBe(true);
    expect(saved.every((r) => r.mealTime === 'morning')).toBe(true);
  });

  it('on TODAY with no meal named, the clock still speaks', async () => {
    await svc.instantiate('t1', 'u', {});
    expect(saved.every((r) => r.date === '2026-09-04')).toBe(true);
    expect(saved.every((r) => r.mealTime === 'night')).toBe(true);
  });

  it('an explicitly named meal always wins, on any day', async () => {
    await svc.instantiate('t1', 'u', { date: YESTERDAY, mealTime: 'evening' });
    expect(saved.every((r) => r.mealTime === 'evening')).toBe(true);
  });
});
