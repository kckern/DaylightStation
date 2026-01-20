// tests/unit/api/middleware/legacyCompat.test.mjs
import { translateMediaLogRequest, translateMediaLogResponse } from '../../../../backend/src/4_api/middleware/legacyCompat.mjs';

describe('legacyCompat', () => {
  describe('translateMediaLogRequest', () => {
    it('translates plex log to new format', () => {
      const legacyBody = {
        type: 'plex',
        library: '12345',
        playhead: 600,
        mediaDuration: 1200
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('plex');
      expect(result.itemId).toBe('plex:12345');
      expect(result.playhead).toBe(600);
      expect(result.duration).toBe(1200);
    });

    it('translates talk log to new format', () => {
      const legacyBody = {
        type: 'talk',
        library: 'general/talk1',
        playhead: 300,
        mediaDuration: 600
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('local-content');
      expect(result.itemId).toBe('talk:general/talk1');
    });

    it('translates scripture log to new format', () => {
      const legacyBody = {
        type: 'scripture',
        library: 'bom/1nephi/1',
        playhead: 100,
        mediaDuration: 200
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('local-content');
      expect(result.itemId).toBe('scripture:bom/1nephi/1');
    });

    it('defaults to filesystem for unknown types', () => {
      const legacyBody = {
        type: 'unknown',
        library: 'some/path',
        playhead: 50,
        mediaDuration: 100
      };

      const result = translateMediaLogRequest(legacyBody);

      expect(result.source).toBe('filesystem');
      expect(result.itemId).toBe('filesystem:some/path');
    });
  });

  describe('translateMediaLogResponse', () => {
    it('translates new response to legacy format', () => {
      const newResponse = {
        itemId: 'plex:12345',
        playhead: 600,
        duration: 1200,
        percent: 50
      };

      const result = translateMediaLogResponse(newResponse, 'plex');

      expect(result.type).toBe('plex');
      expect(result.library).toBe('12345');
      expect(result.playhead).toBe(600);
      expect(result.mediaDuration).toBe(1200);
      expect(result.watchProgress).toBe(50);
    });

    it('handles compound IDs with colons', () => {
      const newResponse = {
        itemId: 'talk:general/talk1',
        playhead: 300,
        duration: 600,
        percent: 50
      };

      const result = translateMediaLogResponse(newResponse, 'talk');

      expect(result.library).toBe('general/talk1');
    });
  });
});
