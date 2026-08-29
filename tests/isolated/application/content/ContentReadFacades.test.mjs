import { describe, expect, it, vi } from 'vitest';
import { ContentDiscoveryService } from '#apps/content/services/ContentDiscoveryService.mjs';
import { ListBrowseService } from '#apps/content/services/ListBrowseService.mjs';

describe('content read facades', () => {
  it('isolates legacy search failure and preserves attribution/counts', async () => {
    const good = { search: vi.fn().mockResolvedValue({ total: 2, items: [{ id: 'a' }, { id: 'b', source: 'own' }] }) };
    const bad = { search: vi.fn().mockRejectedValue(new Error('offline')) };
    const contentCatalog = {
      getItem: vi.fn(),
      sourceNames: () => ['good', 'bad'],
      isSourceSearchable: () => true,
      search: (name, query) => (name === 'good' ? good : bad).search(query),
    };
    const service = new ContentDiscoveryService({
      contentCatalog,
      logger: { warn: vi.fn() },
    });
    await expect(service.searchLegacy({ requestedSources: null, query: { text: 'x' } })).resolves.toEqual({
      kind: 'found',
      query: { text: 'x' },
      sources: ['good'],
      total: 2,
      items: [{ id: 'a', source: 'good' }, { id: 'b', source: 'own' }],
    });
  });

  it('keeps fixed-order lists stable despite shuffle and recent modifiers', async () => {
    const items = [
      { id: 'x', metadata: { fixedOrder: true }, actions: { play: { plex: 'x' } } },
      { id: 'y', actions: { play: { plex: 'y' } } },
    ];
    const contentCatalog = {
      getList: vi.fn().mockResolvedValue(items),
      getItem: vi.fn().mockResolvedValue(null),
      getContainerInfo: vi.fn().mockResolvedValue(null),
      sourcesByCategory: () => [],
      resolveSource: (source, localId) => ({ source, localId }),
      resolveLaunchables: vi.fn(),
      resolvePlayables: vi.fn(),
      sourceNames: () => ['plex'],
    };
    const service = new ListBrowseService({
      contentCatalog,
      contentIdResolver: { resolve: () => ({ source: 'plex', localId: 'root' }) },
      menuMemory: { getAll: () => ({ y: 2, x: 1 }) },
      random: () => 0,
    });
    const result = await service.browse({
      source: 'plex',
      localId: 'root',
      modifiers: { shuffle: true, recent_on_top: true },
    });
    expect(result.items).toEqual(items);
  });
});
