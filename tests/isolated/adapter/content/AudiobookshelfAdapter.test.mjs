import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { AudiobookshelfAdapter } from '#adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs';

describe('AudiobookshelfAdapter', () => {
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
      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('abs');
      expect(adapter.prefixes).toContainEqual({ prefix: 'abs' });
    });

    test('throws error when host is missing', () => {
      expect(() => new AudiobookshelfAdapter(
        { token: 'test-token' },
        { httpClient: mockHttpClient }
      )).toThrow('AudiobookshelfAdapter requires host');
    });
  });

  describe('getItem', () => {
    test('returns ReadableItem for ebook with resumePosition', async () => {
      // Mock getItem response for ebook
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-123',
          libraryId: 'lib-1',
          media: {
            ebookFile: {
              ebookFormat: 'epub',
              metadata: { title: 'Test Ebook' }
            },
            numAudioFiles: 0,
            duration: 0
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          ebookProgress: 0.35,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:item-123');

      expect(result.id).toBe('abs:item-123');
      expect(result.source).toBe('abs');
      expect(result.contentType).toBe('flow');
      expect(result.format).toBe('epub');
      expect(result.resumePosition).toBe(35); // 0.35 * 100
      expect(result.isReadable()).toBe(true);
    });

    test('returns PlayableItem for audiobook', async () => {
      // Mock getItem response for audiobook
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-456',
          libraryId: 'lib-1',
          media: {
            numAudioFiles: 5,
            duration: 36000, // 10 hours in seconds
            metadata: {
              title: 'Test Audiobook',
              description: 'A great audiobook'
            }
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          currentTime: 3600,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:item-456');

      expect(result.id).toBe('abs:item-456');
      expect(result.source).toBe('abs');
      expect(result.mediaType).toBe('audio');
      expect(result.duration).toBe(36000);
      expect(result.resumePosition).toBe(3600);
      expect(result.isPlayable()).toBe(true);
    });

    test('returns null for non-existent item', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    test('returns libraries when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          libraries: [
            { id: 'lib-1', name: 'Audiobooks', mediaType: 'book' },
            { id: 'lib-2', name: 'Podcasts', mediaType: 'podcast' }
          ]
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('abs:lib:lib-1');
      expect(result[0].title).toBe('Audiobooks');
      expect(result[0].itemType).toBe('container');
      expect(result[1].id).toBe('abs:lib:lib-2');
      expect(result[1].title).toBe('Podcasts');
    });

    test('returns items for library id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          results: [
            {
              id: 'item-1',
              media: {
                metadata: { title: 'Book One' },
                numAudioFiles: 3,
                duration: 18000
              }
            },
            {
              id: 'item-2',
              media: {
                metadata: { title: 'Book Two' },
                ebookFile: { ebookFormat: 'epub' },
                numAudioFiles: 0
              }
            }
          ],
          total: 2
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('abs:lib:lib-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('abs:item-1');
      expect(result[0].title).toBe('Book One');
      expect(result[0].itemType).toBe('leaf');
      expect(result[1].id).toBe('abs:item-2');
      expect(result[1].title).toBe('Book Two');
    });
  });

  describe('resolveReadables', () => {
    test('returns ReadableItem for ebook', async () => {
      // Mock getItem response for ebook
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-123',
          libraryId: 'lib-1',
          media: {
            ebookFile: {
              ebookFormat: 'epub',
              metadata: { title: 'Test Ebook' }
            },
            numAudioFiles: 0
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          ebookProgress: 0.5,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('abs:item-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abs:item-123');
      expect(result[0].isReadable()).toBe(true);
    });

    test('returns empty array for audiobook', async () => {
      // Mock getItem response for audiobook (not an ebook)
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-456',
          libraryId: 'lib-1',
          media: {
            numAudioFiles: 5,
            duration: 36000,
            metadata: { title: 'Test Audiobook' }
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          currentTime: 3600,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('abs:item-456');

      // Audiobooks are not readable, they are playable
      expect(result).toEqual([]);
    });
  });

  describe('resolvePlayables', () => {
    test('returns PlayableItem for audiobook', async () => {
      // Mock getItem response for audiobook
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-456',
          libraryId: 'lib-1',
          media: {
            numAudioFiles: 5,
            duration: 36000,
            metadata: {
              title: 'Test Audiobook',
              description: 'A great audiobook'
            }
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          currentTime: 3600,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolvePlayables('abs:item-456');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abs:item-456');
      expect(result[0].isPlayable()).toBe(true);
    });

    test('returns empty array for ebook', async () => {
      // Mock getItem response for ebook (not an audiobook)
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          id: 'item-123',
          libraryId: 'lib-1',
          media: {
            ebookFile: {
              ebookFormat: 'epub',
              metadata: { title: 'Test Ebook' }
            },
            numAudioFiles: 0
          },
          mediaType: 'book'
        }
      });
      // Mock getProgress response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          ebookProgress: 0.5,
          isFinished: false
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolvePlayables('abs:item-123');

      // Ebooks are not playable, they are readable
      expect(result).toEqual([]);
    });
  });
});
