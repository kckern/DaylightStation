import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { AudiobookshelfClient } from '#adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs';

describe('AudiobookshelfClient', () => {
  const mockHttpClient = {
    get: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new AudiobookshelfClient({}, { httpClient: mockHttpClient }))
        .toThrow('AudiobookshelfClient requires host');
    });

    test('throws error when token is missing', () => {
      expect(() => new AudiobookshelfClient({ host: 'http://localhost:13378' }, { httpClient: mockHttpClient }))
        .toThrow('AudiobookshelfClient requires token');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new AudiobookshelfClient({ host: 'http://localhost:13378', token: 'test-token' }, {}))
        .toThrow('AudiobookshelfClient requires httpClient');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378/', token: 'test-token' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:13378');
    });
  });

  describe('getLibraries', () => {
    test('fetches all libraries with Bearer token', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          libraries: [
            { id: 'lib-1', name: 'Audiobooks' },
            { id: 'lib-2', name: 'Ebooks' }
          ]
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraries();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/libraries',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Accept': 'application/json'
          })
        })
      );
      expect(result.libraries).toHaveLength(2);
      expect(result.libraries[0].name).toBe('Audiobooks');
    });
  });

  describe('getLibraryItems', () => {
    test('fetches items with pagination', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          results: [
            { id: 'item-1', media: { metadata: { title: 'Book 1' } } },
            { id: 'item-2', media: { metadata: { title: 'Book 2' } } }
          ],
          total: 100,
          page: 0,
          limit: 20
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraryItems('lib-1', { page: 0, limit: 20 });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/libraries/lib-1/items?page=0&limit=20',
        expect.any(Object)
      );
      expect(result.results).toHaveLength(2);
      expect(result.results[0].media.metadata.title).toBe('Book 1');
    });

    test('uses default pagination when options not provided', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { results: [], total: 0, page: 0, limit: 50 }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      await client.getLibraryItems('lib-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/libraries/lib-1/items?page=0&limit=50',
        expect.any(Object)
      );
    });
  });

  describe('getItem', () => {
    test('fetches single item with expanded=1', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-1',
          libraryId: 'lib-1',
          media: {
            metadata: { title: 'Test Book' },
            numAudioFiles: 10,
            duration: 36000
          }
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getItem('item-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/items/item-1?expanded=1',
        expect.any(Object)
      );
      expect(result.id).toBe('item-1');
      expect(result.media.metadata.title).toBe('Test Book');
    });
  });

  describe('getProgress', () => {
    test('fetches user progress for item', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'progress-1',
          libraryItemId: 'item-1',
          progress: 0.45,
          currentTime: 16200,
          isFinished: false
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getProgress('item-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-1',
        expect.any(Object)
      );
      expect(result.progress).toBe(0.45);
      expect(result.isFinished).toBe(false);
    });
  });

  describe('updateProgress', () => {
    test('patches progress for audiobook (currentTime)', async () => {
      mockHttpClient.patch.mockResolvedValue({
        data: {
          id: 'progress-1',
          libraryItemId: 'item-1',
          progress: 0.5,
          currentTime: 18000,
          isFinished: false
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.updateProgress('item-1', { currentTime: 18000, isFinished: false });

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-1',
        { currentTime: 18000, isFinished: false },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.currentTime).toBe(18000);
    });

    test('patches progress for ebook (ebookProgress)', async () => {
      mockHttpClient.patch.mockResolvedValue({
        data: {
          id: 'progress-1',
          libraryItemId: 'item-1',
          ebookProgress: 0.75,
          isFinished: false
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.updateProgress('item-1', { ebookProgress: 0.75, isFinished: false });

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-1',
        { ebookProgress: 0.75, isFinished: false },
        expect.any(Object)
      );
      expect(result.ebookProgress).toBe(0.75);
    });
  });

  describe('isEbook', () => {
    test('returns true when item has ebookFile', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        id: 'item-1',
        media: {
          ebookFile: { ino: '123', metadata: { filename: 'book.epub' } }
        }
      };

      expect(client.isEbook(item)).toBe(true);
    });

    test('returns false when item has no ebookFile', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        id: 'item-1',
        media: {
          numAudioFiles: 10
        }
      };

      expect(client.isEbook(item)).toBe(false);
    });

    test('returns false when media is missing', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = { id: 'item-1' };

      expect(client.isEbook(item)).toBe(false);
    });
  });

  describe('isAudiobook', () => {
    test('returns true when item has numAudioFiles > 0', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        id: 'item-1',
        media: {
          numAudioFiles: 10
        }
      };

      expect(client.isAudiobook(item)).toBe(true);
    });

    test('returns false when numAudioFiles is 0', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        id: 'item-1',
        media: {
          numAudioFiles: 0,
          ebookFile: { ino: '123' }
        }
      };

      expect(client.isAudiobook(item)).toBe(false);
    });

    test('returns false when media is missing', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = { id: 'item-1' };

      expect(client.isAudiobook(item)).toBe(false);
    });
  });
});
