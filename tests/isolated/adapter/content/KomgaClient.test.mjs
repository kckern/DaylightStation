import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { KomgaClient } from '#adapters/content/readable/komga/KomgaClient.mjs';

describe('KomgaClient', () => {
  const mockHttpClient = {
    get: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new KomgaClient({}, { httpClient: mockHttpClient }))
        .toThrow('KomgaClient requires host');
    });

    test('throws error when apiKey is missing', () => {
      expect(() => new KomgaClient({ host: 'http://localhost:25600' }, { httpClient: mockHttpClient }))
        .toThrow('KomgaClient requires apiKey');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new KomgaClient({ host: 'http://localhost:25600', apiKey: 'test-key' }, {}))
        .toThrow('KomgaClient requires httpClient');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new KomgaClient(
        { host: 'http://localhost:25600/', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:25600');
    });
  });

  describe('getLibraries', () => {
    test('fetches all libraries with X-API-Key header', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'lib-1', name: 'Comics' },
          { id: 'lib-2', name: 'Manga' }
        ]
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraries();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/libraries',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-key',
            'Accept': 'application/json'
          })
        })
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Comics');
    });
  });

  describe('getSeries', () => {
    test('fetches series with pagination', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'series-1', name: 'Batman' },
            { id: 'series-2', name: 'Superman' }
          ],
          totalPages: 5,
          totalElements: 100
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getSeries('lib-1', { page: 0, size: 20 });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/series?library_id=lib-1&page=0&size=20',
        expect.any(Object)
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('Batman');
    });

    test('uses default pagination when options not provided', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { content: [], totalPages: 0, totalElements: 0 }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      await client.getSeries('lib-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/series?library_id=lib-1&page=0&size=50',
        expect.any(Object)
      );
    });
  });

  describe('getBooks', () => {
    test('fetches books with pagination', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'book-1', name: 'Issue #1' },
            { id: 'book-2', name: 'Issue #2' }
          ],
          totalPages: 3,
          totalElements: 50
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getBooks('series-1', { page: 0, size: 20 });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/series/series-1/books?page=0&size=20',
        expect.any(Object)
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('Issue #1');
    });

    test('uses default pagination when options not provided', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { content: [], totalPages: 0, totalElements: 0 }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      await client.getBooks('series-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/series/series-1/books?page=0&size=50',
        expect.any(Object)
      );
    });
  });

  describe('getBook', () => {
    test('fetches single book details', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-1',
          name: 'Issue #1',
          seriesId: 'series-1',
          number: 1,
          media: {
            pagesCount: 32,
            mediaType: 'application/zip'
          },
          readProgress: {
            page: 15,
            completed: false
          }
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getBook('book-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/books/book-1',
        expect.any(Object)
      );
      expect(result.id).toBe('book-1');
      expect(result.media.pagesCount).toBe(32);
    });
  });

  describe('getSeriesById', () => {
    test('fetches single series by ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'series-1',
          name: 'Batman',
          libraryId: 'lib-1',
          booksCount: 50,
          metadata: {
            title: 'Batman',
            status: 'ONGOING'
          }
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getSeriesById('series-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/series/series-1',
        expect.any(Object)
      );
      expect(result.id).toBe('series-1');
      expect(result.name).toBe('Batman');
    });
  });

  describe('updateProgress', () => {
    test('patches read progress with page and completed status', async () => {
      mockHttpClient.patch.mockResolvedValue({
        data: { page: 20, completed: false }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.updateProgress('book-1', 20, false);

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/books/book-1/read-progress',
        { page: 20, completed: false },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-key',
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.page).toBe(20);
    });

    test('patches read progress as completed', async () => {
      mockHttpClient.patch.mockResolvedValue({
        data: { page: 32, completed: true }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:25600', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.updateProgress('book-1', 32, true);

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:25600/api/v1/books/book-1/read-progress',
        { page: 32, completed: true },
        expect.any(Object)
      );
      expect(result.completed).toBe(true);
    });
  });
});
