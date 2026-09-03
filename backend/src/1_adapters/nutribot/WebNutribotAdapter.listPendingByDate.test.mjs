import { describe, it, expect } from 'vitest';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';

describe('WebNutribotAdapter.listPendingByDate', () => {
  it('delegates to foodLogStore.findPendingByDate(userId, date)', async () => {
    const pending = [{ id: 'log-1', status: 'pending' }];
    const foodLogStore = {
      findPendingByDate: async (userId, date) => {
        expect(userId).toBe('kc');
        expect(date).toBe('2026-08-30');
        return pending;
      },
    };
    const adapter = new WebNutribotAdapter({
      inputRouter: {},
      foodLogStore,
      logger: { debug() {}, error() {} },
    });

    const result = await adapter.listPendingByDate('kc', '2026-08-30');
    expect(result).toBe(pending);
  });

  it('throws a clear error when no foodLogStore was configured', async () => {
    const adapter = new WebNutribotAdapter({ inputRouter: {} });
    await expect(adapter.listPendingByDate('kc', '2026-08-30')).rejects.toThrow(/foodLogStore/);
  });
});
