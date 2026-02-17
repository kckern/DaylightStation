// tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { KomgaFeedAdapter } from '#adapters/feed/sources/KomgaFeedAdapter.mjs';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock dataService
const mockDataService = {
  household: {
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
  },
};

describe('KomgaFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataService.household.read.mockReturnValue(null);
  });

  describe('fetchItems image URL', () => {
    test('uses composite hero URL pattern', async () => {
      // Mock books list response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{
            id: 'book-abc',
            name: 'Issue 42',
            metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
            media: { pagesCount: 50 },
          }],
        }),
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
        host: 'http://localhost:25600',
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
  });
});
