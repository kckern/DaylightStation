// tests/isolated/adapter/content/canvas/ImmichCanvasAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ImmichCanvasAdapter } from '../../../../../backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs';

describe('ImmichCanvasAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      getAlbums: jest.fn().mockResolvedValue([
        { id: 'album-1', albumName: 'Landscapes', assetCount: 5 },
        { id: 'album-2', albumName: 'Abstract', assetCount: 3 },
      ]),
      getAlbum: jest.fn().mockResolvedValue({
        id: 'album-1',
        albumName: 'Landscapes',
        assets: [
          { id: 'asset-1', originalFileName: 'sunset.jpg', type: 'IMAGE', exifInfo: { Artist: 'Monet' } },
          { id: 'asset-2', originalFileName: 'mountain.jpg', type: 'IMAGE', exifInfo: {} },
        ],
      }),
      getAsset: jest.fn().mockResolvedValue({
        id: 'asset-1',
        originalFileName: 'sunset.jpg',
        type: 'IMAGE',
        exifInfo: { Artist: 'Monet', DateTimeOriginal: '2020-01-15' },
      }),
    };

    adapter = new ImmichCanvasAdapter({
      library: 'art',
      proxyPath: '/api/v1/proxy/immich-canvas',
    }, {
      client: mockClient,
    });
  });

  describe('source and prefixes', () => {
    it('has correct source name', () => {
      expect(adapter.source).toBe('canvas-immich');
    });

    it('has canvas-immich prefix', () => {
      expect(adapter.prefixes).toContainEqual({ prefix: 'canvas-immich' });
    });
  });

  describe('list', () => {
    it('fetches albums from art library', async () => {
      const items = await adapter.list();
      expect(mockClient.getAlbums).toHaveBeenCalled();
      expect(items.length).toBeGreaterThan(0);
    });

    it('fetches album contents when album specified', async () => {
      const items = await adapter.list({ albumId: 'album-1' });
      expect(mockClient.getAlbum).toHaveBeenCalledWith('album-1');
      expect(items).toHaveLength(2);
    });

    it('maps albums to categories', async () => {
      const items = await adapter.list({ albumId: 'album-1' });
      expect(items[0].category).toBe('Landscapes');
    });

    it('extracts artist from EXIF', async () => {
      const items = await adapter.list({ albumId: 'album-1' });
      expect(items[0].artist).toBe('Monet');
    });
  });

  describe('getItem', () => {
    it('returns DisplayableItem for asset ID', async () => {
      const item = await adapter.getItem('canvas-immich:asset-1');
      expect(mockClient.getAsset).toHaveBeenCalledWith('asset-1');
      expect(item.id).toBe('canvas-immich:asset-1');
      expect(item.artist).toBe('Monet');
    });

    it('builds correct proxy URL', async () => {
      const item = await adapter.getItem('canvas-immich:asset-1');
      expect(item.imageUrl).toBe('/api/v1/proxy/immich-canvas/assets/asset-1/original');
    });
  });
});
