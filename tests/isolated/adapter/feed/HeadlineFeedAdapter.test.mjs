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
    expect(result.items[0].source).toBe('headline');
  });
});
