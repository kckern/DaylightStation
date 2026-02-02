// tests/isolated/adapter/content/singing/SingingAdapter.test.mjs
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
const { SingingAdapter } = await import('#adapters/content/singing/SingingAdapter.mjs');

describe('SingingAdapter', () => {
  let adapter;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    adapter = new SingingAdapter({
      dataPath: '/mock/data/content/singing',
      mediaPath: '/mock/media/singing'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "singing"', () => {
      expect(adapter.source).toBe('singing');
    });

    test('prefixes returns singing prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'singing' }]);
    });

    test('canResolve returns true for singing: IDs', () => {
      expect(adapter.canResolve('singing:hymn/123')).toBe(true);
      expect(adapter.canResolve('singing:primary/1')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('narrated:scripture/bom')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getItem', () => {
    test('uses prefix matching for numeric IDs', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'The Spirit of God',
        number: 2,
        verses: [['Verse 1 line 1', 'Verse 1 line 2']]
      });
      loadContainedYaml.mockReturnValue(null); // No manifest
      findMediaFileByPrefix.mockReturnValue('/mock/media/singing/hymn/0002-the-spirit-of-god.mp3');

      const item = await adapter.getItem('hymn/2');

      expect(loadYamlByPrefix).toHaveBeenCalledWith(
        '/mock/data/content/singing/hymn',
        '2'
      );
      expect(item.id).toBe('singing:hymn/2');
      expect(item.title).toBe('The Spirit of God');
      expect(item.category).toBe('singing');
      expect(item.collection).toBe('hymn');
    });

    test('uses direct path for non-numeric IDs', async () => {
      loadContainedYaml.mockImplementation((dir, name) => {
        if (name === 'manifest') return null;
        if (name === 'custom-song') return {
          title: 'Custom Song',
          verses: [['Line 1']]
        };
        return null;
      });

      const item = await adapter.getItem('hymn/custom-song');

      expect(loadContainedYaml).toHaveBeenCalled();
      expect(item.id).toBe('singing:hymn/custom-song');
    });

    test('returns null when item not found', async () => {
      loadYamlByPrefix.mockReturnValue(null);
      loadContainedYaml.mockReturnValue(null);

      const item = await adapter.getItem('hymn/999');

      expect(item).toBeNull();
    });

    test('includes content with stanzas type', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Hymn',
        number: 5,
        verses: [['Line 1', 'Line 2'], ['Line 3', 'Line 4']]
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue('/mock/media/singing/hymn/0005-test.mp3');

      const item = await adapter.getItem('hymn/5');

      expect(item.content).toEqual({
        type: 'stanzas',
        data: [['Line 1', 'Line 2'], ['Line 3', 'Line 4']]
      });
    });

    test('includes default style settings', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Hymn',
        number: 7,
        verses: []
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('hymn/7');

      expect(item.style).toEqual({
        fontFamily: 'serif',
        fontSize: '1.4rem',
        textAlign: 'center'
      });
    });

    test('generates subtitle from collection and number', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Hymn',
        number: 42,
        verses: []
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('hymn/42');

      expect(item.subtitle).toBe('hymn #42');
    });

    test('generates mediaUrl based on localId', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Song',
        number: 10,
        verses: []
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue('/mock/media/primary/0010-test.mp3');

      const item = await adapter.getItem('primary/10');

      expect(item.mediaUrl).toBe('/api/v1/stream/singing/primary/10');
    });
  });

  describe('getList', () => {
    test('lists collections when no localId', async () => {
      listDirs.mockReturnValue(['hymn', 'primary']);

      const result = await adapter.getList('');

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('singing:hymn');
      expect(result.items[0].itemType).toBe('container');
    });

    test('lists items in collection', async () => {
      listYamlFiles.mockReturnValue(['0001-song.yml', '0002-song.yml']);
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Song',
        number: 1,
        verses: []
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue(null);

      const result = await adapter.getList('hymn');

      expect(result.items).toHaveLength(2);
    });
  });

  describe('resolvePlayables', () => {
    test('returns single item as array', async () => {
      loadYamlByPrefix.mockReturnValue({
        title: 'Test Song',
        number: 1,
        verses: []
      });
      loadContainedYaml.mockReturnValue(null);
      findMediaFileByPrefix.mockReturnValue(null);

      const items = await adapter.resolvePlayables('hymn/1');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('singing:hymn/1');
    });
  });

  describe('getStoragePath', () => {
    test('returns singing as storage key', () => {
      expect(adapter.getStoragePath()).toBe('singing');
    });
  });
});
