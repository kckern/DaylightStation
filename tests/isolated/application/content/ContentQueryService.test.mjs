// tests/isolated/application/content/ContentQueryService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService', () => {
  describe('constructor', () => {
    it('accepts mediaProgressMemory as optional dependency', () => {
      const mockRegistry = { get: jest.fn(), list: jest.fn(() => []), resolveSource: jest.fn(() => []) };
      const mockMemory = { get: jest.fn(), getAll: jest.fn() };

      const service = new ContentQueryService({
        registry: mockRegistry,
        mediaProgressMemory: mockMemory
      });

      expect(service).toBeDefined();
    });

    it('works without mediaProgressMemory', () => {
      const mockRegistry = { get: jest.fn(), list: jest.fn(() => []), resolveSource: jest.fn(() => []) };

      const service = new ContentQueryService({ registry: mockRegistry });

      expect(service).toBeDefined();
    });
  });

  let service;
  let mockRegistry;
  let mockAdapter1;
  let mockAdapter2;

  beforeEach(() => {
    mockAdapter1 = {
      source: 'immich',
      search: jest.fn().mockResolvedValue({ items: [{ id: 'immich:1', source: 'immich' }], total: 1 }),
      getList: jest.fn().mockResolvedValue([{ id: 'immich:album:1', source: 'immich', itemType: 'container' }]),
      getSearchCapabilities: jest.fn().mockReturnValue({ canonical: ['text', 'person'], specific: [] }),
      getQueryMappings: jest.fn().mockReturnValue({ person: 'personIds' }),
      getContainerAliases: jest.fn().mockReturnValue({ playlists: 'album:', albums: 'album:' }),
    };

    mockAdapter2 = {
      source: 'plex',
      search: jest.fn().mockResolvedValue({ items: [{ id: 'plex:1', source: 'plex' }], total: 1 }),
      getList: jest.fn().mockResolvedValue([{ id: 'plex:playlist:1', source: 'plex', itemType: 'container' }]),
      getSearchCapabilities: jest.fn().mockReturnValue({ canonical: ['text'], specific: ['actor'] }),
      getQueryMappings: jest.fn().mockReturnValue({}),
      getContainerAliases: jest.fn().mockReturnValue({ playlists: 'playlist:' }),
    };

    mockRegistry = {
      resolveSource: jest.fn().mockReturnValue([mockAdapter1, mockAdapter2]),
      get: jest.fn().mockImplementation(source => {
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
          get: jest.fn(() => ({
            resolvePlayables: jest.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: jest.fn(async () => 'plex/1_shows')
          })),
          list: jest.fn(() => ['plex'])
        };

        const mockMemory = {
          get: jest.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95, playhead: 1800, duration: 1900 };
            if (itemId === 'plex:456') return { percent: 10, playhead: 100, duration: 1000 };
            return null;
          }),
          getAll: jest.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123', { now: new Date() });

        // Items should be enriched with percent
        expect(result.items[0].percent).toBe(95);
        expect(result.items[1].percent).toBe(10);
      });

      it('sets watched=true when percent >= 90', async () => {
        const mockRegistry = {
          get: jest.fn(() => ({
            resolvePlayables: jest.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' },
              { id: 'plex:456', title: 'Episode 2' }
            ]),
            getStoragePath: jest.fn(async () => 'plex/1_shows')
          })),
          list: jest.fn(() => ['plex'])
        };

        const mockMemory = {
          get: jest.fn(async (itemId) => {
            if (itemId === 'plex:123') return { percent: 95, playhead: 1800, duration: 1900 };
            if (itemId === 'plex:456') return { percent: 10, playhead: 100, duration: 1000 };
            return null;
          }),
          getAll: jest.fn()
        };

        const service = new ContentQueryService({
          registry: mockRegistry,
          mediaProgressMemory: mockMemory
        });

        const result = await service.resolve('plex', 'shows/123', { now: new Date() });

        expect(result.items[0].watched).toBe(true);
        expect(result.items[1].watched).toBe(false);
      });

      it('returns items unchanged when no mediaProgressMemory', async () => {
        const mockRegistry = {
          get: jest.fn(() => ({
            resolvePlayables: jest.fn(async () => [
              { id: 'plex:123', title: 'Episode 1' }
            ]),
            getStoragePath: jest.fn(async () => 'plex/1_shows')
          })),
          list: jest.fn(() => ['plex'])
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
          get: jest.fn(() => null),
          list: jest.fn(() => ['plex'])
        };

        const service = new ContentQueryService({
          registry: mockRegistry
        });

        await expect(service.resolve('unknown', 'path/123')).rejects.toThrow('Unknown source: unknown');
      });
    });
  });
});
