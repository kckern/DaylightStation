import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HealthOperations } from './HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { numericFoodPatches } from '#shared/contracts/health/foodNumericEdit.mjs';

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
  it.each([['grams', 400], ['calories', 600], ['density', 3], ['protein', 45], ['carbs', 60], ['fat', 20]])('saves group %s exactly as previewed', async (field, value) => {
    for (const id of ['a', 'b']) await store.update('u', id, { protein: id === 'a' ? 20 : 10, carbs: 20, fat: 5 });
    const children = await Promise.all(['a', 'b'].map(id => store.findByUuid('u', id)));
    const numericEdit = { field, value };
    const patches = numericFoodPatches({ ...group, children }, numericEdit);
    await ops.updateNutritionItem('u', 'group', { numericEdit, expectedVersions: { group: 1, a: 2, b: 2 } });
    for (const row of [group, ...children]) expect(await store.findByUuid('u', row.uuid)).toMatchObject(patches.get(row.uuid));
    expect((await store.findByUuid('u', 'group')).calories).toBe(0);
  });
  it('rejects mixing a semantic numeric edit with unrelated overrides', async () => {
    await expect(ops.updateNutritionItem('u', 'a', { numericEdit: { field: 'density', value: 3 }, calories: 999 })).rejects.toMatchObject({ status: 400 });
    expect((await store.findByUuid('u', 'a')).calories).toBe(200);
  });
  it('recovers a numeric group edit after response loss without applying its calorie delta twice', async () => {
    for (const id of ['a', 'b']) await store.update('u', id, { protein: 10 });
    const command = { numericEdit: { field: 'protein', value: 40 }, expectedVersions: { group: 1, a: 2, b: 2 } };
    const payload = { operation: 'entry-update', id: 'group', ...command };
    await expect(store.runOperation('u', 'numeric-lost', payload, async () => {
      await ops.updateNutritionItem('u', 'group', command);
      throw new Error('lost');
    })).rejects.toThrow('lost');
    const action = vi.fn();
    await store.runOperation('u', 'numeric-lost', payload, action);
    expect(action).not.toHaveBeenCalled();
    for (const id of ['a', 'b']) expect(await store.findByUuid('u', id)).toMatchObject({ calories: 240, protein: 20, version: 3 });
  });
  it('persists a group density correction atomically with fixed ingredient weights', async () => {
    const result = await ops.updateNutritionItem('u', 'group', { numericEdit: { field: 'density', value: 3 }, expectedVersions: changes.expectedVersions });
    expect(result.versions).toEqual({ group: 1, a: 2, b: 2 });
    expect(await store.findByUuid('u', 'a')).toMatchObject({ grams: 100, calories: 300, protein: null,
      nutrientProvenance: { calories: { source: 'user' } } });
    expect((await store.findByUuid('u', 'group')).calories).toBe(0);
  });
  it('rejects the whole numeric edit when an ingredient version is stale', async () => {
    await store.update('u', 'b', { calories: 150 });
    await expect(ops.updateNutritionItem('u', 'group', { numericEdit: { field: 'density', value: 3 }, expectedVersions: changes.expectedVersions })).rejects.toMatchObject({ status: 409 });
    expect((await store.findByUuid('u', 'a')).calories).toBe(200);
  });
  it('reports a conflict before interpreting a numeric edit against changed or now-unknown nutrition', async () => {
    await store.update('u', 'b', { calories: null });
    await expect(ops.updateNutritionItem('u', 'group', { numericEdit: { field: 'density', value: 3 }, expectedVersions: changes.expectedVersions })).rejects.toMatchObject({ status: 409 });
  });
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
