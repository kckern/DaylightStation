import { describe, expect, it, vi } from 'vitest';
import { FoodCatalogService } from '#apps/health/FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

describe('FoodCatalogService quick-add', () => {
  it('persists the item and catalog usage with the same current date', async () => {
    const entry = new FoodCatalogEntry({
      id: 'food-1', name: 'Apple', nutrients: { calories: 95, protein: 1, carbs: 25, fat: 0 },
      lastUsed: '2026-08-01', createdAt: '2026-08-01T00:00:00.000Z',
    });
    const catalogStore = { getById: vi.fn().mockResolvedValue(entry), save: vi.fn() };
    const nutriListStore = { saveMany: vi.fn() };
    const service = new FoodCatalogService({
      catalogStore,
      nutriListStore,
      clock: { now: () => Date.parse('2026-08-28T12:00:00.000Z') },
      createId: () => 'item-1',
      logger: { info: vi.fn(), debug: vi.fn() },
    });

    await expect(service.quickAdd('food-1', 'user_1')).resolves.toMatchObject({
      uuid: 'item-1', date: '2026-08-28', log_uuid: 'QUICKADD',
    });
    expect(nutriListStore.saveMany).toHaveBeenCalledOnce();
    expect(entry.lastUsed).toBe('2026-08-28');
    expect(entry.useCount).toBe(2);
    expect(catalogStore.save).toHaveBeenCalledWith(entry, 'user_1');
  });
});
