// tests/isolated/application/content/ContentQueryService.completedAt.test.mjs
import { describe, test, expect, vi } from 'vitest';
import { ContentQueryService } from "../../../../__capabilities/content-catalog/server/application/ContentQueryService.mjs";
import { RegistryContentCatalogGateway } from "../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs";

describe('ContentQueryService.enrichWithWatchState propagates completedAt', () => {
  test('enriched item carries completedAt from stored progress', async () => {
    const mockAdapter = {
      source: 'plex',
      getStoragePath: vi.fn().mockResolvedValue('plex/14_fitness'),
    };
    const mockRegistry = {
      get: vi.fn().mockReturnValue(mockAdapter),
      list: vi.fn(() => []),
      resolveSource: vi.fn(() => [])
    };
    const mockMemory = {
      listProgress: vi.fn().mockResolvedValue([
        {
          contentId: 'plex:674498',
          playhead: 40,
          duration: 678,
          percent: 6,
          playCount: 2,
          lastPlayed: '2026-04-23 21:06:43',
          watchTime: 705,
          completedAt: '2026-04-20 06:07:44'
        }
      ]),
      listSourceProgress: vi.fn().mockResolvedValue([])
    };
    const service = new ContentQueryService({
      contentCatalog: new RegistryContentCatalogGateway({ registry: mockRegistry }),
      mediaProgressMemory: mockMemory
    });

    const items = [{ id: 'plex:674498', title: 'Week 1 Day 1 - Upper Body' }];
    const enriched = await service.enrichWithWatchState(items, 'plex', 'plex:674496');

    expect(enriched[0].completedAt).toBe('2026-04-20 06:07:44');
    // The library whose completion rule judges this item (watch_completion).
    expect(enriched[0].progressNamespace).toBe('plex/14_fitness');
  });

  test('enriched item has completedAt=null when progress has no completedAt', async () => {
    const mockAdapter = {
      source: 'plex',
      getStoragePath: vi.fn().mockResolvedValue('plex/14_fitness'),
    };
    const mockRegistry = {
      get: vi.fn().mockReturnValue(mockAdapter),
      list: vi.fn(() => []),
      resolveSource: vi.fn(() => [])
    };
    const mockMemory = {
      listProgress: vi.fn().mockResolvedValue([
        {
          contentId: 'plex:100',
          playhead: 40,
          duration: 678,
          percent: 6,
          playCount: 1,
          lastPlayed: '2026-04-23 21:06:43',
          watchTime: 40,
          completedAt: null
        }
      ]),
      listSourceProgress: vi.fn().mockResolvedValue([])
    };
    const service = new ContentQueryService({
      contentCatalog: new RegistryContentCatalogGateway({ registry: mockRegistry }),
      mediaProgressMemory: mockMemory
    });

    const items = [{ id: 'plex:100', title: 'Some show' }];
    const enriched = await service.enrichWithWatchState(items, 'plex', 'plex:99');

    expect(enriched[0].completedAt).toBeNull();
  });

  test('Plex unreachable: each item carries its own record namespace, not the bare source', async () => {
    const mockAdapter = { source: 'plex', getStoragePath: vi.fn().mockResolvedValue('plex') };
    const mockRegistry = { get: vi.fn().mockReturnValue(mockAdapter), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
    const record = { contentId: 'plex:674290', playhead: 16429, duration: 17459, percent: 94, watchTime: 19111, completedAt: null };
    const mockMemory = {
      listProgress: vi.fn().mockResolvedValue([]),
      listSourceProgress: vi.fn().mockResolvedValue([record]),
      listAllProgress: vi.fn().mockResolvedValue([
        { namespaceId: 'plex/14_fitness', progress: record },
        { namespaceId: 'abs/books', progress: { contentId: 'abs:1', playhead: 5, percent: 1 } },
      ]),
    };
    const service = new ContentQueryService({
      contentCatalog: new RegistryContentCatalogGateway({ registry: mockRegistry }),
      mediaProgressMemory: mockMemory
    });

    const enriched = await service.enrichWithWatchState([{ id: 'plex:674290' }], 'plex', 'plex:603407');

    expect(enriched[0].percent).toBe(94);
    // The Fitness rule must judge it; the bare 'plex' would fall to the 90% default.
    expect(enriched[0].progressNamespace).toBe('plex/14_fitness');
  });
});
