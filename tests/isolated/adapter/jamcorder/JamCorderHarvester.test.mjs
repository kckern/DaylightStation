import { describe, it, expect, vi } from 'vitest';
import { JamCorderHarvester } from '#adapters/harvester/other/JamCorderHarvester.mjs';

describe('JamCorderHarvester', () => {
  it('exposes serviceId jamcorder / category other and delegates harvest', async () => {
    const harvestUseCase = { execute: vi.fn().mockResolvedValue({ count: 3, status: 'success' }) };
    const h = new JamCorderHarvester({ harvestUseCase });
    expect(h.serviceId).toBe('jamcorder');
    expect(h.category).toBe('other');
    const res = await h.harvest('household', {});
    expect(res).toEqual({ count: 3, status: 'success' });
    expect(harvestUseCase.execute).toHaveBeenCalledTimes(1);
    expect(h.getStatus()).toMatchObject({ state: 'closed' });
    expect(h.getParams()).toEqual([]);
  });
});
