// tests/isolated/adapter/content/query/QueryAdapter.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryAdapter } from '#adapters/content/query/QueryAdapter.mjs';

// Mock file adapter that returns video items
function createMockFileAdapter(videos = []) {
  return {
    source: 'files',
    getList: vi.fn(async () => videos),
    getItem: vi.fn(async (id) => {
      const v = videos.find(v => v.localId === id);
      return v ? { ...v, mediaUrl: `/media/${id}` } : null;
    }),
  };
}

// Mock progress memory
function createMockProgress(watchedIds = []) {
  return {
    get: vi.fn(async (key) => {
      if (watchedIds.includes(key)) return { percent: 95 };
      return { percent: 0 };
    }),
  };
}

describe('QueryAdapter', () => {
  describe('IContentSource interface', () => {
    it('has source = "query"', () => {
      const adapter = new QueryAdapter({
        savedQueryService: { getQuery: () => null },
      });
      expect(adapter.source).toBe('query');
    });

    it('has prefix "query"', () => {
      const adapter = new QueryAdapter({
        savedQueryService: { getQuery: () => null },
      });
      expect(adapter.prefixes).toEqual([{ prefix: 'query' }]);
    });
  });

  describe('getItem', () => {
    it('returns query definition as item', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'dailynews'
            ? { title: 'Daily News', source: 'freshvideo', filters: { sources: ['news/cnn'] } }
            : null,
        },
      });
      const item = await adapter.getItem('query:dailynews');
      expect(item).not.toBeNull();
      expect(item.title).toBe('Daily News');
      expect(item.id).toBe('query:dailynews');
      expect(item.metadata.queryType).toBe('freshvideo');
    });

    it('returns null for unknown query', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: { getQuery: () => null },
      });
      expect(await adapter.getItem('query:nonexistent')).toBeNull();
    });

    it('strips query: prefix from id', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'dailynews'
            ? { title: 'Daily News', source: 'freshvideo', filters: { sources: [] } }
            : null,
        },
      });
      const item = await adapter.getItem('dailynews');
      expect(item).not.toBeNull();
    });
  });

  describe('resolvePlayables (freshvideo)', () => {
    it('returns selected video from freshvideo query', async () => {
      const videos = [
        { localId: 'video/news/cnn/20260208.mp4', itemType: 'leaf', title: 'CNN Feb 8' },
        { localId: 'video/news/cnn/20260207.mp4', itemType: 'leaf', title: 'CNN Feb 7' },
      ];

      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: () => ({
            title: 'Daily News',
            source: 'freshvideo',
            filters: { sources: ['news/cnn'] },
          }),
        },
        fileAdapter: createMockFileAdapter(videos),
        mediaProgressMemory: createMockProgress([]),
      });

      const playables = await adapter.resolvePlayables('query:dailynews');
      expect(playables.length).toBeGreaterThan(0);
      // Should pick the latest (20260208) since none are watched
      expect(playables[0].localId).toBe('video/news/cnn/20260208.mp4');
    });

    it('filters out watched videos', async () => {
      const videos = [
        { localId: 'video/news/cnn/20260208.mp4', itemType: 'leaf', title: 'CNN Feb 8' },
        { localId: 'video/news/cnn/20260207.mp4', itemType: 'leaf', title: 'CNN Feb 7' },
      ];

      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: () => ({
            title: 'Daily News',
            source: 'freshvideo',
            filters: { sources: ['news/cnn'] },
          }),
        },
        fileAdapter: createMockFileAdapter(videos),
        mediaProgressMemory: createMockProgress(['video/news/cnn/20260208.mp4']),
      });

      const playables = await adapter.resolvePlayables('query:dailynews');
      expect(playables.length).toBe(1);
      expect(playables[0].localId).toBe('video/news/cnn/20260207.mp4');
    });

    it('returns empty array for unknown query', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: { getQuery: () => null },
      });
      const playables = await adapter.resolvePlayables('query:nonexistent');
      expect(playables).toEqual([]);
    });

    it('respects source priority across multiple sources', async () => {
      // Source 0 (higher priority) has older video, source 1 has same-date video
      const cnnVideos = [
        { localId: 'video/news/cnn/20260208.mp4', itemType: 'leaf', title: 'CNN Feb 8' },
      ];
      const azVideos = [
        { localId: 'video/news/az/20260208.mp4', itemType: 'leaf', title: 'AZ Feb 8' },
      ];

      // File adapter returns different lists based on path
      const fileAdapter = {
        source: 'files',
        getList: vi.fn(async (path) => {
          if (path === 'video/news/cnn') return cnnVideos;
          if (path === 'video/news/az') return azVideos;
          return [];
        }),
        getItem: vi.fn(async (id) => ({
          localId: id, title: id, mediaUrl: `/media/${id}`,
        })),
      };

      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: () => ({
            title: 'Daily News',
            source: 'freshvideo',
            filters: { sources: ['news/cnn', 'news/az'] },
          }),
        },
        fileAdapter,
        mediaProgressMemory: createMockProgress([]),
      });

      const playables = await adapter.resolvePlayables('query:dailynews');
      expect(playables.length).toBe(1);
      // Same date, CNN has higher priority (index 0)
      expect(playables[0].localId).toBe('video/news/cnn/20260208.mp4');
    });
  });

  describe('getList', () => {
    it('returns query definition as list container', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: () => ({
            title: 'Daily News',
            source: 'freshvideo',
            filters: { sources: ['news/cnn'] },
          }),
          listQueries: () => ['dailynews'],
        },
      });
      const result = await adapter.getList('query:dailynews');
      expect(result).not.toBeNull();
      expect(result.title).toBe('Daily News');
    });
  });
});
