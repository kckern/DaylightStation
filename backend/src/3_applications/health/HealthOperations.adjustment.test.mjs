import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HealthOperations } from './HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { DEFAULT_DENSITY_LEVELS } from '#shared/contracts/health/densityLevels.mjs';

const userId = 'u';
const date = '2026-09-05';
const now = '2026-09-05T23:00:00Z';
const review = { state: 'provisional', capturedAt: now, autoConfirmAt: '2026-09-08T23:00:00Z' };
let directory, store, operations, root, children, levels;
const row = (uuid, extra = {}) => ({ uuid, userId, date, version: 1, settled: false, review, kind: 'food',
  grams: 100, calories: 100, protein: null, fiber: 1.234567, ...extra });
const versions = rows => Object.fromEntries(rows.map(item => [item.uuid, item.version]));
const read = () => Promise.all(['group', 'a', 'b'].map(id => store.findByUuid(userId, id)));
const command = (extra = {}) => ({ adjustment: { field: 'calories', value: 450 }, expectedVersion: root.version,
  expectedVersions: versions([root, ...children]), expectedDensityRevision: operations.context().densityRevision, ...extra });
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'health-adjustment-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(directory, rel) } }, logger: { info() {}, warn() {} } });
  levels = structuredClone(DEFAULT_DENSITY_LEVELS);
  operations = new HealthOperations({ healthData: {}, nutritionItems: store, densityLevels: () => levels,
    clock: { now: () => Date.parse(now) } });
  await store.saveMany([row('group', { kind: 'group', grams: 200, calories: 0 }),
    row('a', { parentId: 'group' }), row('b', { parentId: 'group', calories: 200 })]);
  [root, ...children] = await read();
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('atomic Health adjustment commands with the real YAML ledger', () => {
  it('protects manually adjusted portion mass from later enrichment', async () => {
    await operations.updateNutritionItem(userId, root.uuid, command({ adjustment: { field: 'portion', value: 400 } }));
    const [, a, b] = await read();
    expect(a.grams).toBe(200);
    expect(b.grams).toBe(200);
    expect(a.manualFields).toContain('grams');
    expect(b.manualFields).toContain('grams');
  });
  it('persists K100/K200 as K150/K300 at fixed mass and returns the unchanged parent version', async () => {
    const result = await operations.updateNutritionItem(userId, root.uuid, command());
    expect(result.item.calories).toBe(0);
    expect(result.versions).toEqual({ group: 1, a: 2, b: 2 });
    const [parent, a, b] = await read();
    expect(parent).toEqual(root);
    expect(a).toMatchObject({ grams: 100, calories: 150, protein: null, fiber: 1.234567, settled: false, review,
      manualFields: ['calories'], nutrientProvenance: { calories: { source: 'user', grams: 100 } } });
    expect(b).toMatchObject({ grams: 100, calories: 300, settled: false, review });
  });
  it('uses density at fixed mass and reads the ladder once per command', async () => {
    const changes = command({ adjustment: { field: 'density', value: 2.25 } });
    const ladder = vi.spyOn(operations, 'densityLevels');
    const result = await operations.updateNutritionItem(userId, root.uuid, changes);
    expect(ladder).toHaveBeenCalledTimes(1);
    expect(result.versions).toEqual({ group: 1, a: 2, b: 2 });
    expect((await read()).map(item => [item.grams, item.calories])).toEqual([[200, 0], [100, 150], [100, 300]]);
  });

  it('does not rewrite no-op corrections or stamp provenance', async () => {
    const before = await read();
    const result = await operations.updateNutritionItem(userId, root.uuid, command({ adjustment: { field: 'calories', value: 300 } }));
    expect(await read()).toEqual(before);
    expect(result.versions).toEqual({ group: 1, a: 1, b: 1 });
    expect(result.cascadedIds).toEqual([]);
  });

  it('rejects stale child versions atomically', async () => {
    await store.update(userId, 'b', { calories: 210 });
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, command())).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await read()).toEqual(before);
  });

  it('checks newly added membership inside the mutation boundary', async () => {
    const mutate = store.mutateEntries.bind(store);
    vi.spyOn(store, 'mutateEntries').mockImplementationOnce(async (user, change) => {
      await store.saveMany([row('c', { parentId: 'group' })]);
      return mutate(user, change);
    });
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, command())).rejects.toMatchObject({ status: 409 });
    expect(await read()).toEqual(before);
    expect((await store.findByUuid(userId, 'c')).calories).toBe(100);
  });

  it('rejects a changed ladder before writing any rows', async () => {
    const changes = command();
    levels[0].macros.protein_pct += 1;
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, changes)).rejects.toMatchObject({ status: 409, code: 'DENSITY_CONFIGURATION_CHANGED' });
    expect(await read()).toEqual(before);
  });

  it.each([
    { settled: true }, { nutrientProvenance: {} }, { manualFields: ['calories'] }, { calories: 9 }, { portion: { value: 10, unit: 'g' } },
    { factor: 2 }, { restoreAdjustment: [] }, { adjustment: null }, { adjustment: { field: 'calories', value: 1, forged: true } },
    { adjustment: { field: 'sodium', value: 1 } }, { adjustment: { field: 'calories', value: '450' } },
    { adjustment: { field: 'calories', value: -1 } }, { adjustment: { field: 'calories', value: Infinity } },
    { expectedVersion: undefined }, { expectedVersion: 0 }, { expectedVersions: undefined }, { expectedVersions: { a: 1, b: 1 } },
    { expectedVersions: { group: 1, a: '1', b: 1 } }, { expectedDensityRevision: undefined },
  ])('rejects malformed or mixed adjustment commands without writes: %j', async extra => {
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, command(extra))).rejects.toMatchObject({ status: 400 });
    expect(await read()).toEqual(before);
  });

  it('restores exact precision and unknowns while preserving current confirmation and unrelated metadata', async () => {
    const result = await operations.updateNutritionItem(userId, root.uuid, command());
    await operations.updateNutritionItem(userId, 'a', { settled: true, name: 'Renamed', icon: 'test-icon', expectedVersion: 2 });
    const current = await read();
    const restored = await operations.updateNutritionItem(userId, root.uuid, {
      restoreAdjustment: [{ id: 'group', changes: {} },
        { id: 'a', changes: { calories: 100, protein: null, grams: 99.123456789, amount: null, unit: null } },
        { id: 'b', changes: { calories: 200, fiber: 1.234567891 } }],
      expectedVersion: result.versions.group, expectedVersions: versions(current),
    });
    expect(restored.versions).toEqual({ group: 1, a: 4, b: 3 });
    const a = await store.findByUuid(userId, 'a');
    expect(a).toMatchObject({ calories: 100, protein: null, grams: 99.123456789, amount: null, unit: null,
      settled: true, name: 'Renamed', icon: 'test-icon', review: current[1].review,
      manualFields: expect.arrayContaining(['calories', 'grams']), nutrientProvenance: { calories: { source: 'user' } } });
    expect((await store.findByUuid(userId, 'b')).fiber).toBe(1.234567891);
  });

  it.each([
    [{ id: 'group', changes: {} }, { id: 'a', changes: {} }, { id: 'a', changes: {} }],
    [{ id: 'group', changes: {} }, { id: 'a', changes: {} }, { id: 'foreign', changes: {} }],
    [{ id: 'group', changes: {} }],
    [{ id: 'group', changes: { settled: true } }, { id: 'a', changes: {} }, { id: 'b', changes: {} }],
    [{ id: 'group', changes: {} }, { id: 'a', changes: { nutrientProvenance: {} } }, { id: 'b', changes: {} }],
    [{ id: 'group', changes: {} }, { id: 'a', changes: { grams: 0 } }, { id: 'b', changes: {} }],
    [{ id: 'group', changes: {} }, { id: 'a', changes: { unit: '' } }, { id: 'b', changes: {} }],
    [{ id: 'group', changes: {} }, { id: 'a', changes: { calories: -1 } }, { id: 'b', changes: {} }],
  ].map(restoreAdjustment => [restoreAdjustment]))('rejects forged or malformed restore commands: %j', async restoreAdjustment => {
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, {
      restoreAdjustment, expectedVersion: 1, expectedVersions: { group: 1, a: 1, b: 1 },
    })).rejects.toMatchObject({ status: 400 });
    expect(await read()).toEqual(before);
  });

  it('recovers the full result after response loss without applying an adjustment twice', async () => {
    const changes = command();
    const payload = { operation: 'entry-update', id: 'group', ...changes };
    await expect(store.runOperation(userId, 'lost-adjustment', payload, async () => {
      await operations.updateNutritionItem(userId, root.uuid, changes);
      throw new Error('response lost');
    })).rejects.toThrow('response lost');
    const result = await store.runOperation(userId, 'lost-adjustment', payload,
      () => operations.updateNutritionItem(userId, root.uuid, changes));
    expect(result).toMatchObject({ item: { calories: 0 }, versions: { group: 1, a: 2, b: 2 }, cascadedIds: ['a', 'b'] });
    expect((await read()).map(item => item.calories)).toEqual([0, 150, 300]);
  });

  it('rejects a removed member during mutation as a conflict', async () => {
    const mutate = store.mutateEntries.bind(store);
    vi.spyOn(store, 'mutateEntries').mockImplementationOnce(async (user, change) => {
      await mutate(user, { deleteIds: ['b'] });
      return mutate(user, change);
    });
    await expect(operations.updateNutritionItem(userId, root.uuid, command())).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await store.findByUuid(userId, 'a')).toMatchObject({ version: 1, calories: 100 });
  });

  it('rejects stale macro baselines before projecting against changed values', async () => {
    await store.update(userId, 'a', { protein: 10, calories: 0 });
    await expect(operations.updateNutritionItem(userId, 'a', { adjustment: { field: 'protein', value: 0 },
      expectedVersion: 1, expectedVersions: { a: 1 } })).rejects.toMatchObject({ status: 409 });
    expect(await store.findByUuid(userId, 'a')).toMatchObject({ protein: 10, calories: 0, version: 2 });
  });

  it('rejects stale restore versions without overwriting metadata or nutrients', async () => {
    const result = await operations.updateNutritionItem(userId, root.uuid, command());
    await store.update(userId, 'b', { name: 'Updated elsewhere' });
    const before = await read();
    await expect(operations.updateNutritionItem(userId, root.uuid, { expectedVersion: 1, expectedVersions: result.versions,
      restoreAdjustment: [{ id: 'group', changes: {} }, { id: 'a', changes: { calories: 100 } }, { id: 'b', changes: { calories: 200 } }],
    })).rejects.toMatchObject({ status: 409 });
    expect(await read()).toEqual(before);
  });

  it('distinguishes coherent stale membership from malformed restore IDs', async () => {
    const restoreAdjustment = [{ id: 'group', changes: {} }, { id: 'a', changes: {} }, { id: 'b', changes: {} }];
    await store.mutateEntries(userId, { deleteIds: ['b'] });
    await expect(operations.updateNutritionItem(userId, root.uuid, { restoreAdjustment, expectedVersion: 1,
      expectedVersions: { group: 1, a: 1, b: 1 },
    })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

});
