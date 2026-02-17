// tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { KomgaFeedAdapter } from '#adapters/feed/sources/KomgaFeedAdapter.mjs';

// Mock dataService
const mockDataService = {
  household: {
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
  },
};

// Shared mock client — hoisted so all tests can use it
const mockClient = {
  host: 'http://localhost:25600',
  getBooks: jest.fn(),
};

describe('KomgaFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataService.household.read.mockReturnValue(null);
    mockClient.getBooks.mockReset();
  });

  describe('constructor with client', () => {
    test('throws error when client is missing', () => {
      expect(() => new KomgaFeedAdapter({
        apiKey: 'test-key',
        dataService: mockDataService,
      })).toThrow('KomgaFeedAdapter requires client');
    });

    test('accepts client and apiKey without host', () => {
      const adapter = new KomgaFeedAdapter({
        client: mockClient,
        apiKey: 'test-key',
        dataService: mockDataService,
        logger,
      });
      expect(adapter.sourceType).toBe('komga');
    });
  });

  describe('fetchItems image URL', () => {
    test('uses composite hero URL pattern', async () => {
      // Mock books list response via client
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-abc',
          name: 'Issue 42',
          metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
          media: { pagesCount: 50 },
        }],
      });

      // Return cached TOC so we skip pdfjs entirely
      mockDataService.household.read.mockReturnValue({
        bookId: 'book-abc',
        series: 'Test Series',
        issue: 'Issue 42',
        pages: 50,
        articles: [{ title: 'Article One', page: 12 }],
      });

      const adapter = new KomgaFeedAdapter({
        client: mockClient,
        apiKey: 'test-key',
        dataService: mockDataService,
        logger,
      });

      const items = await adapter.fetchItems({
        tier: 'library',
        priority: 5,
        params: {
          series: [{ id: 'series-1', label: 'Test Series' }],
          recent_issues: 1,
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      // Key assertion: image uses composite URL pattern
      expect(items[0].image).toBe('/api/v1/proxy/komga/composite/book-abc/12');
    });

    test('includes imageWidth=1280 and imageHeight=720 for composite hero', async () => {
      // Mock books list response via client
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-abc',
          name: 'Issue 42',
          metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
          media: { pagesCount: 50 },
        }],
      });

      // Return cached TOC so we skip pdfjs entirely
      mockDataService.household.read.mockReturnValue({
        bookId: 'book-abc',
        series: 'Test Series',
        issue: 'Issue 42',
        pages: 50,
        articles: [{ title: 'Article One', page: 12 }],
      });

      const adapter = new KomgaFeedAdapter({
        client: mockClient,
        apiKey: 'test-key',
        dataService: mockDataService,
        logger,
      });

      const items = await adapter.fetchItems({
        tier: 'library',
        priority: 5,
        params: {
          series: [{ id: 'series-1', label: 'Test Series' }],
          recent_issues: 1,
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].meta.imageWidth).toBe(1280);
      expect(items[0].meta.imageHeight).toBe(720);
    });
  });

  describe('fetchItems delegates to client.getBooks', () => {
    test('calls client.getBooks with correct seriesId, size, and sort', async () => {
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-abc',
          name: 'Issue 42',
          metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
          media: { pagesCount: 50 },
        }],
      });

      // Return cached TOC so we skip pdfjs
      mockDataService.household.read.mockReturnValue({
        bookId: 'book-abc',
        series: 'Test Series',
        issue: 'Issue 42',
        pages: 50,
        articles: [{ title: 'Article One', page: 12 }],
      });

      const adapter = new KomgaFeedAdapter({
        client: mockClient,
        apiKey: 'test-key',
        dataService: mockDataService,
        logger,
      });

      await adapter.fetchItems({
        tier: 'library',
        priority: 5,
        params: {
          series: [{ id: 'series-1', label: 'Test Series' }],
          recent_issues: 4,
        },
      }, 'testuser');

      expect(mockClient.getBooks).toHaveBeenCalledWith('series-1', {
        size: 4,
        sort: 'metadata.numberSort,desc',
      });
    });
  });
});
