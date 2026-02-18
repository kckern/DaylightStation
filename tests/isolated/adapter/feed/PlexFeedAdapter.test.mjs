import { jest } from '@jest/globals';
import { PlexFeedAdapter } from '#adapters/feed/sources/PlexFeedAdapter.mjs';

function makeMockRegistry(items) {
  return {
    get: () => ({
      getList: jest.fn().mockResolvedValue(items),
    }),
  };
}

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    localId: String(1000 + i),
    id: `plex:${1000 + i}`,
    title: `Episode ${i}`,
    subtitle: 'Test Artist',
    thumbnail: `/thumb/${i}`,
    duration: 2700,
    metadata: { type: 'track', addedAt: '2026-01-01', viewCount: 0 },
  }));
}

describe('PlexFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn() };

  test('sourceType is plex', () => {
    const adapter = new PlexFeedAdapter({ logger });
    expect(adapter.sourceType).toBe('plex');
  });

  describe('parentIds weighted selection', () => {
    test('fetches from one of the weighted parentIds', async () => {
      const mockItems = makeItems(5);
      const mockGetList = jest.fn().mockResolvedValue(mockItems);
      const registry = { get: () => ({ getList: mockGetList }) };

      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });
      const query = {
        tier: 'library',
        priority: 5,
        limit: 1,
        params: {
          mode: 'children',
          parentIds: [
            { id: 7578, weight: 3 },
            { id: 481800, weight: 2 },
            { id: 242600, weight: 1 },
          ],
          unwatched: true,
        },
      };

      const result = await adapter.fetchItems(query, 'testuser');

      expect(mockGetList).toHaveBeenCalledTimes(1);
      const calledWith = mockGetList.mock.calls[0][0];
      expect(['7578', '481800', '242600']).toContain(calledWith);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('plex');
      expect(result[0].tier).toBe('library');
    });

    test('sets meta.playable on items from parentIds', async () => {
      const mockItems = makeItems(3);
      const registry = makeMockRegistry(mockItems);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'library',
        limit: 1,
        params: {
          mode: 'children',
          parentIds: [{ id: 7578, weight: 1 }],
        },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(result[0].meta.playable).toBe(true);
    });

    test('sets meta.duration from item.duration', async () => {
      const mockItems = [{
        localId: '100',
        id: 'plex:100',
        title: 'Test',
        subtitle: 'Artist',
        thumbnail: '/thumb',
        duration: 2700,
        metadata: { type: 'track', viewCount: 0 },
      }];
      const registry = makeMockRegistry(mockItems);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'library',
        limit: 1,
        params: { mode: 'children', parentIds: [{ id: 1, weight: 1 }] },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(result[0].meta.duration).toBe(2700);
    });

    test('falls back to single parentId when parentIds absent', async () => {
      const mockItems = makeItems(2);
      const mockGetList = jest.fn().mockResolvedValue(mockItems);
      const registry = { get: () => ({ getList: mockGetList }) };
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'compass',
        limit: 1,
        params: { mode: 'children', parentId: 99999 },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(mockGetList).toHaveBeenCalledWith('99999');
      expect(result).toHaveLength(1);
      expect(result[0].meta.playable).toBe(true);
    });

    test('filters unwatched items when unwatched=true', async () => {
      const items = [
        { localId: '1', title: 'Watched', thumbnail: '/t', metadata: { viewCount: 3 } },
        { localId: '2', title: 'Unwatched', thumbnail: '/t', metadata: { viewCount: 0 } },
      ];
      const registry = makeMockRegistry(items);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        limit: 5,
        params: { mode: 'children', parentIds: [{ id: 1, weight: 1 }], unwatched: true },
      };

      const result = await adapter.fetchItems(query, 'user');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unwatched');
    });
  });
});
