import { describe, expect, it, vi } from 'vitest';
import { ProviderFitnessContentCatalog } from '#adapters/fitness/ProviderFitnessContentCatalog.mjs';
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';
import { createFitnessPlayableModule } from './fitnessApi.mjs';

describe('Fitness playable composition', () => {
  it('builds the canonical playable service around the semantic content catalog', () => {
    const adapter = { source: 'plex' };
    const contentRegistry = { get: vi.fn().mockReturnValue(adapter) };
    const module = createFitnessPlayableModule({
      configService: {
        getDefaultHouseholdId: () => 'home',
        getHouseholdAppConfig: () => ({ content_source: 'plex' }),
      },
      fitnessConfig: { content_source: 'plex', plex: { library_id: 14 } },
      contentRegistry,
      contentQueryService: {},
    });

    expect(contentRegistry.get).toHaveBeenCalledWith('plex');
    expect(module.fitnessContentAdapter).toBe(adapter);
    expect(module.fitnessContentCatalog).toBeInstanceOf(ProviderFitnessContentCatalog);
    expect(module.fitnessPlayableService).toBeInstanceOf(FitnessPlayableService);
  });
});
