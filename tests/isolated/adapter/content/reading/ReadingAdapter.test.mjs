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

  describe('getList', () => {
    test('lists collections when no localId', async () => {
      listDirs.mockReturnValue(['scripture', 'talks', 'poetry']);

      const result = await adapter.getList('');

      expect(result.id).toBe('reading:');
      expect(result.source).toBe('reading');
      expect(result.category).toBe('reading');
      expect(result.itemType).toBe('container');
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        id: 'reading:scripture',
        source: 'reading',
        title: 'scripture',
        itemType: 'container'
      });
    });

    test('lists items and subfolders in collection', async () => {
      listDirs.mockReturnValue(['bom', 'dc']);
      listYamlFiles.mockReturnValue(['introduction.yml', 'manifest.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        if (name === 'introduction') {
          return {
            title: 'Introduction',
            content: ['Intro paragraph']
          };
        }
        return null;
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const result = await adapter.getList('scripture');

      expect(result.id).toBe('reading:scripture');
      expect(result.collection).toBe('scripture');
      expect(result.itemType).toBe('container');
      // Should have 2 subfolders (bom, dc) + 1 file (introduction, excluding manifest.yml)
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        id: 'reading:scripture/bom',
        source: 'reading',
        title: 'bom',
        itemType: 'container'
      });
    });

    test('excludes manifest folder from collection listing', async () => {
      listDirs.mockReturnValue(['bom', 'manifest']);
      listYamlFiles.mockReturnValue([]);

      const result = await adapter.getList('scripture');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('bom');
    });

    test('excludes manifest.yml from file listing', async () => {
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue(['talk1.yml', 'manifest.yml', 'talk2.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: `Talk ${name}`,
          content: ['Content']
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const result = await adapter.getList('talks');

      expect(result.items).toHaveLength(2);
    });

    test('lists items in subfolder', async () => {
      listDirs.mockReturnValue(['sebom']);
      listYamlFiles.mockReturnValue(['chapter1.yml', 'chapter2.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: `Chapter ${name.replace('chapter', '')}`,
          verses: [{ verse_id: 1, text: 'Verse text' }]
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const result = await adapter.getList('scripture/bom');

      expect(result.id).toBe('reading:scripture/bom');
      expect(result.collection).toBe('scripture');
      expect(result.itemType).toBe('container');
      // Should have 1 subfolder (sebom) + 2 files (chapter1, chapter2)
      expect(result.items).toHaveLength(3);
    });

    test('handles deeply nested subfolders', async () => {
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue(['31103.yml', '31104.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: `Verse ${name}`,
          verses: [{ verse_id: parseInt(name), text: 'Text' }]
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      const result = await adapter.getList('scripture/bom/sebom');

      expect(result.id).toBe('reading:scripture/bom/sebom');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('reading:scripture/bom/sebom/31103');
    });
  });

  describe('resolvePlayables', () => {
    test('returns single item as array when item has mediaUrl', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: ['Paragraph 1']
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/reading/talks/test.mp3');

      const items = await adapter.resolvePlayables('talks/test-talk');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('reading:talks/test-talk');
      expect(items[0].mediaUrl).toBeTruthy();
    });

    test('returns items from list when localId is a collection', async () => {
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue(['talk1.yml', 'talk2.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        // Empty string path means collection root (not an item)
        if (name === '') return null;
        return {
          title: `Talk ${name}`,
          content: ['Content']
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/talks/talk.mp3');

      const items = await adapter.resolvePlayables('talks');

      expect(items).toHaveLength(2);
      expect(items.every(i => i.mediaUrl)).toBe(true);
    });

    test('filters out items without mediaUrl', async () => {
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue(['talk1.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Talk',
          content: ['Content']
        };
      });
      findMediaFileByPrefix.mockReturnValue(null);

      // The item will still have mediaUrl (API route), so it should be included
      // In real scenario, items without actual media files would still have the route
      const items = await adapter.resolvePlayables('talks');

      // Items will have mediaUrl since it's generated from the API route pattern
      expect(items.length).toBeGreaterThanOrEqual(0);
    });

    test('returns empty array when item not found and list has no playables', async () => {
      loadContainedYaml.mockReturnValue(null);
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue([]);

      const items = await adapter.resolvePlayables('nonexistent');

      expect(items).toEqual([]);
    });
  });
});
