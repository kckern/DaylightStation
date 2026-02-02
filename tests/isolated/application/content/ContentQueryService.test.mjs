// tests/isolated/application/content/ContentQueryService.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService', () => {
  describe('constructor', () => {
    it('accepts mediaProgressMemory as optional dependency', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const mockMemory = { get: vi.fn(), getAll: vi.fn() };

      const service = new ContentQueryService({
        registry: mockRegistry,
        mediaProgressMemory: mockMemory
      });

      expect(service).toBeDefined();
    });

    it('works without mediaProgressMemory', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };

      const service = new ContentQueryService({ registry: mockRegistry });

      expect(service).toBeDefined();
    });

    it('accepts legacyPrefixMap as optional dependency', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };

      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: { hymn: 'singing:hymn' }
      });

      expect(service).toBeDefined();
    });
  });

  describe('legacy prefix mapping', () => {
    it('maps hymn:123 to singing:hymn/123', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: {
          hymn: 'singing:hymn',
          scripture: 'reading:scripture'
        }
      });

      const result = service._parseIdFromTextPublic('hymn:123');
      expect(result).toEqual({ source: 'singing', id: 'hymn/123' });
    });

    it('maps scripture:alma-32 to reading:scripture/alma-32', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: {
          scripture: 'reading:scripture'
        }
      });

      const result = service._parseIdFromTextPublic('scripture:alma-32');
      expect(result).toEqual({ source: 'reading', id: 'scripture/alma-32' });
    });

    it('passes through canonical IDs unchanged', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: {}
      });

      const result = service._parseIdFromTextPublic('singing:hymn/123');
      expect(result).toEqual({ source: 'singing', id: 'hymn/123' });
    });

    it('passes through plex IDs unchanged when not in legacy map', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: { hymn: 'singing:hymn' }
      });

      const result = service._parseIdFromTextPublic('plex:456724');
      expect(result).toEqual({ source: 'plex', id: '456724' });
    });

    it('handles implicit numeric IDs (plex)', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: { hymn: 'singing:hymn' }
      });

      const result = service._parseIdFromTextPublic('456724');
      expect(result).toEqual({ source: 'plex', id: '456724' });
    });

    it('handles implicit UUID IDs (immich)', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []), resolveSource: vi.fn(() => []) };
      const service = new ContentQueryService({
        registry: mockRegistry,
        legacyPrefixMap: { hymn: 'singing:hymn' }
      });

      const result = service._parseIdFromTextPublic('ff940f1a-f5ea-4580-a517-dfc68413e215');
      expect(result).toEqual({ source: 'immich', id: 'ff940f1a-f5ea-4580-a517-dfc68413e215' });
    });
  });

  let service;
  let mockRegistry;
  let mockAdapter1;
  let mockAdapter2;

  beforeEach(() => {
    mockAdapter1 = {
      source: 'immich',
      search: vi.fn().mockResolvedValue({ items: [{ id: 'immich:1', source: 'immich' }], total: 1 }),
      getList: vi.fn().mockResolvedValue([{ id: 'immich:album:1', source: 'immich', itemType: 'container' }]),
      getSearchCapabilities: vi.fn().mockReturnValue({ canonical: ['text', 'person'], specific: [] }),
      getQueryMappings: vi.fn().mockReturnValue({ person: 'personIds' }),
      getContainerAliases: vi.fn().mockReturnValue({ playlists: 'album:', albums: 'album:' }),
    };

    mockAdapter2 = {
      source: 'plex',
      search: vi.fn().mockResolvedValue({ items: [{ id: 'plex:1', source: 'plex' }], total: 1 }),
      getList: vi.fn().mockResolvedValue([{ id: 'plex:playlist:1', source: 'plex', itemType: 'container' }]),
      getSearchCapabilities: vi.fn().mockReturnValue({ canonical: ['text'], specific: ['actor'] }),
      getQueryMappings: vi.fn().mockReturnValue({}),
      getContainerAliases: vi.fn().mockReturnValue({ playlists: 'playlist:' }),
    };

    mockRegistry = {
      resolveSource: vi.fn().mockReturnValue([mockAdapter1, mockAdapter2]),
      get: vi.fn().mockImplementation(source => {
        if (source === 'immich') return mockAdapter1;
        if (source === 'plex') return mockAdapter2;
        return null;
      }),
    };

    service = new ContentQueryService({ registry: mockRegistry });
  });

  describe('search', () => {
    it('searches across multiple sources', async () => {
      const result = await service.search({ text: 'test' });

      expect(mockRegistry.resolveSource).toHaveBeenCalledWith(undefined);
      expect(mockAdapter1.search).toHaveBeenCalled();
      expect(mockAdapter2.search).toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
      expect(result.sources).toContain('immich');
      expect(result.sources).toContain('plex');
    });

    it('filters by source', async () => {
      mockRegistry.resolveSource.mockReturnValue([mockAdapter1]);

      const result = await service.search({ source: 'gallery', text: 'test' });

      expect(mockRegistry.resolveSource).toHaveBeenCalledWith('gallery');
      expect(result.items).toHaveLength(1);
    });

    it('translates canonical keys to adapter-specific', async () => {
      mockRegistry.resolveSource.mockReturnValue([mockAdapter1]);

      await service.search({ person: 'alice' });

      expect(mockAdapter1.search).toHaveBeenCalledWith(
        expect.objectContaining({ personIds: 'alice' })
      );
    });

    it('handles adapter failures gracefully', async () => {
      mockAdapter2.search.mockRejectedValue(new Error('Connection failed'));

      const result = await service.search({ text: 'test' });

      expect(result.items).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].source).toBe('plex');
    });
  });

  describe('list', () => {
    it('lists containers from alias', async () => {
      const result = await service.list({ from: 'playlists' });

      // getList receives full query object with resolved container path
      expect(mockAdapter1.getList).toHaveBeenCalledWith({ from: 'album:' });
      expect(mockAdapter2.getList).toHaveBeenCalledWith({ from: 'playlist:' });
      expect(result.items).toHaveLength(2);
    });

    it('passes adapter-specific params to getList', async () => {
      mockRegistry.resolveSource.mockReturnValue([mockAdapter2]);

      await service.list({ from: 'playlists', plex: { libraryName: 'Music' } });

      expect(mockAdapter2.getList).toHaveBeenCalledWith({
        from: 'playlist:',
        plex: { libraryName: 'Music' }
      });
    });

    it('returns empty for unknown alias', async () => {
      mockAdapter1.getContainerAliases.mockReturnValue({});
      mockAdapter2.getContainerAliases.mockReturnValue({});

      const result = await service.list({ from: 'unknown' });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    describe('#enrichWithWatchState (tested via resolve)', () => {
      it('adds percent field from mediaProgressMemory', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95, playhead: 1800, duration: 1900 };
            if (itemId === 'plex:456') return { percent: 10, playhead: 100, duration: 1000 };
            return null;
          }),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        // Use filter=none, pick=all to bypass selection and test enrichment directly
        const result = await service.resolve('plex', 'shows/123',
          { now: new Date() },
          { filter: 'none', pick: 'all' }
        );

        // Items should be enriched with percent (lookup by ID to be order-agnostic)
        const item123 = result.items.find(i => i.id === 'plex:123');
        const item456 = result.items.find(i => i.id === 'plex:456');
        expect(item123.percent).toBe(95);
        expect(item456.percent).toBe(10);
      });

      it('sets watched=true when percent >= 90', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95, playhead: 1800, duration: 1900 };
            if (itemId === 'plex:456') return { percent: 10, playhead: 100, duration: 1000 };
            return null;
          }),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        // Use filter=none, pick=all to bypass selection and test enrichment directly
        const result = await service.resolve('plex', 'shows/123',
          { now: new Date() },
          { filter: 'none', pick: 'all' }
        );

        // Lookup by ID to be order-agnostic
        const item123 = result.items.find(i => i.id === 'plex:123');
        const item456 = result.items.find(i => i.id === 'plex:456');
        expect(item123.watched).toBe(true);
        expect(item456.watched).toBe(false);
      });

      it('returns items unchanged when no mediaProgressMemory', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const service = new ContentQueryService({
          registry: mockRegistry
          // no mediaProgressMemory
        });

        const result = await service.resolve('plex', 'shows/123', { now: new Date() });

        expect(result.items[0].id).toBe('plex:123');
        expect(result.items[0].percent).toBeUndefined();
      });

      it('throws for unknown source', async () => {
        const mockRegistry = {
          get: vi.fn(() => null),
          list: vi.fn(() => ['plex'])
        };

        const service = new ContentQueryService({
          registry: mockRegistry
        });

        await expect(service.resolve('unknown', 'path/123')).rejects.toThrow('Unknown source: unknown');
      });

      it('throws descriptive error when adapter lacks resolvePlayables', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({ name: 'broken-adapter' })),
          list: vi.fn(() => ['broken'])
        };

        const service = new ContentQueryService({ registry: mockRegistry });

        await expect(service.resolve('broken', 'path'))
          .rejects.toThrow('Adapter broken does not support resolvePlayables');
      });

      it('preserves priority field from source items', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1', priority: 'high' },
              { id: 'plex:456', title: 'Episode 2', priority: 'low' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async () => null),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123',
          { now: new Date() },
          { filter: 'none', pick: 'all' }
        );

        // Priority from source should be preserved
        expect(result.items[0].priority).toBe('high');
        expect(result.items[1].priority).toBe('low');
      });

      it('sets priority to in_progress when percent > 0 and < 90', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async (itemId) => {
            if (itemId === 'plex:456') return { percent: 45 };
            return null;
          }),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123',
          { now: new Date() },
          { filter: 'none', pick: 'all' }
        );

        // Item with 45% should get in_progress priority
        const inProgressItem = result.items.find(i => i.id === 'plex:456');
        expect(inProgressItem.priority).toBe('in_progress');

        // Item with no watch state should have no priority
        const unwatchedItem = result.items.find(i => i.id === 'plex:123');
        expect(unwatchedItem.priority).toBeUndefined();
      });
    });

    describe('ItemSelectionService integration', () => {
      it('applies ItemSelectionService to filter watched items', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' },
              { id: 'plex:789', title: 'Episode 3' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95 }; // watched
            if (itemId === 'plex:456') return { percent: 10 }; // in progress
            return null; // not started
          }),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123', {
          now: new Date(),
          containerType: 'folder'
        });

        // With watchlist strategy (default for folder), watched items filtered out
        // Should return in_progress first (plex:456), then unwatched (plex:789)
        expect(result.items.length).toBeLessThan(3);
        expect(result.items.some(i => i.id === 'plex:123')).toBe(false); // watched filtered
        expect(result.strategy.name).toBe('watchlist');
      });

      it('returns all items when filter=none and pick=all override', async () => {
        const mockRegistry = {
          get: vi.fn(() => ({
            resolvePlayables: vi.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: vi.fn(async () => 'plex/1_shows')
          })),
          list: vi.fn(() => ['plex'])
        };

        const mockMemory = {
          get: vi.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95 }; // watched
            return null;
          }),
          getAll: vi.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123',
          { now: new Date() },
          { filter: 'none', pick: 'all' }
        );

        // With filter=none and pick=all, all items returned including watched
        expect(result.items.length).toBe(2);
        expect(result.items.some(i => i.id === 'plex:123')).toBe(true); // watched item included
      });
    });
  });
});
