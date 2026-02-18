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

  describe('redflags filter junk bookmark titles', () => {
    test('replaces junk titles with page numbers when all articles match redflags', async () => {
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-junk',
          name: 'Issue 5',
          metadata: { title: 'Issue 5', releaseDate: '2026-01-01' },
          media: { pagesCount: 80 },
        }],
      });

      // Cached TOC with junk bookmark titles
      mockDataService.household.read.mockReturnValue({
        bookId: 'book-junk',
        series: 'Dialogue',
        issue: 'Volume51',
        pages: 80,
        articles: [
          { title: '_GoBack', page: 30 },
          { title: '_GoBack', page: 48 },
          { title: '_Hlk523939606', page: 93 },
        ],
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
          series: [{ id: 'series-1', label: 'Dialogue' }],
          recent_issues: 1,
          redflags: ['^_'],
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      // Title should be a page reference, not "_GoBack"
      expect(items[0].title).toMatch(/^p\. \d+$/);
    });

    test('keeps good titles when articles do not match redflags', async () => {
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-good',
          name: 'Issue 10',
          metadata: { title: 'Issue 10', releaseDate: '2026-01-01' },
          media: { pagesCount: 100 },
        }],
      });

      mockDataService.household.read.mockReturnValue({
        bookId: 'book-good',
        series: 'MIT Sloan',
        issue: 'Spring 2022',
        pages: 100,
        articles: [
          { title: 'How Well-Designed Work Makes Us Smarter', page: 41 },
        ],
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
          series: [{ id: 'series-1', label: 'MIT Sloan' }],
          recent_issues: 1,
          redflags: ['^_'],
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('How Well-Designed Work Makes Us Smarter');
    });

    test('filters junk articles but keeps good ones from mixed TOC', async () => {
      mockClient.getBooks.mockResolvedValue({
        content: [{
          id: 'book-mix',
          name: 'Issue 7',
          metadata: { title: 'Issue 7', releaseDate: '2026-01-01' },
          media: { pagesCount: 60 },
        }],
      });

      mockDataService.household.read.mockReturnValue({
        bookId: 'book-mix',
        series: 'Test',
        issue: 'Issue 7',
        pages: 60,
        articles: [
          { title: '_GoBack', page: 5 },
          { title: 'Real Article Title', page: 20 },
        ],
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
          series: [{ id: 'series-1', label: 'Test' }],
          recent_issues: 1,
          redflags: ['^_'],
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      // Should always pick the good article, never the junk one
      expect(items[0].title).toBe('Real Article Title');
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
