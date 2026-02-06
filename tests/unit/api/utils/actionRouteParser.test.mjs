// tests/unit/api/utils/actionRouteParser.test.mjs
import { describe, it, expect } from 'vitest';
import { parseActionRouteId } from '#api/v1/utils/actionRouteParser.mjs';

describe('parseActionRouteId', () => {
  describe('Path segments format', () => {
    it('should parse source and path segments into normalized result', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
    });

    it('should handle nested path segments for watchlist source', () => {
      const result = parseActionRouteId({ source: 'watchlist', path: 'watchlist/FHE' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('watchlist/FHE');
      expect(result.compoundId).toBe('watchlist:watchlist/FHE');
    });

    it('should handle deeply nested paths', () => {
      const result = parseActionRouteId({ source: 'files', path: 'media/videos/vacation.mp4' });

      expect(result.source).toBe('files');
      expect(result.localId).toBe('media/videos/vacation.mp4');
      expect(result.compoundId).toBe('files:media/videos/vacation.mp4');
    });
  });

  describe('Compound ID format', () => {
    it('should parse compound ID when source contains colon', () => {
      const result = parseActionRouteId({ source: 'plex:12345', path: '' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
    });

    it('should handle compound ID with path segments in localId', () => {
      const result = parseActionRouteId({ source: 'watchlist:watchlist/FHE', path: '' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('watchlist/FHE');
      expect(result.compoundId).toBe('watchlist:watchlist/FHE');
    });

    it('should handle undefined path with compound ID', () => {
      const result = parseActionRouteId({ source: 'immich:abc-123-def' });

      expect(result.source).toBe('immich');
      expect(result.localId).toBe('abc-123-def');
      expect(result.compoundId).toBe('immich:abc-123-def');
    });
  });

  describe('Heuristic detection', () => {
    it('should detect plex source from bare digits', () => {
      const result = parseActionRouteId({ source: '12345', path: '' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
    });

    it('should detect immich source from UUID pattern', () => {
      const result = parseActionRouteId({ source: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', path: '' });

      expect(result.source).toBe('immich');
      expect(result.localId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.compoundId).toBe('immich:a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should detect files source from file extension', () => {
      const result = parseActionRouteId({ source: 'vacation.mp4', path: '' });

      expect(result.source).toBe('files');
      expect(result.localId).toBe('vacation.mp4');
      expect(result.compoundId).toBe('files:vacation.mp4');
    });

    it('should detect files source from path with extension', () => {
      const result = parseActionRouteId({ source: 'photos/image.jpg', path: '' });

      expect(result.source).toBe('files');
      expect(result.localId).toBe('photos/image.jpg');
      expect(result.compoundId).toBe('files:photos/image.jpg');
    });
  });

  describe('Alias normalization', () => {
    it('should normalize local to watchlist', () => {
      const result = parseActionRouteId({ source: 'local', path: 'TVApp' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('TVApp');
      expect(result.compoundId).toBe('watchlist:TVApp');
    });

    it('should normalize local in compound ID format', () => {
      const result = parseActionRouteId({ source: 'local:watchlist', path: '' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('watchlist');
      expect(result.compoundId).toBe('watchlist:watchlist');
    });
  });

  describe('Modifier extraction', () => {
    it('should extract shuffle modifier from path', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345/shuffle' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
      expect(result.modifiers).toEqual({ shuffle: true });
    });

    it('should extract playable modifier from path', () => {
      const result = parseActionRouteId({ source: 'watchlist', path: 'watchlist/playable' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('watchlist');
      expect(result.compoundId).toBe('watchlist:watchlist');
      expect(result.modifiers).toEqual({ playable: true });
    });

    it('should extract recent_on_top modifier from path', () => {
      const result = parseActionRouteId({ source: 'plex', path: '99999/recent_on_top' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('99999');
      expect(result.compoundId).toBe('plex:99999');
      expect(result.modifiers).toEqual({ recent_on_top: true });
    });

    it('should extract multiple modifiers from path', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345/shuffle/playable' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
    });

    it('should handle comma-separated modifiers', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345/shuffle,playable' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
    });

    it('should return empty modifiers object when no modifiers present', () => {
      const result = parseActionRouteId({ source: 'plex', path: '12345' });

      expect(result.modifiers).toEqual({});
    });
  });

  describe('Edge cases', () => {
    it('should handle empty source', () => {
      const result = parseActionRouteId({ source: '', path: '' });

      expect(result.source).toBe('');
      expect(result.localId).toBe('');
      expect(result.compoundId).toBe('');
    });

    it('should handle undefined inputs', () => {
      const result = parseActionRouteId({});

      expect(result.source).toBe('');
      expect(result.localId).toBe('');
      expect(result.compoundId).toBe('');
    });

    it('should handle source only (no path)', () => {
      const result = parseActionRouteId({ source: 'plex' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('');
      expect(result.compoundId).toBe('plex:');
    });

    it('should preserve all known sources', () => {
      const knownSources = ['plex', 'immich', 'watchlist', 'files', 'canvas', 'audiobookshelf', 'komga', 'singing', 'narrated'];

      for (const src of knownSources) {
        const result = parseActionRouteId({ source: src, path: 'test-id' });
        expect(result.source).toBe(src);
      }
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle Plex movie route', () => {
      // /play/plex/12345
      const result = parseActionRouteId({ source: 'plex', path: '12345' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
    });

    it('should handle watchlist route with shuffle', () => {
      // /list/watchlist/watchlist/shuffle
      const result = parseActionRouteId({ source: 'watchlist', path: 'watchlist/shuffle' });

      expect(result.source).toBe('watchlist');
      expect(result.localId).toBe('watchlist');
      expect(result.compoundId).toBe('watchlist:watchlist');
      expect(result.modifiers).toEqual({ shuffle: true });
    });

    it('should handle immich album with playable modifier', () => {
      // /display/immich/a1b2c3d4-e5f6-7890-abcd-ef1234567890/playable
      const result = parseActionRouteId({
        source: 'immich',
        path: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890/playable'
      });

      expect(result.source).toBe('immich');
      expect(result.localId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.compoundId).toBe('immich:a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.modifiers).toEqual({ playable: true });
    });

    it('should handle compound ID in legacy format', () => {
      // /info/plex:12345
      const result = parseActionRouteId({ source: 'plex:12345' });

      expect(result.source).toBe('plex');
      expect(result.localId).toBe('12345');
      expect(result.compoundId).toBe('plex:12345');
    });

    it('should handle audiobookshelf item', () => {
      const result = parseActionRouteId({ source: 'audiobookshelf', path: 'li_abc123' });

      expect(result.source).toBe('audiobookshelf');
      expect(result.localId).toBe('li_abc123');
      expect(result.compoundId).toBe('audiobookshelf:li_abc123');
    });
  });
});
