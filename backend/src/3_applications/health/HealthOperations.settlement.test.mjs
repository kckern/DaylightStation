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
