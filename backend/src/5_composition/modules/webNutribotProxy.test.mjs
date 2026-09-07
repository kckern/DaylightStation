import { it, expect } from 'vitest';
import { createWebNutribotProxy } from './webNutribotProxy.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';

it('forwards read-only meal suggestions through the same deferred adapter used by Health', async () => {
  const proxy = createWebNutribotProxy();
  const health = new HealthOperations({ healthData: {}, nutritionInput: proxy });
  const input = { userId: 'u', date: '2026-09-06', bucket: 'evening', selectedIds: [] };
  await expect(health.suggestMealGroups(input)).rejects.toThrow('not yet initialized');
  proxy._delegate = { marker: 'delegate', async suggestMealGroups(received) {
    expect(this.marker).toBe('delegate'); expect(received).toBe(input);
    return { committed: false, groups: [], proposals: [] };
  } };
  await expect(health.suggestMealGroups(input)).resolves.toMatchObject({ committed: false, groups: [] });
});
