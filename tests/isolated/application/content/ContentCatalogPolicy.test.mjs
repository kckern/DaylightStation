import { describe, expect, it, vi } from 'vitest';
import { BrowseCatalogService } from '#apps/content/services/BrowseCatalogService.mjs';
import { ContentAccessPolicyService } from '#apps/content/services/ContentAccessPolicyService.mjs';

describe('content configuration queries', () => {
  it('normalizes Browse entries without exposing configuration loading to the API', () => {
    const service = new BrowseCatalogService({
      loadMediaConfig: () => ({ browse: [{ source: 'plex', label: 'TV' }, null, { label: 'invalid' }] }),
    });
    expect(service.getEntries()).toEqual([{ source: 'plex', label: 'TV' }]);
  });

  it('preserves schedule and launch-target response values', () => {
    const loadSourceConfig = vi.fn((name) => name === 'games'
      ? {
          schedule: { weekdays: ['monday'] },
          launch: { device_targets: { garage: { allow: ['game:1', '', null] } } },
        }
      : {});
    const service = new ContentAccessPolicyService({
      loadSourceConfig,
      checkSchedule: () => ({ available: false, nextWindow: 'tomorrow' }),
    });

    expect(service.schedule()).toEqual({
      available: false,
      nextWindow: 'tomorrow',
      schedule: { weekdays: ['monday'] },
    });
    expect(service.launchTargets('retroarch')).toEqual([
      { deviceId: 'garage', allow: ['game:1'] },
    ]);
    expect(loadSourceConfig).toHaveBeenLastCalledWith('games');
  });
});
