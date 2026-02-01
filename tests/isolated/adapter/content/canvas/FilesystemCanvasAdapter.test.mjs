// tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { FilesystemCanvasAdapter } from '../../../../../backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs';

describe('FilesystemCanvasAdapter', () => {
  let adapter;
  let mockFs;
  let mockExifReader;

  beforeEach(() => {
    mockFs = {
      readdirSync: jest.fn(),
      statSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn(),
    };

    mockExifReader = {
      load: jest.fn().mockReturnValue({
        Artist: { value: 'Test Artist' },
        DateTimeOriginal: { value: '2020:01:15 10:30:00' },
        ImageDescription: { value: 'Test description' },
      }),
    };

    adapter = new FilesystemCanvasAdapter({
      basePath: '/media/art',
      proxyPath: '/api/v1/canvas/image',
    }, {
      fs: mockFs,
      exifReader: mockExifReader,
    });
  });

  describe('source and prefixes', () => {
    it('has correct source name', () => {
      expect(adapter.source).toBe('canvas-filesystem');
    });

    it('has canvas prefix', () => {
      expect(adapter.prefixes).toContainEqual({ prefix: 'canvas' });
    });
  });

  describe('list', () => {
    it('scans category folders', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes', 'abstract'];
        if (path === '/media/art/landscapes') return ['sunset.jpg', 'mountain.png'];
        if (path === '/media/art/abstract') return ['shapes.jpg'];
        return [];
      });
      mockFs.statSync.mockImplementation((path) => ({
        isDirectory: () => !path.includes('.'),
        isFile: () => path.includes('.'),
      }));

      const items = await adapter.list();

      expect(items).toHaveLength(3);
      expect(items[0].category).toBe('landscapes');
      expect(items[2].category).toBe('abstract');
    });

    it('extracts EXIF metadata', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes'];
        if (path === '/media/art/landscapes') return ['test.jpg'];
        return [];
      });
      mockFs.statSync.mockImplementation((path) => ({
        isDirectory: () => !path.includes('.'),
        isFile: () => path.includes('.'),
      }));

      const items = await adapter.list();

      expect(items[0].artist).toBe('Test Artist');
      expect(items[0].year).toBe(2020);
    });

    it('filters by category when provided', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes', 'abstract'];
        if (path === '/media/art/landscapes') return ['test.jpg'];
        if (path === '/media/art/abstract') return ['shapes.jpg'];
        return [];
      });
      mockFs.statSync.mockImplementation((path) => ({
        isDirectory: () => !path.includes('.'),
        isFile: () => path.includes('.'),
      }));

      const items = await adapter.list({ categories: ['landscapes'] });

      expect(items).toHaveLength(1);
      expect(items[0].category).toBe('landscapes');
    });
  });

  describe('getItem', () => {
    it('returns DisplayableItem for valid path', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const item = await adapter.getItem('canvas:landscapes/sunset.jpg');

      expect(item.id).toBe('canvas:landscapes/sunset.jpg');
      expect(item.category).toBe('landscapes');
      expect(item.imageUrl).toBe('/api/v1/canvas/image/landscapes/sunset.jpg');
    });

    it('returns null for missing file', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const item = await adapter.getItem('canvas:missing.jpg');

      expect(item).toBeNull();
    });
  });
});
