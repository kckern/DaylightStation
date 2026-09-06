import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HealthOperations } from './HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';

let store, ops;
const now = '2026-09-05T23:00:00Z';
const review = { state: 'provisional', capturedAt: now, autoConfirmAt: '2026-09-08T23:00:00Z' };
const base = { userId: 'u', date: '2026-09-05', settled: false, review, version: 1, mealTime: 'afternoon' };
const group = { ...base, uuid: 'group', kind: 'group', grams: 200, calories: 0 };
const child = (uuid, extra = {}) => ({ ...base, uuid, kind: 'food', parentId: 'group', grams: 100, calories: 200, protein: null, ...extra });
beforeEach(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-portion-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
  ops = new HealthOperations({ healthData: {}, nutritionItems: store, clock: { now: () => Date.parse(now) } });
  await store.saveMany([group, child('a'), child('b')]);
});
const changes = { portion: { value: 400, unit: 'g' }, expectedVersion: 1, expectedVersions: { group: 1, a: 1, b: 1 } };
describe('versioned Health portion commands', () => {
  it('scales a whole group atomically while preserving its review deadline and unknowns', async () => {
    const result = await ops.updateNutritionItem('u', 'group', changes);
    expect(result.versions).toEqual({ group: 2, a: 2, b: 2 });
    expect(await store.findByUuid('u', 'group')).toMatchObject({ grams: 400, calories: 0, settled: false, review });
    expect(await store.findByUuid('u', 'a')).toMatchObject({ grams: 200, calories: 400, protein: null, settled: false, review,
      manualFields: expect.arrayContaining(['grams', 'calories']) });
  });
  it('rejects all members if one displayed child version is stale', async () => {
    await store.update('u', 'b', { calories: 150 });
    await expect(ops.updateNutritionItem('u', 'group', changes)).rejects.toMatchObject({ status: 409 });
    expect((await store.findByUuid('u', 'a')).grams).toBe(100);
    expect((await store.findByUuid('u', 'group')).grams).toBe(200);
  });
  it('keeps explicit nutrient corrections alongside a portion change', async () => {
    await ops.updateNutritionItem('u', 'a', { portion: { value: 200, unit: 'g' }, calories: 375, expectedVersion: 1 });
    expect(await store.findByUuid('u', 'a')).toMatchObject({ grams: 200, calories: 375, protein: null, review });
  });
  it('rejects unseen members rather than silently including them', async () => {
    await store.saveMany([child('c')]);
    await expect(ops.updateNutritionItem('u', 'group', changes)).rejects.toMatchObject({ status: 409 });
    expect((await store.findByUuid('u', 'a')).version).toBe(1);
  });
  it('only explicit Confirm ratifies the exact displayed group', async () => {
    await ops.updateNutritionItem('u', 'group', { ...changes, portion: undefined, settled: true });
    for (const id of ['group', 'a', 'b']) expect(await store.findByUuid('u', id)).toMatchObject({ settled: true, settledBy: 'user' });
  });
  it('recovers a committed command after response loss without scaling twice', async () => {
    const payload = { operation: 'entry-update', id: 'group', ...changes };
    await expect(store.runOperation('u', 'op-lost', payload, async () => {
      await ops.updateNutritionItem('u', 'group', changes);
      throw new Error('response lost');
    })).rejects.toThrow('response lost');
    const action = vi.fn();
    const result = await store.runOperation('u', 'op-lost', payload, action);
    expect(action).not.toHaveBeenCalled();
    expect(result).toMatchObject({ item: { grams: 400, version: 2 }, versions: { group: 2, a: 2, b: 2 } });
    expect((await store.findByUuid('u', 'a')).calories).toBe(400);
  });
});
