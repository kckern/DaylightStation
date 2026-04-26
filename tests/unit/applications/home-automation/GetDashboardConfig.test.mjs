import { describe, it, expect, vi } from 'vitest';
import { GetDashboardConfig } from '#apps/home-automation/usecases/GetDashboardConfig.mjs';

describe('GetDashboardConfig', () => {
  it('delegates to repository.load()', async () => {
    const repo = { load: vi.fn().mockResolvedValue({ summary: { weather: true }, rooms: [] }) };
    const uc = new GetDashboardConfig({ configRepository: repo });
    const result = await uc.execute();
    expect(repo.load).toHaveBeenCalled();
    expect(result.summary.weather).toBe(true);
  });
  it('throws if configRepository missing', () => {
    expect(() => new GetDashboardConfig({})).toThrow(/configRepository/);
  });
});
