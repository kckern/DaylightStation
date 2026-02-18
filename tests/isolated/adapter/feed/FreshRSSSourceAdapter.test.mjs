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
    const makeItem = (id, title) => ({
      id, title, content: '', link: `https://example.com/${id}`,
      published: new Date('2026-02-18T12:00:00Z'), author: null,
      feedTitle: 'Test Feed', feedId: 'feed/1', categories: [],
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

    test('makes only one call when unread fills the limit', async () => {
      const mockConfigService = {
        getAppConfig: jest.fn().mockReturnValue({
          reader: { unread_per_source: 20, total_limit: 20 },
        }),
      };
      const limitedAdapter = new FreshRSSSourceAdapter({
        freshRSSAdapter: mockFreshRSSAdapter,
        configService: mockConfigService,
      });

      const unreadItems = Array.from({ length: 20 }, (_, i) => makeItem(`u${i}`, `Unread ${i}`));
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: unreadItems, continuation: 'more' });

      const query = { tier: 'wire', limit: 20 };
      const result = await limitedAdapter.fetchPage(query, 'kckern', {});

      // Only one getItems call (unread pass), no second call needed
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(20);
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

    test('reads limits from configService when provided', async () => {
      const mockConfigService = {
        getAppConfig: jest.fn().mockReturnValue({
          reader: { unread_per_source: 5, total_limit: 10 },
        }),
      };
      const configuredAdapter = new FreshRSSSourceAdapter({
        freshRSSAdapter: mockFreshRSSAdapter,
        configService: mockConfigService,
      });

      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: [], continuation: null });
      await configuredAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});

      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith(
        'user/-/state/com.google/reading-list',
        'kckern',
        expect.objectContaining({ count: 5 }), // unread_per_source
      );
    });
  });
});
