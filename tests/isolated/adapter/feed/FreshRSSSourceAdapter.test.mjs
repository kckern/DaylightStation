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
});
