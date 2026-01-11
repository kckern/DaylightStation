// tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { LocalContentAdapter } from '../../../../../backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('LocalContentAdapter', () => {
  let adapter;
  const mockConfig = {
    dataPath: '/data',
    mediaPath: '/media'
  };

  beforeEach(() => {
    adapter = new LocalContentAdapter(mockConfig);
  });

  describe('constructor', () => {
    it('requires dataPath', () => {
      expect(() => new LocalContentAdapter({ mediaPath: '/media' }))
        .toThrow('requires dataPath');
    });

    it('requires mediaPath', () => {
      expect(() => new LocalContentAdapter({ dataPath: '/data' }))
        .toThrow('requires mediaPath');
    });
  });

  describe('name', () => {
    it('returns local-content', () => {
      expect(adapter.name).toBe('local-content');
    });
  });

  describe('prefixes', () => {
    it('returns supported prefixes', () => {
      expect(adapter.prefixes).toEqual(['talk', 'scripture']);
    });
  });

  describe('canResolve', () => {
    it('returns true for talk: prefix', () => {
      expect(adapter.canResolve('talk:general/2024-04-talk1')).toBe(true);
    });

    it('returns true for scripture: prefix', () => {
      expect(adapter.canResolve('scripture:bom/1nephi/1')).toBe(true);
    });

    it('returns false for other prefixes', () => {
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });

  describe('getStoragePath', () => {
    it('returns talks for talk items', () => {
      expect(adapter.getStoragePath('talk:general/2024-04-talk1')).toBe('talks');
    });

    it('returns scripture for scripture items', () => {
      expect(adapter.getStoragePath('scripture:bom/1nephi/1')).toBe('scripture');
    });
  });

  describe('getItem', () => {
    it('returns PlayableItem for talk', async () => {
      const fixtureAdapter = new LocalContentAdapter({
        dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
        mediaPath: '/media'
      });

      const item = await fixtureAdapter.getItem('talk:general/test-talk');

      expect(item).not.toBeNull();
      expect(item.id).toBe('talk:general/test-talk');
      expect(item.title).toBe('Test Talk Title');
      expect(item.duration).toBe(1200);
      expect(item.isPlayable()).toBe(true);
    });

    it('returns null for nonexistent talk', async () => {
      const item = await adapter.getItem('talk:general/nonexistent');
      expect(item).toBeNull();
    });

    it('rejects path traversal attempts', async () => {
      const item = await adapter.getItem('talk:../../../etc/passwd');
      expect(item).toBeNull();
    });

    it('rejects path traversal with encoded sequences', async () => {
      const item = await adapter.getItem('talk:general/../../../etc/passwd');
      expect(item).toBeNull();
    });

    it('rejects absolute path attempts', async () => {
      const item = await adapter.getItem('talk:/etc/passwd');
      expect(item).toBeNull();
    });
  });

  describe('getList', () => {
    it('returns ListableItem with children for talk folder', async () => {
      const fixtureAdapter = new LocalContentAdapter({
        dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
        mediaPath: '/media'
      });

      const list = await fixtureAdapter.getList('talk:april2024');

      expect(list).not.toBeNull();
      expect(list.id).toBe('talk:april2024');
      expect(list.isContainer()).toBe(true);
      expect(list.children.length).toBe(2);
    });

    it('returns null for nonexistent folder', async () => {
      const list = await adapter.getList('talk:nonexistent');
      expect(list).toBeNull();
    });

    it('rejects path traversal attempts in getList', async () => {
      const list = await adapter.getList('talk:../../../etc');
      expect(list).toBeNull();
    });

    it('returns null when localId is missing', async () => {
      const list = await adapter.getList('talk:');
      expect(list).toBeNull();
    });
  });

  describe('resolvePlayables', () => {
    it('returns single item for talk', async () => {
      const fixtureAdapter = new LocalContentAdapter({
        dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
        mediaPath: '/media'
      });

      const playables = await fixtureAdapter.resolvePlayables('talk:general/test-talk');

      expect(playables.length).toBe(1);
      expect(playables[0].id).toBe('talk:general/test-talk');
    });

    it('returns all talks for folder', async () => {
      const fixtureAdapter = new LocalContentAdapter({
        dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
        mediaPath: '/media'
      });

      const playables = await fixtureAdapter.resolvePlayables('talk:april2024');

      expect(playables.length).toBe(2);
      expect(playables.every(p => p.isPlayable())).toBe(true);
    });

    it('returns empty array for nonexistent item', async () => {
      const playables = await adapter.resolvePlayables('talk:nonexistent');
      expect(playables).toEqual([]);
    });
  });
});
