import { describe, it, expect, vi } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';

describe('HealthOperations pending-nutrition seam', () => {
  it('pendingNutritionAvailable is false without a nutritionInput', () => {
    const ops = new HealthOperations({ healthData: {} });
    expect(ops.pendingNutritionAvailable).toBe(false);
  });

  it('pendingNutritionAvailable is false when nutritionInput lacks listPendingByDate', () => {
    const ops = new HealthOperations({ healthData: {}, nutritionInput: { process() {}, processCallback() {} } });
    expect(ops.pendingNutritionAvailable).toBe(false);
  });

  it('pendingNutritionAvailable is true and listPendingNutrition delegates through', async () => {
    const pending = [{ id: 'log-1', items: [] }];
    const listPendingByDate = vi.fn(async (userId, date) => {
      expect(userId).toBe('kc');
      expect(date).toBe('2026-08-30');
      return pending;
    });
    const ops = new HealthOperations({
      healthData: {},
      nutritionInput: { process() {}, processCallback() {}, listPendingByDate },
    });
    expect(ops.pendingNutritionAvailable).toBe(true);
    const result = await ops.listPendingNutrition('kc', '2026-08-30');
    expect(result[0]).toMatchObject(pending[0]);
    expect(result[0].version).toMatch(/^[a-f0-9]{64}$/);
    expect(listPendingByDate).toHaveBeenCalledWith('kc', '2026-08-30');
  });
});
