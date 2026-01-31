import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ImmichClient } from '#adapters/content/gallery/immich/ImmichClient.mjs';

describe('ImmichClient', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new ImmichClient({}, { httpClient: mockHttpClient }))
        .toThrow('ImmichClient requires host');
    });

    test('throws error when apiKey is missing', () => {
      expect(() => new ImmichClient({ host: 'http://localhost:2283' }, { httpClient: mockHttpClient }))
        .toThrow('ImmichClient requires apiKey');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new ImmichClient({ host: 'http://localhost:2283', apiKey: 'test-key' }, {}))
        .toThrow('ImmichClient requires httpClient');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283/', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:2283');
    });
  });

  describe('getAsset', () => {
    test('fetches single asset by ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'photo.jpg'
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getAsset('abc-123');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/assets/abc-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key'
          })
        })
      );
      expect(result.id).toBe('abc-123');
    });
  });

  describe('getAlbums', () => {
    test('fetches all albums', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'album-1', albumName: 'Vacation' },
          { id: 'album-2', albumName: 'Family' }
        ]
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getAlbums();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/albums',
        expect.any(Object)
      );
      expect(result).toHaveLength(2);
      expect(result[0].albumName).toBe('Vacation');
    });
  });

  describe('getAlbum', () => {
    test('fetches album with assets by ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'album-1',
          albumName: 'Vacation',
          assets: [
            { id: 'asset-1', type: 'IMAGE' },
            { id: 'asset-2', type: 'VIDEO' }
          ]
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getAlbum('album-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/albums/album-1',
        expect.any(Object)
      );
      expect(result.albumName).toBe('Vacation');
      expect(result.assets).toHaveLength(2);
    });
  });

  describe('searchMetadata', () => {
    test('searches with filters', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          assets: {
            items: [{ id: 'abc-123', type: 'IMAGE' }],
            total: 1
          }
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.searchMetadata({ type: 'IMAGE', take: 10 });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'http://localhost:2283/api/search/metadata',
        { type: 'IMAGE', take: 10 },
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.items).toHaveLength(1);
    });

    test('returns empty result when no assets found', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {}
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.searchMetadata({ type: 'IMAGE' });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('getPeople', () => {
    test('fetches people list from nested response', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          people: [
            { id: 'person-1', name: 'Felix' },
            { id: 'person-2', name: 'Milo' }
          ]
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getPeople();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Felix');
    });

    test('handles direct array response', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'person-1', name: 'Felix' },
          { id: 'person-2', name: 'Milo' }
        ]
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getPeople();

      expect(result).toHaveLength(2);
    });

    test('returns empty array when no data', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: null
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getPeople();

      expect(result).toEqual([]);
    });
  });

  describe('getTimelineBuckets', () => {
    test('fetches timeline buckets with default size', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { timeBucket: '2024-01', count: 150 },
          { timeBucket: '2024-02', count: 200 }
        ]
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getTimelineBuckets();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/timeline/buckets?size=MONTH',
        expect.any(Object)
      );
      expect(result).toHaveLength(2);
    });

    test('fetches timeline buckets with custom size', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [{ timeBucket: '2024-01-15', count: 25 }]
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      await client.getTimelineBuckets('DAY');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/timeline/buckets?size=DAY',
        expect.any(Object)
      );
    });
  });

  describe('parseDuration', () => {
    test('parses video duration string to seconds', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      expect(client.parseDuration('00:05:17.371')).toBe(317);
      expect(client.parseDuration('01:30:00.000')).toBe(5400);
      expect(client.parseDuration('00:00:30.500')).toBe(30);
    });

    test('returns null for zero duration', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      expect(client.parseDuration('0:00:00.00000')).toBeNull();
    });

    test('returns null for null input', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      expect(client.parseDuration(null)).toBeNull();
      expect(client.parseDuration(undefined)).toBeNull();
    });

    test('returns null for invalid format', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      expect(client.parseDuration('invalid')).toBeNull();
      expect(client.parseDuration('30')).toBeNull();
    });
  });
});
