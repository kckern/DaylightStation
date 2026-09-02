import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SavedMealsService } from './SavedMealsService.mjs';

describe('SavedMealsService', () => {
  let store, nutriList, svc;
  beforeEach(() => {
    const meals = new Map();
    store = {
      list: async () => [...meals.values()],
      getById: async (id) => meals.get(id) || null,
      save: async (m) => { meals.set(m.id, m); },
      remove: async (id) => { meals.delete(id); },
    };
    nutriList = { saveMany: vi.fn(async () => {}) };
    svc = new SavedMealsService({
      mealsStore: store, nutriListStore: nutriList,
      clock: { now: () => new Date('2026-09-02T18:00:00Z').getTime() },
      createId: (() => { let n = 0; return () => `id-${n++}`; })(),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('create snapshots items and initializes usage', async () => {
    const meal = await svc.create({
      name: 'Protein breakfast',
      items: [{ name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10 }],
    }, 'u');
    expect(meal.id).toBe('id-0');
    expect(meal.useCount).toBe(0);
    expect(meal.items[0].calories).toBe(140);
  });

  it('create rejects empty items', async () => {
    await expect(svc.create({ name: 'x', items: [] }, 'u')).rejects.toThrow(/items/);
  });

  it('logToDate writes SAVEDMEAL nutrilist rows for the date and bumps usage', async () => {
    const meal = await svc.create({
      name: 'PB', items: [{ name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10 }],
    }, 'u');
    const out = await svc.logToDate(meal.id, 'u', { date: '2026-09-02', mealTime: 'morning' });
    expect(nutriList.saveMany).toHaveBeenCalledTimes(1);
    const rows = nutriList.saveMany.mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      name: 'Eggs', calories: 140, date: '2026-09-02',
      log_uuid: 'SAVEDMEAL', mealTime: 'morning', userId: 'u',
    });
    expect(out.items).toHaveLength(1);
    expect((await store.getById(meal.id)).useCount).toBe(1);
  });

  it('logToDate defaults date to today and mealTime from the hour', async () => {
    const meal = await svc.create({ name: 'PB', items: [{ name: 'Eggs', calories: 140 }] }, 'u');
    await svc.logToDate(meal.id, 'u', {});
    const rows = nutriList.saveMany.mock.calls[0][0];
    expect(rows[0].date).toBe('2026-09-02');
    expect(['morning', 'afternoon', 'evening', 'night']).toContain(rows[0].mealTime);
  });

  it('logToDate defaults to the LOCAL date at evening, not the UTC date (which would be tomorrow)', async () => {
    // 2026-09-02T20:30:00-07:00 is 2026-09-03T03:30:00Z — a naive
    // `.toISOString().slice(0, 10)` reads this as tomorrow (2026-09-03).
    // The local (household, America/Los_Angeles) date is 2026-09-02.
    const evening = new SavedMealsService({
      mealsStore: store, nutriListStore: nutriList,
      clock: { now: () => new Date('2026-09-02T20:30:00-07:00').getTime() },
      createId: (() => { let n = 0; return () => `evening-${n++}`; })(),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const meal = await evening.create({ name: 'PB', items: [{ name: 'Eggs', calories: 140 }] }, 'u');
    await evening.logToDate(meal.id, 'u', {});
    const rows = nutriList.saveMany.mock.calls.at(-1)[0];
    expect(rows[0].date).toBe('2026-09-02');
    expect(rows[0].mealTime).toBe('night');
  });
});
