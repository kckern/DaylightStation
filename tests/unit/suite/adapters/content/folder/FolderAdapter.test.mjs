// tests/unit/adapters/content/folder/FolderAdapter.test.mjs
import { FolderAdapter } from '#adapters/content/folder/FolderAdapter.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('FolderAdapter', () => {
  let adapter;
  const mockRegistry = {
    getAdapter: () => null,
    resolveItem: () => null
  };

  beforeEach(() => {
    adapter = new FolderAdapter({
      watchlistPath: path.resolve(__dirname, '../../../../_fixtures/folder/watchlist.yaml'),
      registry: mockRegistry
    });
  });

  describe('constructor', () => {
    test('requires watchlistPath', () => {
      expect(() => new FolderAdapter({ registry: mockRegistry }))
        .toThrow('requires watchlistPath');
    });
  });

  describe('source', () => {
    test('returns folder', () => {
      expect(adapter.source).toBe('folder');
    });
  });

  describe('prefixes', () => {
    test('returns folder prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'folder' }]);
    });
  });

  describe('canResolve', () => {
    test('returns true for folder: prefix', () => {
      expect(adapter.canResolve('folder:Morning Shows')).toBe(true);
    });

    test('returns false for other prefixes', () => {
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getList', () => {
    test('returns folder contents', async () => {
      const list = await adapter.getList('folder:Morning Shows');

      expect(list).not.toBeNull();
      expect(list.id).toBe('folder:Morning Shows');
      expect(list.children.length).toBe(2);
    });

    test('returns null for nonexistent folder', async () => {
      const list = await adapter.getList('folder:Nonexistent');
      expect(list).toBeNull();
    });
  });

  describe('getItem', () => {
    test('returns folder metadata', async () => {
      const item = await adapter.getItem('folder:Morning Shows');
      expect(item).not.toBeNull();
      expect(item.id).toBe('folder:Morning Shows');
      expect(item.childCount).toBe(2);
    });
  });

  describe('getStoragePath', () => {
    test('returns sanitized folder name', () => {
      expect(adapter.getStoragePath('folder:Morning Shows')).toBe('folder_Morning_Shows');
    });
  });
});
