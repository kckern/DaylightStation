// tests/unit/api/middleware/legacyListShim.test.mjs
import {
  translateDataListPath,
  translatePlexListPath,
  toLegacyListResponse
} from '@backend/src/4_api/middleware/legacyListShim.mjs';

describe('Legacy List Shim', () => {
  describe('translateDataListPath', () => {
    it('translates simple folder reference', () => {
      const result = translateDataListPath('TVApp');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('TVApp');
    });

    it('handles modifiers', () => {
      const result = translateDataListPath('TVApp/recent_on_top');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('TVApp');
      expect(result.modifiers).toContain('recent_on_top');
    });

    it('handles playable,shuffle modifiers', () => {
      const result = translateDataListPath('Morning+Program/playable,shuffle');
      expect(result.source).toBe('folder');
      expect(result.localId).toBe('Morning Program');
      expect(result.modifiers).toContain('playable');
      expect(result.modifiers).toContain('shuffle');
    });

    it('replaces + with space', () => {
      const result = translateDataListPath('Morning+Program');
      expect(result.localId).toBe('Morning Program');
    });
  });

  describe('translatePlexListPath', () => {
    it('translates simple plex ID', () => {
      const result = translatePlexListPath('12345');
      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
    });

    it('handles modifiers', () => {
      const result = translatePlexListPath('12345/playable');
      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.modifiers).toContain('playable');
    });
  });

  describe('toLegacyListResponse', () => {
    it('transforms new response to legacy format', () => {
      const newResponse = {
        source: 'plex',
        path: '12345',
        title: 'TV Show',
        image: '/thumb.jpg',
        items: [
          { id: 'plex:12345', title: 'Episode 1', itemType: 'leaf', thumbnail: '/ep1.jpg' }
        ]
      };

      const legacy = toLegacyListResponse(newResponse);

      expect(legacy.title).toBe('TV Show');
      expect(legacy.label).toBe('TV Show');
      expect(legacy.image).toBe('/thumb.jpg');
      expect(legacy.plex).toBe('12345');
      expect(legacy.items).toHaveLength(1);
      expect(legacy.items[0].image).toBe('/ep1.jpg');
    });

    it('handles folder source', () => {
      const newResponse = {
        source: 'folder',
        path: 'Morning Program',
        title: 'Morning Program',
        items: []
      };

      const legacy = toLegacyListResponse(newResponse);

      expect(legacy.kind).toBe('folder');
      expect(legacy.plex).toBeUndefined();
    });
  });
});
