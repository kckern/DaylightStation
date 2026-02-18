// tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs
import { jest } from '@jest/globals';
import { FreshRSSSourceAdapter } from '#adapters/feed/sources/FreshRSSSourceAdapter.mjs';

describe('FreshRSSSourceAdapter', () => {
  let adapter;
  let mockFreshRSSAdapter;

  beforeEach(() => {
    mockFreshRSSAdapter = {
      getItems: jest.fn().mockResolvedValue({ items: [], continuation: null }),
      markRead: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: mockFreshRSSAdapter,
    });
  });

  describe('markRead', () => {
    test('strips freshrss: prefix and delegates to low-level adapter', async () => {
      await adapter.markRead(['freshrss:item-1', 'freshrss:item-2'], 'kckern');

      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(
        ['item-1', 'item-2'],
        'kckern'
      );
    });

    test('handles IDs without prefix gracefully', async () => {
      await adapter.markRead(['item-1'], 'kckern');

      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(
        ['item-1'],
        'kckern'
      );
    });

    test('no-ops when freshRSSAdapter is null', async () => {
      const nullAdapter = new FreshRSSSourceAdapter({ freshRSSAdapter: null });
      await expect(nullAdapter.markRead(['freshrss:item-1'], 'kckern')).resolves.toBeUndefined();
    });
  });

  describe('fetchPage — two-pass prioritization', () => {
    const makeItem = (id, title, feedId = 'feed/1', feedTitle = 'Test Feed') => ({
      id, title, content: '', link: `https://example.com/${id}`,
      published: new Date('2026-02-18T12:00:00Z'), author: null,
      feedTitle, feedId, categories: [],
    });

    test('returns unread items first, then read items shuffled', async () => {
      const unreadItems = [makeItem('u1', 'Unread 1'), makeItem('u2', 'Unread 2')];
      const allItems = [makeItem('u1', 'Unread 1'), makeItem('u2', 'Unread 2'), makeItem('r1', 'Read 1'), makeItem('r2', 'Read 2')];

      mockFreshRSSAdapter.getItems
        .mockResolvedValueOnce({ items: unreadItems, continuation: null })   // pass 1: unread
        .mockResolvedValueOnce({ items: allItems, continuation: 'cont-1' }); // pass 2: all

      const query = { tier: 'wire', limit: 20 };
      const result = await adapter.fetchPage(query, 'kckern', {});

      // First two items should be unread
      expect(result.items[0].title).toBe('Unread 1');
      expect(result.items[1].title).toBe('Unread 2');
      expect(result.items[0].meta.isRead).toBe(false);
      expect(result.items[1].meta.isRead).toBe(false);

      // Remaining items should be read
      const readItems = result.items.filter(i => i.meta.isRead);
      expect(readItems).toHaveLength(2);
      expect(readItems.map(i => i.title).sort()).toEqual(['Read 1', 'Read 2']);
    });

    test('skips pass 2 when capped unread fills totalLimit', async () => {
      const mockConfigService = {
        getAppConfig: jest.fn().mockReturnValue({
          reader: { unread_per_source: 6, total_limit: 6, max_unread_per_feed: 3 },
        }),
      };
      const limitedAdapter = new FreshRSSSourceAdapter({
        freshRSSAdapter: mockFreshRSSAdapter,
        configService: mockConfigService,
      });

      // 3 feeds × 4 items each = 12 unread, but cap at 3/feed → 9, totalLimit 6 → 6
      const unreadItems = [
        ...Array.from({ length: 4 }, (_, i) => makeItem(`a${i}`, `A #${i}`, 'feed/a', 'A')),
        ...Array.from({ length: 4 }, (_, i) => makeItem(`b${i}`, `B #${i}`, 'feed/b', 'B')),
        ...Array.from({ length: 4 }, (_, i) => makeItem(`c${i}`, `C #${i}`, 'feed/c', 'C')),
      ];
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: unreadItems, continuation: 'more' });

      const result = await limitedAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});

      // Capped: 3+3+3=9 >= totalLimit 6, so pass 2 skipped
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(6);
      expect(result.items.every(i => i.meta.isRead === false)).toBe(true);
    });

    test('returns empty when adapter is null', async () => {
      const nullAdapter = new FreshRSSSourceAdapter({ freshRSSAdapter: null });
      const result = await nullAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});
      expect(result.items).toHaveLength(0);
    });

    test('tags items with freshrss: prefix', async () => {
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({
        items: [makeItem('abc123', 'Test')],
        continuation: null,
      });

      const result = await adapter.fetchPage({ tier: 'wire' }, 'kckern', {});
      expect(result.items[0].id).toBe('freshrss:abc123');
    });

    test('respects cursor for pagination (passes to unread fetch)', async () => {
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: [], continuation: null });

      await adapter.fetchPage({ tier: 'wire' }, 'kckern', { cursor: 'page-2-cursor' });

      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith(
        'user/-/state/com.google/reading-list',
        'kckern',
        expect.objectContaining({ continuation: 'page-2-cursor' }),
      );
    });

    test('caps unread items per feed to prevent one feed from dominating', async () => {
      const mockConfigService = {
        getAppConfig: jest.fn().mockReturnValue({
          reader: { unread_per_source: 20, total_limit: 100, max_unread_per_feed: 2 },
        }),
      };
      const cappedAdapter = new FreshRSSSourceAdapter({
        freshRSSAdapter: mockFreshRSSAdapter,
        configService: mockConfigService,
      });

      // Feed A has 10 unread items, Feed B has 3, Feed C has 2
      const unreadItems = [
        ...Array.from({ length: 10 }, (_, i) => makeItem(`a${i}`, `Feed A #${i}`, 'feed/a', 'Feed A')),
        ...Array.from({ length: 3 }, (_, i) => makeItem(`b${i}`, `Feed B #${i}`, 'feed/b', 'Feed B')),
        ...Array.from({ length: 2 }, (_, i) => makeItem(`c${i}`, `Feed C #${i}`, 'feed/c', 'Feed C')),
      ];

      mockFreshRSSAdapter.getItems
        .mockResolvedValueOnce({ items: unreadItems, continuation: null })  // pass 1
        .mockResolvedValueOnce({ items: [], continuation: null });          // pass 2

      const result = await cappedAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});
      const unread = result.items.filter(i => !i.meta.isRead);

      // Feed A capped at 2 (not 10), Feed B capped at 2 (of 3), Feed C has 2
      const feedACounts = unread.filter(i => i.meta.feedTitle === 'Feed A');
      const feedBCounts = unread.filter(i => i.meta.feedTitle === 'Feed B');
      const feedCCounts = unread.filter(i => i.meta.feedTitle === 'Feed C');

      expect(feedACounts).toHaveLength(2);
      expect(feedBCounts).toHaveLength(2);
      expect(feedCCounts).toHaveLength(2);
      expect(unread).toHaveLength(6);
    });

    test('reads limits from configService when provided', async () => {
      const mockConfigService = {
        getAppConfig: jest.fn().mockReturnValue({
          reader: { unread_per_source: 5, total_limit: 10, max_unread_per_feed: 2 },
        }),
      };
      const configuredAdapter = new FreshRSSSourceAdapter({
        freshRSSAdapter: mockFreshRSSAdapter,
        configService: mockConfigService,
      });

      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: [], continuation: null });
      await configuredAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});

      // Over-fetches using totalLimit (10) when max_unread_per_feed is set
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith(
        'user/-/state/com.google/reading-list',
        'kckern',
        expect.objectContaining({ count: 10, excludeRead: true }),
      );
    });
  });
});
