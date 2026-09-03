import { describe, it, expect } from 'vitest';
import { YamlFoodCatalogDatastore } from './YamlFoodCatalogDatastore.mjs';

const RAW_ENTRY = {
  id: 'e1', name: 'Test Apple', normalizedName: 'test apple',
  nutrients: { calories: 95, protein: 0, carbs: 25, fat: 0 },
  source: 'custom', barcodeUpc: null, useCount: 1, favorite: false,
  lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z',
};

describe('YamlFoodCatalogDatastore.removeById', () => {
  it('returns false for an id that does not exist (caller maps to 404)', async () => {
    const store = new YamlFoodCatalogDatastore({
      dataService: { user: { read: () => [RAW_ENTRY], write: () => true } },
    });
    await expect(store.removeById('missing', 'kckern')).resolves.toBe(false);
  });

  it('removes an existing entry and writes the catalog back without it', async () => {
    let written = null;
    const store = new YamlFoodCatalogDatastore({
      dataService: {
        user: {
          read: () => [RAW_ENTRY],
          write: (_path, data) => { written = data; return true; },
        },
      },
    });
    await expect(store.removeById('e1', 'kckern')).resolves.toBe(true);
    expect(written).toEqual([]);
  });

  it('rejects with a coded CATALOG_WRITE_FAILED error when the write fails', async () => {
    const store = new YamlFoodCatalogDatastore({
      dataService: { user: { read: () => [RAW_ENTRY], write: () => false } },
    });
    try {
      await store.removeById('e1', 'kckern');
      throw new Error('expected removeById to reject');
    } catch (err) {
      expect(err.code).toBe('CATALOG_WRITE_FAILED');
      expect(err.message).toContain('food_catalog');
      expect(err.message).toContain('kckern');
    }
  });
});
