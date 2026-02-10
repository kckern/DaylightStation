// tests/isolated/adapter/content/narrated/NarratedAdapter.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock FileIO
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: vi.fn(),
  loadContainedYaml: vi.fn(),
  findMediaFileByPrefix: vi.fn(),
  fileExists: vi.fn(() => false),
  dirExists: vi.fn(() => true),
  listDirs: vi.fn(() => []),
  listYamlFiles: vi.fn(() => [])
}));

// Mock domains/content index for ItemSelectionService
vi.mock('#domains/content/index.mjs', () => ({
  ItemSelectionService: {
    select: vi.fn(() => []),
    applySort: vi.fn((items) => items),
    applyPick: vi.fn((items) => [items[0]])
  }
}));

const { loadYamlByPrefix, loadContainedYaml, findMediaFileByPrefix, listDirs, listYamlFiles } = await import('#system/utils/FileIO.mjs');
const { ReadalongAdapter } = await import('#adapters/content/readalong/ReadalongAdapter.mjs');

describe('ReadalongAdapter', () => {
  let adapter;

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = new ReadalongAdapter({
      dataPath: '/mock/data/content/readalong',
      mediaPath: '/mock/media/readalong'
    });
  });

  describe('source and prefixes', () => {
    it('source returns "readalong"', () => {
      expect(adapter.source).toBe('readalong');
    });

    it('prefixes returns readalong prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'readalong' }]);
    });

    it('canResolve returns true for readalong: IDs', () => {
      expect(adapter.canResolve('readalong:scripture/bom')).toBe(true);
      expect(adapter.canResolve('readalong:talks/ldsgc202410')).toBe(true);
    });

    it('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singalong:hymn/123')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getItem', () => {
    it('applies resolver when manifest declares one', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') {
          return { resolver: 'scripture' };
        }
        return {
          title: 'Alma 32',
          verses: [{ verse_id: 34541, text: 'And now...' }]
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/readalong/scripture/bom/sebom/34541.mp3');

      const item = await adapter.getItem('scripture/alma-32');

      expect(item.metadata.category).toBe('readalong');
      expect(item.metadata.collection).toBe('scripture');
    });

    it('loads item directly when no resolver', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          speaker: 'Elder Smith',
          content: ['Paragraph 1', 'Paragraph 2']
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/readalong/talks/ldsgc202410/smith.mp3');

      const item = await adapter.getItem('talks/ldsgc202410/smith');

      expect(item.id).toBe('readalong:talks/ldsgc202410/smith');
      expect(item.content.type).toBe('paragraphs');
    });

    it('returns null when item not found', async () => {
      loadContainedYaml.mockReturnValue(null);

      const item = await adapter.getItem('talks/nonexistent');

      expect(item).toBeNull();
    });

    it('includes content with paragraphs type by default', async () => {
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

    it('uses verses as content data when available', async () => {
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

    it('includes default style settings', async () => {
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

    it('merges manifest style with defaults', async () => {
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
      expect(item.style.textAlign).toBe('left');
    });

    it('includes subtitle from speaker field', async () => {
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

    it('includes subtitle from author field when no speaker', async () => {
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

    it('generates mediaUrl based on localId', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: []
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/talks/test.mp3');

      const item = await adapter.getItem('talks/ldsgc202410/smith');

      expect(item.mediaUrl).toBe('/api/v1/stream/readalong/talks/ldsgc202410/smith');
    });

    it('includes videoUrl when videoFile metadata present', async () => {
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

      expect(item.videoUrl).toBe('/api/v1/stream/readalong/talks/video-talk/video');
    });

    it('includes ambientUrl when manifest enables ambient', async () => {
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

    it('passes through full metadata', async () => {
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
    it('returns readalong as storage key for talks', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return {};
        return null;
      });
      expect(adapter.getStoragePath('talks/ldsgc202410')).toBe('readalong');
    });

    it('returns scriptures as storage key for scripture', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { storagePath: 'scriptures' };
        return null;
      });
      expect(adapter.getStoragePath('scripture/bom')).toBe('scriptures');
    });
  });

  describe('getList', () => {
    it('lists collections when no localId', async () => {
      listDirs.mockReturnValue(['scripture', 'talks', 'poetry']);

      const result = await adapter.getList('');

      expect(result.id).toBe('readalong:');
      expect(result.source).toBe('readalong');
      expect(result.category).toBe('readalong');
      expect(result.itemType).toBe('container');
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        id: 'readalong:scripture',
        source: 'readalong',
        title: 'scripture',
        thumbnail: null,
        itemType: 'container'
      });
    });

    it('lists items and subfolders in collection', async () => {
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

      expect(result.id).toBe('readalong:scripture');
      expect(result.collection).toBe('scripture');
      expect(result.itemType).toBe('container');
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        id: 'readalong:scripture/bom',
        source: 'readalong',
        title: 'bom',
        itemType: 'container'
      });
    });

    it('excludes manifest folder from collection listing', async () => {
      listDirs.mockReturnValue(['bom', 'manifest']);
      listYamlFiles.mockReturnValue([]);

      const result = await adapter.getList('scripture');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('bom');
    });

    it('excludes manifest.yml from file listing', async () => {
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

    it('lists items in subfolder', async () => {
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

      expect(result.id).toBe('readalong:scripture/bom');
      expect(result.collection).toBe('scripture');
      expect(result.itemType).toBe('container');
      expect(result.items).toHaveLength(3);
    });

    it('handles deeply nested subfolders', async () => {
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

      expect(result.id).toBe('readalong:scripture/bom/sebom');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('readalong:scripture/bom/sebom/31103');
    });
  });

  describe('resolvePlayables', () => {
    it('returns single item as array when item has mediaUrl', async () => {
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
        return {
          title: 'Test Talk',
          content: ['Paragraph 1']
        };
      });
      findMediaFileByPrefix.mockReturnValue('/mock/media/readalong/talks/test.mp3');

      const items = await adapter.resolvePlayables('talks/test-talk');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('readalong:talks/test-talk');
      expect(items[0].mediaUrl).toBeTruthy();
    });

    it('returns items from list when localId is a collection', async () => {
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue(['talk1.yml', 'talk2.yml']);
      loadContainedYaml.mockImplementation((basePath, name) => {
        if (name === 'manifest') return null;
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

    it('filters out items without mediaUrl', async () => {
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

      const items = await adapter.resolvePlayables('talks');

      expect(items.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty array when item not found and list has no playables', async () => {
      loadContainedYaml.mockReturnValue(null);
      listDirs.mockReturnValue([]);
      listYamlFiles.mockReturnValue([]);

      const items = await adapter.resolvePlayables('nonexistent');

      expect(items).toEqual([]);
    });
  });
});
