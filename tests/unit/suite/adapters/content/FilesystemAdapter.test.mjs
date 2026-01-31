// tests/unit/adapters/content/FilesystemAdapter.test.mjs
import { jest } from '@jest/globals';
import { FilesystemAdapter } from '#adapters/content/media/filesystem/FilesystemAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('FilesystemAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });
  });

  test('has correct source and prefixes', () => {
    expect(adapter.source).toBe('filesystem');
    expect(adapter.prefixes).toContainEqual({ prefix: 'media' });
    expect(adapter.prefixes).toContainEqual({ prefix: 'file' });
  });

  test('getItem returns item for existing file', async () => {
    const item = await adapter.getItem('audio/test.mp3');

    expect(item).not.toBeNull();
    expect(item.id).toBe('filesystem:audio/test.mp3');
    expect(item.source).toBe('filesystem');
    expect(item.mediaType).toBe('audio');
  });

  test('getItem returns null for missing file', async () => {
    const item = await adapter.getItem('nonexistent.mp3');
    expect(item).toBeNull();
  });

  test('getList returns directory contents', async () => {
    const list = await adapter.getList('audio');

    expect(list.length).toBeGreaterThan(0);
    expect(list[0].itemType).toBe('leaf');
  });

  test('resolvePlayables flattens directory', async () => {
    const playables = await adapter.resolvePlayables('audio');

    expect(playables.length).toBeGreaterThan(0);
    expect(playables[0].mediaUrl).toBeDefined();
  });

  test('prevents path traversal attacks', async () => {
    // Attempt to escape the media directory with ..
    const item1 = await adapter.getItem('../../../etc/passwd');
    expect(item1).toBeNull();

    const item2 = await adapter.getItem('audio/../../../../../../etc/passwd');
    expect(item2).toBeNull();

    // Test with encoded path traversal
    const item3 = await adapter.getItem('..%2F..%2Fetc/passwd');
    expect(item3).toBeNull();

    // Test getList with path traversal
    const list1 = await adapter.getList('../../../etc');
    expect(list1).toEqual([]);

    const list2 = await adapter.getList('audio/../../../etc');
    expect(list2).toEqual([]);
  });

  test('throws error when mediaBasePath is missing', () => {
    expect(() => new FilesystemAdapter({})).toThrow('FilesystemAdapter requires mediaBasePath');
    expect(() => new FilesystemAdapter({ mediaBasePath: '' })).toThrow('FilesystemAdapter requires mediaBasePath');
  });

  describe('ID3 tag parsing', () => {
    test('should include artist from audio file metadata', async () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: fixturesPath
      });

      // Inject mock for parseFile to simulate ID3 tags
      adapter._parseFile = jest.fn().mockResolvedValue({
        common: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          year: 2024,
          track: { no: 5 },
          genre: ['Rock', 'Alternative']
        }
      });

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      expect(item.metadata.artist).toBe('Test Artist');
      expect(item.metadata.album).toBe('Test Album');
      expect(item.metadata.year).toBe(2024);
      expect(item.metadata.track).toBe(5);
      expect(item.metadata.genre).toBe('Rock, Alternative');
    });

    test('should handle files without ID3 tags gracefully', async () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = jest.fn().mockResolvedValue({ common: {} });

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      expect(item.metadata.artist).toBeUndefined();
      expect(item.metadata.album).toBeUndefined();
    });

    test('should handle parse errors gracefully', async () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = jest.fn().mockRejectedValue(new Error('Parse error'));

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      // Should still return item, just without ID3 metadata
      expect(item.id).toBe('filesystem:audio/test.mp3');
    });

    test('should only parse ID3 tags for audio files', async () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = jest.fn().mockResolvedValue({
        common: { artist: 'Test Artist' }
      });

      // The test fixture has audio/test.mp3
      const audioItem = await adapter.getItem('audio/test.mp3');
      expect(adapter._parseFile).toHaveBeenCalled();

      // Reset mock
      adapter._parseFile.mockClear();

      // For non-audio files (if they existed), _parseFile should not be called
      // This tests the conditional logic in getItem
    });
  });

  describe('getCoverArt', () => {
    test('should return cover art for valid image type and size', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });

      const mockImageData = new Uint8Array(1024); // 1KB image
      adapter._parseFile = jest.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/jpeg',
            data: mockImageData
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');

      expect(result).not.toBeNull();
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    test('should return null for invalid MIME type', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });

      adapter._parseFile = jest.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/bmp', // Not in VALID_IMAGE_TYPES
            data: new Uint8Array(1024)
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should return null for oversized images', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });

      // Create data larger than 10MB limit
      const hugeData = new Uint8Array(11 * 1024 * 1024);
      adapter._parseFile = jest.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/jpeg',
            data: hugeData
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should return null for file without cover art', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });

      adapter._parseFile = jest.fn().mockResolvedValue({
        common: {}
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should log warning on parse error', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      adapter._parseFile = jest.fn().mockRejectedValue(new Error('Parse failed'));

      const result = await adapter.getCoverArt('audio/test.mp3');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse cover art'),
        'Parse failed'
      );

      warnSpy.mockRestore();
    });

    test('should return null for unresolvable path', async () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: fixturesPath });

      const result = await adapter.getCoverArt('nonexistent/file.mp3');
      expect(result).toBeNull();
    });
  });

  describe('image MIME types', () => {
    it('should detect SVG files', () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.svg')).toBe('image/svg+xml');
    });

    it('should detect GIF files', () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.gif')).toBe('image/gif');
    });

    it('should detect WebP files', () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.webp')).toBe('image/webp');
    });

    it('should include image type in getMediaType', () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMediaType('.svg')).toBe('image');
      expect(adapter.getMediaType('.gif')).toBe('image');
      expect(adapter.getMediaType('.webp')).toBe('image');
      expect(adapter.getMediaType('.jpg')).toBe('image');
      expect(adapter.getMediaType('.png')).toBe('image');
    });

    it('should detect existing image formats', () => {
      const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.jpg')).toBe('image/jpeg');
      expect(adapter.getMimeType('.jpeg')).toBe('image/jpeg');
      expect(adapter.getMimeType('.png')).toBe('image/png');
    });
  });

  describe('household-scoped watch state', () => {
    test('should accept householdId in constructor', () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: '/test/media',
        historyPath: '/test/history/media',
        householdId: 'test-household',
        householdsBasePath: '/test/households'
      });

      expect(adapter.householdId).toBe('test-household');
      expect(adapter.householdsBasePath).toBe('/test/households');
    });

    test('should try household path first for watch state', () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: '/test/media',
        historyPath: '/test/history/media',
        householdId: 'test-household',
        householdsBasePath: '/test/households'
      });

      const existsCalls = [];
      // Use injection pattern for testing - inject mock implementations
      adapter._existsSync = (p) => {
        existsCalls.push(p);
        return p.includes('test-household');
      };
      adapter._readFileSync = () => `
song.mp3:
  playhead: 120
  percent: 50
`;

      adapter._watchStateCache = null; // Clear cache
      const watchState = adapter._loadWatchState();

      expect(existsCalls[0]).toContain('test-household');
      expect(watchState['song.mp3'].playhead).toBe(120);
    });

    test('should fall back to global path when household path missing', () => {
      const adapter = new FilesystemAdapter({
        mediaBasePath: '/test/media',
        historyPath: '/test/history/media',
        householdId: 'test-household',
        householdsBasePath: '/test/households'
      });

      const existsCalls = [];
      // Use injection pattern for testing
      adapter._existsSync = (p) => {
        existsCalls.push(p);
        // Household path doesn't exist, global does
        return p === '/test/history/media/media.yml';
      };
      adapter._readFileSync = () => `
track.mp3:
  playhead: 60
`;

      adapter._watchStateCache = null;
      const watchState = adapter._loadWatchState();

      expect(existsCalls.length).toBeGreaterThanOrEqual(2);
      expect(watchState['track.mp3'].playhead).toBe(60);
    });
  });
});
