import { describe, test, expect } from '@jest/globals';
import { parseAutoplayParams } from '#frontend/lib/parseAutoplayParams.js';

describe('parseAutoplayParams', () => {
  const ALL_ACTIONS = ['play', 'queue', 'playlist', 'random', 'display', 'read', 'open', 'app', 'launch', 'list'];
  const MEDIA_ACTIONS = ['play', 'queue'];

  describe('basic action parsing', () => {
    test('parses ?play=hymn:198', () => {
      const result = parseAutoplayParams('?play=hymn:198', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('parses ?queue=plex:67890', () => {
      const result = parseAutoplayParams('?queue=plex:67890', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.queue).toBeDefined();
      expect(result.queue.contentId).toBe('plex:67890');
    });

    test('returns null when no action params present', () => {
      const result = parseAutoplayParams('?volume=50', ALL_ACTIONS);
      expect(result).toBeNull();
    });

    test('returns null for empty search string', () => {
      const result = parseAutoplayParams('', ALL_ACTIONS);
      expect(result).toBeNull();
    });
  });

  describe('contentId normalization', () => {
    test('bare digits become plex: prefix', () => {
      const result = parseAutoplayParams('?play=12345', ALL_ACTIONS);
      expect(result.play.contentId).toBe('plex:12345');
    });

    test('compound IDs pass through unchanged', () => {
      const result = parseAutoplayParams('?play=hymn:198', ALL_ACTIONS);
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('case-insensitive source prefix', () => {
      const result = parseAutoplayParams('?play=PLEX:123', ALL_ACTIONS);
      expect(result.play.contentId).toBe('PLEX:123');
    });
  });

  describe('alias shorthand', () => {
    test('?hymn=198 becomes play hymn:198', () => {
      const result = parseAutoplayParams('?hymn=198', ALL_ACTIONS);
      expect(result).not.toBeNull();
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('?scripture=bom becomes play scripture:bom', () => {
      const result = parseAutoplayParams('?scripture=bom', ALL_ACTIONS);
      expect(result.play.contentId).toBe('scripture:bom');
    });

    test('?plex=12345 becomes play plex:12345', () => {
      const result = parseAutoplayParams('?plex=12345', ALL_ACTIONS);
      expect(result.play.contentId).toBe('plex:12345');
    });
  });

  describe('config modifiers', () => {
    test('extracts volume from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&volume=50', ALL_ACTIONS);
      expect(result.play.volume).toBe('50');
    });

    test('extracts shader from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&shader=focused', ALL_ACTIONS);
      expect(result.play.shader).toBe('focused');
    });

    test('extracts shuffle from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&shuffle=true', ALL_ACTIONS);
      expect(result.play.shuffle).toBe('true');
    });

    test('extracts playbackRate from URL params', () => {
      const result = parseAutoplayParams('?play=hymn:198&playbackRate=1.5', ALL_ACTIONS);
      expect(result.play.playbackRate).toBe('1.5');
    });
  });

  describe('supportedActions filtering', () => {
    test('ignores unsupported actions', () => {
      const result = parseAutoplayParams('?display=photo:1', MEDIA_ACTIONS);
      expect(result).not.toBeNull();
      if (result.display) {
        throw new Error('display action should not be recognized with MEDIA_ACTIONS');
      }
    });

    test('supports play action when in supportedActions', () => {
      const result = parseAutoplayParams('?play=hymn:198', MEDIA_ACTIONS);
      expect(result.play).toBeDefined();
      expect(result.play.contentId).toBe('hymn:198');
    });

    test('supports queue action when in supportedActions', () => {
      const result = parseAutoplayParams('?queue=plex:67890', MEDIA_ACTIONS);
      expect(result.queue).toBeDefined();
    });
  });

  describe('TVApp-specific actions', () => {
    test('parses ?display=photo:1 with ALL_ACTIONS', () => {
      const result = parseAutoplayParams('?display=photo:1', ALL_ACTIONS);
      expect(result.display).toBeDefined();
    });

    test('parses ?open=webcam with ALL_ACTIONS', () => {
      const result = parseAutoplayParams('?open=webcam', ALL_ACTIONS);
      expect(result.open).toBeDefined();
      expect(result.open.app).toBe('webcam');
    });

    test('parses ?app=webcam as alias for open', () => {
      const result = parseAutoplayParams('?app=webcam', ALL_ACTIONS);
      expect(result.open).toBeDefined();
      expect(result.open.app).toBe('webcam');
    });
  });

  describe('composite mode', () => {
    test('comma-separated play triggers compose', () => {
      const result = parseAutoplayParams('?play=plex:1,plex:2', ALL_ACTIONS);
      expect(result.compose).toBeDefined();
      expect(result.compose.sources).toEqual(['plex:1', 'plex:2']);
    });

    test('app: prefix triggers compose', () => {
      const result = parseAutoplayParams('?play=app:webcam', ALL_ACTIONS);
      expect(result.compose).toBeDefined();
    });
  });

  describe('edge cases', () => {
    test('first action key wins when multiple present', () => {
      const result = parseAutoplayParams('?play=hymn:1&queue=plex:2', ALL_ACTIONS);
      expect(result).not.toBeNull();
    });

    test('config-only params without action return null', () => {
      const result = parseAutoplayParams('?volume=50&shader=dark', ALL_ACTIONS);
      expect(result).toBeNull();
    });
  });
});
