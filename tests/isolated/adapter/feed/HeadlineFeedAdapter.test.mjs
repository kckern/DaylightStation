import { describe, it, expect } from 'vitest';
import { HeadlineFeedAdapter } from '../../../../backend/src/1_adapters/feed/sources/HeadlineFeedAdapter.mjs';
import { IFeedSourceAdapter } from '../../../../backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs';

describe('HeadlineFeedAdapter', () => {
  it('implements IFeedSourceAdapter', () => {
    const adapter = new HeadlineFeedAdapter({ headlineService: {} });
    expect(adapter).toBeInstanceOf(IFeedSourceAdapter);
    expect(adapter.sourceType).toBe('headlines');
    expect(typeof adapter.fetchPage).toBe('function');
  });

  it('returns correct shape from fetchPage', async () => {
    const mockService = {
      getPageList: () => [{ id: 'page1' }],
      getAllHeadlines: async () => ({
        sources: {
          'test-source': {
            label: 'Test Source',
            items: [
              { id: 'h1', title: 'Test Headline', link: 'https://example.com/1', timestamp: new Date().toISOString() }
            ]
          }
        }
      })
    };
    const adapter = new HeadlineFeedAdapter({ headlineService: mockService });
    const result = await adapter.fetchPage({ pageId: 'default', limit: 10 }, 'testuser');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('cursor');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toHaveProperty('id');
    expect(result.items[0].source).toBe('headlines');
  });

  describe('source-diverse distribution', () => {
    function makeService(sourcesMap) {
      return {
        getPageList: () => [{ id: 'page1' }],
        getAllHeadlines: async () => ({ sources: sourcesMap }),
      };
    }

    function makeItems(sourceId, count, baseTime = '2026-02-18T12:00:00Z') {
      return Array.from({ length: count }, (_, i) => ({
        id: `${sourceId}-${i}`,
        title: `${sourceId} headline ${i}`,
        link: `https://${sourceId}.com/article/${i}`,
        timestamp: new Date(new Date(baseTime).getTime() - i * 60000).toISOString(),
      }));
    }

    it('distributes items across sources (no single source dominates)', async () => {
      const sources = {
        wapo: { label: 'WaPo', items: makeItems('wapo', 12) },
        nyt: { label: 'NYT', items: makeItems('nyt', 10) },
        fox: { label: 'Fox', items: makeItems('fox', 8) },
        bbc: { label: 'BBC', items: makeItems('bbc', 6) },
      };
      const adapter = new HeadlineFeedAdapter({ headlineService: makeService(sources) });
      const result = await adapter.fetchPage({ limit: 8 }, 'testuser');

      const sourceIds = result.items.map(i => i.meta.sourceId);
      const uniqueSources = new Set(sourceIds);
      // All 4 sources should appear in 8 items
      expect(uniqueSources.size).toBe(4);
    });

    it('gives each source at least 1 item when available', async () => {
      const sources = {
        a: { label: 'A', items: makeItems('a', 20) },
        b: { label: 'B', items: makeItems('b', 1) },
        c: { label: 'C', items: makeItems('c', 1) },
      };
      const adapter = new HeadlineFeedAdapter({ headlineService: makeService(sources) });
      const result = await adapter.fetchPage({ limit: 10 }, 'testuser');

      const sourceIds = result.items.map(i => i.meta.sourceId);
      expect(sourceIds).toContain('a');
      expect(sourceIds).toContain('b');
      expect(sourceIds).toContain('c');
    });

    it('respects totalLimit', async () => {
      const sources = {
        a: { label: 'A', items: makeItems('a', 50) },
        b: { label: 'B', items: makeItems('b', 50) },
      };
      const adapter = new HeadlineFeedAdapter({ headlineService: makeService(sources) });
      const result = await adapter.fetchPage({ limit: 5 }, 'testuser');

      expect(result.items).toHaveLength(5);
    });

    it('handles sources with uneven item counts', async () => {
      const sources = {
        big: { label: 'Big', items: makeItems('big', 20) },
        small: { label: 'Small', items: makeItems('small', 2) },
      };
      const adapter = new HeadlineFeedAdapter({ headlineService: makeService(sources) });
      const result = await adapter.fetchPage({ limit: 10 }, 'testuser');

      expect(result.items).toHaveLength(10);
      const sourceIds = result.items.map(i => i.meta.sourceId);
      // small gets its 2, big fills the rest
      expect(sourceIds.filter(s => s === 'small')).toHaveLength(2);
      expect(sourceIds.filter(s => s === 'big')).toHaveLength(8);
    });

    it('cursor/offset pagination works with distribution', async () => {
      const sources = {
        a: { label: 'A', items: makeItems('a', 10) },
        b: { label: 'B', items: makeItems('b', 10) },
      };
      const adapter = new HeadlineFeedAdapter({ headlineService: makeService(sources) });

      const page1 = await adapter.fetchPage({ limit: 4 }, 'testuser');
      expect(page1.items).toHaveLength(4);
      expect(page1.cursor).toBeDefined();

      const page2 = await adapter.fetchPage({ limit: 4 }, 'testuser', { cursor: page1.cursor });
      expect(page2.items).toHaveLength(4);
      // Pages should not overlap
      const page1Ids = new Set(page1.items.map(i => i.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });
  });
});
