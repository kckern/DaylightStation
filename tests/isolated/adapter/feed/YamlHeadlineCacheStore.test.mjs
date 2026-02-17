// tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs
import { jest } from '@jest/globals';
import { YamlHeadlineCacheStore } from '#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs';

describe('YamlHeadlineCacheStore', () => {
  let store;
  let mockDataService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn(),
        write: jest.fn(() => true),
      },
    };
    store = new YamlHeadlineCacheStore({ dataService: mockDataService });
  });

  describe('loadSource', () => {
    test('reads from correct path', async () => {
      mockDataService.user.read.mockReturnValue({
        source: 'cnn',
        label: 'CNN',
        last_harvest: '2026-02-15T10:00:00Z',
        items: [{ title: 'Test', link: 'https://cnn.com/1', timestamp: '2026-02-15T09:00:00Z' }],
      });

      const result = await store.loadSource('cnn', 'kckern');
      expect(mockDataService.user.read).toHaveBeenCalledWith('current/feed/cnn', 'kckern');
      expect(result.source).toBe('cnn');
      expect(result.items).toHaveLength(1);
    });

    test('returns null when no file exists', async () => {
      mockDataService.user.read.mockReturnValue(null);
      const result = await store.loadSource('cnn', 'kckern');
      expect(result).toBeNull();
    });
  });

  describe('saveSource', () => {
    test('writes to correct path', async () => {
      const data = {
        source: 'cnn',
        label: 'CNN',
        lastHarvest: '2026-02-15T10:00:00Z',
        items: [],
      };
      await store.saveSource('cnn', data, 'kckern');
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'current/feed/cnn',
        expect.objectContaining({ source: 'cnn' }),
        'kckern'
      );
    });
  });

  describe('id persistence', () => {
    test('saveSource and loadSource roundtrip preserves item id', async () => {
      const data = {
        source: 'cnn',
        label: 'CNN',
        lastHarvest: '2026-02-17T00:00:00Z',
        items: [{ id: 'abc123defg', title: 'Test', link: 'https://cnn.com/1', timestamp: '2026-02-17T00:00:00Z' }],
      };
      // Capture what saveSource writes, and return it from loadSource
      let savedData = null;
      mockDataService.user.write.mockImplementation((path, d) => { savedData = d; return true; });
      mockDataService.user.read.mockImplementation(() => savedData);

      await store.saveSource('cnn', data, 'testuser');
      const loaded = await store.loadSource('cnn', 'testuser');
      expect(loaded.items[0].id).toBe('abc123defg');
    });
  });

  describe('pruneOlderThan', () => {
    test('removes items older than cutoff', async () => {
      const cutoff = new Date('2026-02-15T00:00:00Z');
      mockDataService.user.read.mockReturnValue({
        source: 'cnn',
        label: 'CNN',
        last_harvest: '2026-02-15T12:00:00Z',
        items: [
          { title: 'New', link: 'https://cnn.com/1', timestamp: '2026-02-15T10:00:00Z' },
          { title: 'Old', link: 'https://cnn.com/2', timestamp: '2026-02-14T10:00:00Z' },
        ],
      });

      const pruned = await store.pruneOlderThan('cnn', cutoff, 'kckern');
      expect(pruned).toBe(1);
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'current/feed/cnn',
        expect.objectContaining({
          items: [expect.objectContaining({ title: 'New' })],
        }),
        'kckern'
      );
    });
  });
});
