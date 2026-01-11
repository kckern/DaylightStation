// tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs
import { LocalContentAdapter } from '../../../../../backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs';

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
});
