import { describe, it, expect, vi } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';

describe('HealthOperations findNutritionItemsByDate settlement', () => {
  const legacyRow = {
    uuid: 'legacy-1', name: 'Legacy Item', calories: 100, mealTime: 'Breakfast', kind: 'manual', parentId: null,
  };
  const freshRow = {
    uuid: 'fresh-1', name: 'Fresh Item', calories: 200, mealTime: 'Lunch', kind: 'manual', parentId: null,
    settled: false, date: '2026-09-02',
  };
  const agedRow = {
    uuid: 'aged-1', name: 'Aged Item', calories: 300, mealTime: 'Dinner', kind: 'manual', parentId: null,
    settled: false, date: '2026-08-23',
  };

  function buildOps() {
    const rows = [legacyRow, freshRow, agedRow];
    const findByDate = vi.fn(async () => rows);
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByDate },
      today: () => '2026-09-02',
    });
    return { ops, findByDate, rows };
  }

  it('maps legacy rows (no settled key) to settled:true, settledBy:null', async () => {
    const { ops } = buildOps();
    const [legacy] = await ops.findNutritionItemsByDate('kc', '2026-09-02');
    expect(legacy.settled).toBe(true);
    expect(legacy.settledBy).toBeNull();
  });

  it('maps fresh unsettled rows to settled:false, settledBy:null', async () => {
    const { ops } = buildOps();
    const [, fresh] = await ops.findNutritionItemsByDate('kc', '2026-09-02');
    expect(fresh.settled).toBe(false);
    expect(fresh.settledBy).toBeNull();
  });

  it('maps aged unsettled rows (>3 days) to settled:true, settledBy:auto', async () => {
    const { ops } = buildOps();
    const [, , aged] = await ops.findNutritionItemsByDate('kc', '2026-09-02');
    expect(aged.settled).toBe(true);
    expect(aged.settledBy).toBe('auto');
  });

  it('preserves every other field on each row unchanged', async () => {
    const { ops } = buildOps();
    const [legacy, fresh, aged] = await ops.findNutritionItemsByDate('kc', '2026-09-02');

    expect(legacy.uuid).toBe('legacy-1');
    expect(legacy.name).toBe('Legacy Item');
    expect(legacy.calories).toBe(100);
    expect(legacy.mealTime).toBe('Breakfast');
    expect(legacy.kind).toBe('manual');
    expect(legacy.parentId).toBeNull();

    expect(fresh.uuid).toBe('fresh-1');
    expect(fresh.name).toBe('Fresh Item');
    expect(fresh.calories).toBe(200);
    expect(fresh.mealTime).toBe('Lunch');
    expect(fresh.kind).toBe('manual');
    expect(fresh.parentId).toBeNull();

    expect(aged.uuid).toBe('aged-1');
    expect(aged.name).toBe('Aged Item');
    expect(aged.calories).toBe(300);
    expect(aged.mealTime).toBe('Dinner');
    expect(aged.kind).toBe('manual');
    expect(aged.parentId).toBeNull();
  });

  it('does not mutate the raw stored rows (storage is never mutated)', async () => {
    const { ops, rows } = buildOps();
    await ops.findNutritionItemsByDate('kc', '2026-09-02');

    const [rawLegacy, rawFresh, rawAged] = rows;
    expect('settled' in rawLegacy).toBe(false);
    expect(rawFresh.settled).toBe(false);
    expect(rawFresh.settledBy).toBeUndefined();
    expect(rawAged.settled).toBe(false);
    expect(rawAged.settledBy).toBeUndefined();
  });
});

describe('HealthOperations updateNutritionItem settles on edit', () => {
  function buildOps({ existing = { uuid: 'row-1', mealTime: 'morning', settled: false } } = {}) {
    const findByUuid = vi.fn(async () => existing);
    const update = vi.fn(async (username, id, changes) => ({ ...existing, ...changes }));
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByUuid, update },
      today: () => '2026-09-02',
    });
    return { ops, findByUuid, update };
  }

  it('an edit of an unrelated field also stamps settled:true/settledBy:user/settledAt, and the edit survives', async () => {
    const { ops, update } = buildOps();
    const result = await ops.updateNutritionItem('kc', 'row-1', { mealTime: 'evening' });

    expect(update).toHaveBeenCalledTimes(1);
    const [, , persistedChanges] = update.mock.calls[0];
    expect(persistedChanges.mealTime).toBe('evening');
    expect(persistedChanges.settled).toBe(true);
    expect(persistedChanges.settledBy).toBe('user');
    expect(typeof persistedChanges.settledAt).toBe('string');
    expect(persistedChanges.settledAt.length).toBeGreaterThan(0);

    expect(result.item.mealTime).toBe('evening');
    expect(result.item.settled).toBe(true);
    expect(result.changedFields).toContain('mealTime');
    expect(result.changedFields).toContain('settled');
    expect(result.changedFields).toContain('settledBy');
    expect(result.changedFields).toContain('settledAt');
  });

  it('a bare { settled: true } one-tap confirm reaches the store (whitelist regression guard)', async () => {
    const { ops, update } = buildOps();
    await ops.updateNutritionItem('kc', 'row-1', { settled: true });

    expect(update).toHaveBeenCalledTimes(1);
    const [, , persistedChanges] = update.mock.calls[0];
    expect(persistedChanges.settled).toBe(true);
    expect(persistedChanges.settledBy).toBe('user');
    expect(persistedChanges.settledAt).toBeTruthy();
  });

  it('settledAt is a local timestamp, not a UTC ISO string', async () => {
    const { ops, update } = buildOps();
    await ops.updateNutritionItem('kc', 'row-1', { mealTime: 'evening' });

    const [, , persistedChanges] = update.mock.calls[0];
    // A UTC ISO string looks like 2026-09-02T23:59:59.123Z — local timestamps
    // (nowTs24 shape) use a space separator and no trailing Z / milliseconds.
    expect(persistedChanges.settledAt).not.toMatch(/T/);
    expect(persistedChanges.settledAt).not.toMatch(/Z$/);
    expect(persistedChanges.settledAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('returns null (no update call) when the row does not exist', async () => {
    const findByUuid = vi.fn(async () => null);
    const update = vi.fn();
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByUuid, update },
      today: () => '2026-09-02',
    });
    const result = await ops.updateNutritionItem('kc', 'missing', { mealTime: 'evening' });
    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('HealthOperations updateNutritionItem cascades mealTime to a group\'s children', () => {
  const groupRow = {
    uuid: 'g1', id: 'g1', kind: 'group', name: 'Smoothie', mealTime: 'morning', date: '2026-09-02',
  };
  const child1 = { uuid: 'c1', kind: 'item', parentId: 'g1', mealTime: 'morning', date: '2026-09-02' };
  const child2 = { uuid: 'c2', kind: 'item', parentId: 'g1', mealTime: 'morning', date: '2026-09-02' };
  const unrelated = { uuid: 'u1', kind: 'item', parentId: 'some-other-group', mealTime: 'morning', date: '2026-09-02' };

  function buildOps(existing, siblings) {
    const findByUuid = vi.fn(async () => existing);
    const findByDate = vi.fn(async () => siblings);
    const update = vi.fn(async (username, id, changes) => ({ id, ...changes }));
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByUuid, findByDate, update },
      today: () => '2026-09-02',
    });
    return { ops, findByUuid, findByDate, update };
  }

  it('a mealTime update on a GROUP row also moves every row whose parentId matches it', async () => {
    const { ops, findByDate, update } = buildOps(groupRow, [groupRow, child1, child2, unrelated]);

    const result = await ops.updateNutritionItem('kc', 'g1', { mealTime: 'evening' });

    expect(findByDate).toHaveBeenCalledWith('kc', '2026-09-02');
    // The group's own row, plus both of its children — never the unrelated
    // sibling whose parentId points elsewhere.
    expect(update).toHaveBeenCalledTimes(3);
    const childCalls = update.mock.calls.filter(([, id]) => id === 'c1' || id === 'c2');
    expect(childCalls).toHaveLength(2);
    for (const [username, , changes] of childCalls) {
      expect(username).toBe('kc');
      expect(changes).toEqual({ mealTime: 'evening' });
    }
    expect(update.mock.calls.some(([, id]) => id === 'u1')).toBe(false);
    expect(result.cascadedIds.sort()).toEqual(['c1', 'c2']);
  });

  it('an ITEM row update does NOT cascade, even when another row happens to carry a matching parentId', async () => {
    // A row referencing the item as a parent should never occur in real
    // data, but the guard must hold even if it did — cascade is gated on
    // the EDITED row's own kind, not on "does anything point at me".
    const itemRow = { uuid: 'c1', id: 'c1', kind: 'item', mealTime: 'morning', date: '2026-09-02' };
    const dependent = { uuid: 'weird', kind: 'item', parentId: 'c1', mealTime: 'morning', date: '2026-09-02' };
    const { ops, findByDate, update } = buildOps(itemRow, [itemRow, dependent]);

    const result = await ops.updateNutritionItem('kc', 'c1', { mealTime: 'evening' });

    expect(findByDate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toBe('c1');
    expect(result.cascadedIds).toEqual([]);
  });

  it('a rename (no mealTime in the change) on a group does NOT cascade', async () => {
    const { ops, findByDate, update } = buildOps(groupRow, [groupRow, child1, child2]);

    await ops.updateNutritionItem('kc', 'g1', { name: 'Berry Smoothie' });

    expect(findByDate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('HealthOperations deleteNutritionItem is the discard replacement', () => {
  it('hard-deletes the row via deleteById', async () => {
    const existing = { uuid: 'row-1', mealTime: 'morning' };
    const findByUuid = vi.fn(async () => existing);
    const deleteById = vi.fn(async () => true);
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByUuid, deleteById },
      today: () => '2026-09-02',
    });

    const result = await ops.deleteNutritionItem('kc', 'row-1');

    expect(deleteById).toHaveBeenCalledWith('kc', 'row-1');
    expect(result).toEqual({ found: true, deleted: true });
  });

  it('reports not-found without attempting delete when the row is missing', async () => {
    const findByUuid = vi.fn(async () => null);
    const deleteById = vi.fn(async () => true);
    const ops = new HealthOperations({
      healthData: {},
      nutritionItems: { findByUuid, deleteById },
      today: () => '2026-09-02',
    });

    const result = await ops.deleteNutritionItem('kc', 'missing');

    expect(deleteById).not.toHaveBeenCalled();
    expect(result).toEqual({ found: false, deleted: false });
  });
});
