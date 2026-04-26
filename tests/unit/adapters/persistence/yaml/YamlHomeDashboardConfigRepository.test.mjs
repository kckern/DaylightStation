import { describe, it, expect, vi } from 'vitest';
import { YamlHomeDashboardConfigRepository }
  from '#adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs';

function makeRepo(returnValue) {
  const dataService = {
    household: {
      read: vi.fn().mockReturnValue(returnValue),
    },
  };
  const configService = { getDefaultHouseholdId: () => 'default' };
  return {
    repo: new YamlHomeDashboardConfigRepository({ dataService, configService }),
    dataService,
  };
}

describe('YamlHomeDashboardConfigRepository', () => {
  it('loads and returns the config from household/config/home-dashboard', async () => {
    const { repo, dataService } = makeRepo({
      summary: { weather: true },
      rooms: [{ id: 'lr', label: 'Living Room' }],
    });
    const result = await repo.load();
    expect(dataService.household.read).toHaveBeenCalledWith('config/home-dashboard', 'default');
    expect(result.rooms[0].id).toBe('lr');
  });

  it('returns empty shape when file missing', async () => {
    const { repo } = makeRepo(null);
    const result = await repo.load();
    expect(result).toEqual({ summary: {}, rooms: [] });
  });

  it('throws when dataService missing', () => {
    expect(() => new YamlHomeDashboardConfigRepository({}))
      .toThrow(/dataService/);
  });
});
