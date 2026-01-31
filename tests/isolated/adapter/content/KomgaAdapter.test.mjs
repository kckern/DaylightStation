import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { KomgaAdapter } from '#adapters/content/readable/komga/KomgaAdapter.mjs';

describe('KomgaAdapter', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('komga');
      expect(adapter.prefixes).toContainEqual({ prefix: 'komga' });
    });

    test('throws error when host is missing', () => {
      expect(() => new KomgaAdapter({}, { httpClient: mockHttpClient }))
        .toThrow('KomgaAdapter requires host');
    });
  });

  describe('getItem', () => {
    test('returns ReadableItem for book', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Chapter 1',
          seriesId: 'series-1',
          media: {
            pagesCount: 24,
            mediaType: 'application/zip',
            mediaProfile: 'CBZ'
          },
          metadata: {
            title: 'Chapter 1 - The Beginning',
            summary: 'A great start',
            readingDirection: 'RIGHT_TO_LEFT'
          },
          readProgress: {
            page: 5,
            completed: false
          }
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('komga:book-123');

      expect(result.id).toBe('komga:book-123');
      expect(result.source).toBe('komga');
      expect(result.title).toBe('Chapter 1 - The Beginning');
      expect(result.contentType).toBe('paged');
      expect(result.format).toBe('cbz');
      expect(result.totalPages).toBe(24);
      expect(result.readingDirection).toBe('rtl');
      expect(result.resumePosition).toBe(5);
      expect(result.thumbnail).toBe('/api/v1/proxy/komga/books/book-123/thumbnail');
      expect(result.isReadable()).toBe(true);
    });

    test('returns null for non-existent book', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('komga:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    test('returns libraries when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'lib-1', name: 'Comics', root: '/comics' },
          { id: 'lib-2', name: 'Manga', root: '/manga' }
        ]
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('komga:lib:lib-1');
      expect(result[0].title).toBe('Comics');
      expect(result[0].itemType).toBe('container');
      expect(result[1].id).toBe('komga:lib:lib-2');
      expect(result[1].title).toBe('Manga');
    });

    test('returns series for library id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'series-1', name: 'One Piece', booksCount: 100 },
            { id: 'series-2', name: 'Naruto', booksCount: 72 }
          ],
          totalElements: 2
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('komga:lib:lib-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('komga:series:series-1');
      expect(result[0].title).toBe('One Piece');
      expect(result[0].itemType).toBe('container');
      expect(result[0].childCount).toBe(100);
      expect(result[1].id).toBe('komga:series:series-2');
      expect(result[1].title).toBe('Naruto');
    });

    test('returns books for series id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            {
              id: 'book-1',
              name: 'Chapter 1',
              media: { pagesCount: 24, mediaProfile: 'CBZ' },
              metadata: { title: 'Chapter 1', readingDirection: 'LEFT_TO_RIGHT' }
            },
            {
              id: 'book-2',
              name: 'Chapter 2',
              media: { pagesCount: 22, mediaProfile: 'CBZ' },
              metadata: { title: 'Chapter 2', readingDirection: 'LEFT_TO_RIGHT' }
            }
          ],
          totalElements: 2
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('komga:series:series-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('komga:book-1');
      expect(result[0].title).toBe('Chapter 1');
      expect(result[0].itemType).toBe('leaf');
      expect(result[1].id).toBe('komga:book-2');
      expect(result[1].title).toBe('Chapter 2');
    });
  });

  describe('resolveReadables', () => {
    test('returns ReadableItem array for book', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Chapter 1',
          media: { pagesCount: 24, mediaProfile: 'CBZ' },
          metadata: { title: 'Chapter 1', readingDirection: 'LEFT_TO_RIGHT' }
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('komga:book-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('komga:book-123');
      expect(result[0].isReadable()).toBe(true);
    });

    test('returns empty array for non-existent book', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('komga:not-found');
      expect(result).toEqual([]);
    });
  });

  describe('resolvePlayables', () => {
    test('returns empty array (readables are not playables)', async () => {
      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolvePlayables('komga:book-123');
      expect(result).toEqual([]);
    });
  });

  describe('getPageUrl', () => {
    test('ReadableItem generates correct page URL', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Chapter 1',
          media: { pagesCount: 24, mediaProfile: 'CBZ' },
          metadata: { title: 'Chapter 1', readingDirection: 'LEFT_TO_RIGHT' }
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const item = await adapter.getItem('komga:book-123');

      expect(item.getPageUrl(0)).toBe('/api/v1/proxy/komga/books/book-123/pages/1');
      expect(item.getPageUrl(5)).toBe('/api/v1/proxy/komga/books/book-123/pages/6');
      expect(item.getPageUrl(23)).toBe('/api/v1/proxy/komga/books/book-123/pages/24');
    });
  });

  describe('getStoragePath', () => {
    test('returns komga as storage path', async () => {
      const adapter = new KomgaAdapter(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getStoragePath();
      expect(result).toBe('komga');
    });
  });
});
