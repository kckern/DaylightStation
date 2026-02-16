// tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { FreshRSSFeedAdapter } from '#adapters/feed/FreshRSSFeedAdapter.mjs';

describe('FreshRSSFeedAdapter', () => {
  let adapter;
  let mockFetch;
  let mockDataService;

  const freshrssHost = 'https://rss.example.com';
  const apiKey = 'test-api-key-123';

  beforeEach(() => {
    mockFetch = jest.fn();
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue({ key: apiKey }),
      },
    };
    adapter = new FreshRSSFeedAdapter({
      freshrssHost,
      dataService: mockDataService,
      fetchFn: mockFetch,
    });
  });

  describe('getCategories', () => {
    test('fetches tag list from GReader API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          tags: [
            { id: 'user/-/label/Tech', type: 'folder' },
            { id: 'user/-/label/News', type: 'folder' },
          ],
        }),
      });

      const categories = await adapter.getCategories('kckern');
      expect(mockFetch).toHaveBeenCalledWith(
        `${freshrssHost}/api/greader.php/reader/api/0/tag/list?output=json`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `GoogleLogin auth=${apiKey}`,
          }),
        })
      );
      expect(categories).toHaveLength(2);
      expect(categories[0].id).toBe('user/-/label/Tech');
    });
  });

  describe('getFeeds', () => {
    test('fetches subscription list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          subscriptions: [
            { id: 'feed/1', title: 'Hacker News', categories: [{ id: 'user/-/label/Tech' }] },
          ],
        }),
      });

      const feeds = await adapter.getFeeds('kckern');
      expect(feeds).toHaveLength(1);
      expect(feeds[0].title).toBe('Hacker News');
    });
  });

  describe('getItems', () => {
    test('fetches stream contents for a feed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          items: [
            {
              id: 'tag:google.com,2005:reader/item/000000000000001F',
              title: 'Test Article',
              summary: { content: '<p>Article body</p>' },
              canonical: [{ href: 'https://example.com/article' }],
              published: 1708000000,
            },
          ],
        }),
      });

      const items = await adapter.getItems('feed/1', 'kckern');
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Test Article');
      expect(items[0].link).toBe('https://example.com/article');
    });
  });

  describe('markRead', () => {
    test('sends edit-tag request', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

      await adapter.markRead(['item-id-1'], 'kckern');
      expect(mockFetch).toHaveBeenCalledWith(
        `${freshrssHost}/api/greader.php/reader/api/0/edit-tag`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('auth', () => {
    test('reads API key from user auth file', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tags: [] }) });
      await adapter.getCategories('kckern');
      expect(mockDataService.user.read).toHaveBeenCalledWith('auth/freshrss', 'kckern');
    });

    test('throws when no API key configured', async () => {
      mockDataService.user.read.mockReturnValue(null);
      await expect(adapter.getCategories('kckern')).rejects.toThrow('FreshRSS API key not configured');
    });
  });
});
