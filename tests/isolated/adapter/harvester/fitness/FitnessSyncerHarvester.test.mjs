import { describe, it, expect, vi } from 'vitest';
import { FitnessSyncerHarvester } from '#adapters/harvester/fitness/FitnessSyncerHarvester.mjs';

describe('FitnessSyncerHarvester token writer policy', () => {
  it('skips without refreshing when this process may not rotate tokens', async () => {
    const httpClient = { get: vi.fn(), post: vi.fn() };
    const authStore = {
      load: vi.fn().mockResolvedValue({ refresh: 'stored-refresh-token' }),
      save: vi.fn(),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const harvester = new FitnessSyncerHarvester({
      httpClient,
      lifelogStore: { load: vi.fn(), save: vi.fn() },
      authStore,
      logger,
      canRefreshTokens: () => false,
    });

    await expect(harvester.harvest('alice')).resolves.toEqual({
      count: 0, status: 'skipped', reason: 'token_refresh_disabled',
    });
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(authStore.save).not.toHaveBeenCalled();
  });
});
