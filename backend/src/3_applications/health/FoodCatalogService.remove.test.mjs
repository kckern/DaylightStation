import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

describe('FoodCatalogService.remove', () => {
  let store, svc, entry;

  beforeEach(() => {
    entry = new FoodCatalogEntry({
      id: 'e1', name: 'Test Apple',
      nutrients: { calories: 95, protein: 0, carbs: 25, fat: 0 },
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
    });
    store = {
      removeById: async (id) => (id === entry.id ? true : false),
    };
    svc = new FoodCatalogService({
      catalogStore: store,
      clock: { now: () => Date.now() },
      createId: () => 'id-1',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('removes an existing entry', async () => {
    await expect(svc.remove('e1', 'u')).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND for a missing id', async () => {
    await expect(svc.remove('missing', 'u')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('propagates a CATALOG_WRITE_FAILED error from the store unchanged', async () => {
    const writeErr = new Error('CATALOG_WRITE_FAILED: nope');
    writeErr.code = 'CATALOG_WRITE_FAILED';
    store.removeById = async () => { throw writeErr; };
    await expect(svc.remove('e1', 'u')).rejects.toMatchObject({ code: 'CATALOG_WRITE_FAILED' });
  });
});
