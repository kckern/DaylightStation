import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ImmichAdapter } from '#adapters/content/gallery/immich/ImmichAdapter.mjs';

describe('ImmichAdapter', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('immich');
      expect(adapter.prefixes).toContainEqual({ prefix: 'immich' });
    });

    test('throws error when host is missing', () => {
      expect(() => new ImmichAdapter({}, { httpClient: mockHttpClient }))
        .toThrow('ImmichAdapter requires host');
    });
  });

  describe('getItem', () => {
    test('returns ListableItem for image asset', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'beach.jpg',
          width: 1920,
          height: 1080,
          thumbhash: 'abc',
          isFavorite: false,
          exifInfo: {
            dateTimeOriginal: '2025-12-25T10:00:00Z',
            city: 'Seattle'
          }
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:abc-123');

      expect(result.id).toBe('immich:abc-123');
      expect(result.source).toBe('immich');
      expect(result.title).toBe('beach.jpg');
      expect(result.itemType).toBe('leaf');
      expect(result.thumbnail).toBe('/api/v1/proxy/immich/assets/abc-123/thumbnail');
    });

    test('returns PlayableItem for video asset', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'video-123',
          type: 'VIDEO',
          originalFileName: 'clip.mp4',
          duration: '00:01:30.000',
          width: 1920,
          height: 1080
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:video-123');

      expect(result.id).toBe('immich:video-123');
      expect(result.mediaType).toBe('video');
      expect(result.duration).toBe(90);
      expect(result.mediaUrl).toBe('/api/v1/proxy/immich/assets/video-123/video/playback');
    });

    test('returns null for non-existent asset', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    test('returns albums when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'album-1', albumName: 'Vacation', assetCount: 50, albumThumbnailAssetId: 'thumb-1' },
          { id: 'album-2', albumName: 'Family', assetCount: 100, albumThumbnailAssetId: 'thumb-2' }
        ]
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('immich:album:album-1');
      expect(result[0].title).toBe('Vacation');
      expect(result[0].itemType).toBe('container');
      expect(result[0].childCount).toBe(50);
    });

    test('returns assets for album id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'album-1',
          albumName: 'Vacation',
          assets: [
            { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo1.jpg' },
            { id: 'asset-2', type: 'VIDEO', originalFileName: 'video1.mp4', duration: '00:00:30.000' }
          ]
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('immich:album:album-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('immich:asset-1');
      expect(result[1].id).toBe('immich:asset-2');
    });
  });

  describe('getViewable', () => {
    test('returns ViewableItem for image', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'photo.jpg',
          originalMimeType: 'image/jpeg',
          width: 4000,
          height: 3000,
          exifInfo: { iso: 200, city: 'Seattle' },
          people: [{ id: 'p1', name: 'Felix' }]
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getViewable('immich:abc-123');

      expect(result.id).toBe('immich:abc-123');
      expect(result.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123/original');
      expect(result.thumbnail).toBe('/api/v1/proxy/immich/assets/abc-123/thumbnail');
      expect(result.width).toBe(4000);
      expect(result.height).toBe(3000);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.isViewable()).toBe(true);
    });
  });

  describe('search', () => {
    test('searches with people filter', async () => {
      // Mock getPeople for name->ID resolution
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          { id: 'person-1', name: 'Felix' },
          { id: 'person-2', name: 'Milo' }
        ]
      });

      // Mock searchMetadata
      mockHttpClient.post.mockResolvedValue({
        data: {
          assets: {
            items: [{ id: 'abc-123', type: 'IMAGE', originalFileName: 'photo.jpg' }],
            total: 1
          }
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.search({ people: ['Felix'], mediaType: 'image' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/search/metadata'),
        expect.objectContaining({ personIds: ['person-1'], type: 'IMAGE' }),
        expect.any(Object)
      );
    });
  });

  describe('getSearchCapabilities', () => {
    test('returns supported search fields', () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const caps = adapter.getSearchCapabilities();

      expect(caps).toContain('text');
      expect(caps).toContain('people');
      expect(caps).toContain('dateFrom');
      expect(caps).toContain('dateTo');
      expect(caps).toContain('location');
      expect(caps).toContain('mediaType');
      expect(caps).toContain('favorites');
    });
  });

  describe('getStoragePath', () => {
    test('returns immich as storage path', async () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getStoragePath('abc-123');
      expect(result).toBe('immich');
    });
  });
});
