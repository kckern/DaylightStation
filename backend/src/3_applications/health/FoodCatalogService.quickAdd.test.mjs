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
