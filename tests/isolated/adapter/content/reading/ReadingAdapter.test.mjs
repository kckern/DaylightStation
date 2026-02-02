// tests/isolated/adapter/content/reading/ReadingAdapter.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock FileIO at top of file
jest.unstable_mockModule('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: jest.fn(),
  loadContainedYaml: jest.fn(),
  findMediaFileByPrefix: jest.fn(),
  dirExists: jest.fn(() => true),
  listDirs: jest.fn(() => []),
  listYamlFiles: jest.fn(() => [])
}));

const { loadYamlByPrefix, loadContainedYaml, findMediaFileByPrefix, listDirs, listYamlFiles } = await import('#system/utils/FileIO.mjs');
const { ReadingAdapter } = await import('#adapters/content/reading/ReadingAdapter.mjs');

describe('ReadingAdapter', () => {
  let adapter;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    adapter = new ReadingAdapter({
      dataPath: '/mock/data/content/reading',
      mediaPath: '/mock/media/reading'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "reading"', () => {
      expect(adapter.source).toBe('reading');
    });

    test('prefixes returns reading prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'reading' }]);
    });

    test('canResolve returns true for reading: IDs', () => {
      expect(adapter.canResolve('reading:scripture/bom')).toBe(true);
      expect(adapter.canResolve('reading:talks/ldsgc202410')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singing:hymn/123')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getItem', () => {
    test('applies resolver when manifest declares one', async () => {
      // Mock manifest with resolver
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') {
          return { resolver: 'scripture' };
        }
        // Mock scripture data
        return {
          title: 'Alma 32',
          verses: [{ verse_id: 34541, text: 'And now...' }]
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/reading/scripture/bom/sebom/34541.mp3');

      // Mock the scripture resolver module
      jest.unstable_mockModule('#adapters/content/reading/resolvers/scripture.mjs', () => ({
        default: {
          resolve: jest.fn(() => 'bom/sebom/34541')
        },
        ScriptureResolver: {
          resolve: jest.fn(() => 'bom/sebom/34541')
        }
      }));

      const item = await adapter.getItem('scripture/alma-32');

      expect(item.category).toBe('reading');
      expect(item.collection).toBe('scripture');
    });

    test('loads item directly when no resolver', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          speaker: 'Elder Smith',
          content: ['Paragraph 1', 'Paragraph 2']
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/reading/talks/ldsgc202410/smith.mp3');

      const item = await adapter.getItem('talks/ldsgc202410/smith');

      expect(item.id).toBe('reading:talks/ldsgc202410/smith');
      expect(item.content.type).toBe('paragraphs');
    });

    test('returns null when item not found', async () => {
      loadContainedYaml.mockReturnValue(null);

      const item = await adapter.getItem('talks/nonexistent');

      expect(item).toBeNull();
    });

    test('includes content with paragraphs type by default', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: ['Para 1', 'Para 2']
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/test');

      expect(item.content).toEqual({
        type: 'paragraphs',
        data: ['Para 1', 'Para 2']
      });
    });

    test('uses verses as content data when available', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return { contentType: 'verses' };
        return {
          title: 'Scripture Chapter',
          verses: [{ verse_id: 1, text: 'First verse' }]
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('scripture/bom/sebom/31103');

      expect(item.content.type).toBe('verses');
      expect(item.content.data).toEqual([{ verse_id: 1, text: 'First verse' }]);
    });

    test('includes default style settings', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/test');

      expect(item.style).toEqual({
        fontFamily: 'sans-serif',
        fontSize: '1.2rem',
        textAlign: 'left'
      });
    });

    test('merges manifest style with defaults', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') {
          return {
            style: {
              fontFamily: 'Georgia',
              lineHeight: '1.8'
            }
          };
        }
        return {
          title: 'Styled Talk',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/styled');

      expect(item.style.fontFamily).toBe('Georgia');
      expect(item.style.lineHeight).toBe('1.8');
      expect(item.style.textAlign).toBe('left'); // default preserved
    });

    test('includes subtitle from speaker field', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          speaker: 'Elder Smith',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/test');

      expect(item.subtitle).toBe('Elder Smith');
    });

    test('includes subtitle from author field when no speaker', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Poetry Collection',
          author: 'Emily Dickinson',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('poetry/dickinson');

      expect(item.subtitle).toBe('Emily Dickinson');
    });

    test('generates mediaUrl based on localId', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/talks/test.mp3');

      const item = await adapter.getItem('talks/ldsgc202410/smith');

      expect(item.mediaUrl).toBe('/api/v1/stream/reading/talks/ldsgc202410/smith');
    });

    test('includes videoUrl when videoFile metadata present', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Video Talk',
          videoFile: 'talk.mp4',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/video-talk');

      expect(item.videoUrl).toBe('/api/v1/stream/reading/talks/video-talk/video');
    });

    test('includes ambientUrl when manifest enables ambient', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') {
          return { ambient: true };
        }
        return {
          title: 'Scripture',
          verses: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('scripture/bom/sebom/31103');

      expect(item.ambientUrl).toMatch(/^\/api\/v1\/stream\/ambient\/\d{3}$/);
    });

    test('passes through full metadata', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          speaker: 'Elder Smith',
          duration: 1234,
          customField: 'custom value',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('talks/test');

      expect(item.metadata.speaker).toBe('Elder Smith');
      expect(item.metadata.customField).toBe('custom value');
      expect(item.duration).toBe(1234);
    });
  });

  describe('getStoragePath', () => {
    test('returns reading as storage key', () => {
      expect(adapter.getStoragePath()).toBe('reading');
    });
  });
});
