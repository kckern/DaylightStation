// frontend/src/screen-framework/input/actionMap.test.js
import { describe, it, expect } from 'vitest';
import { translateAction, translateSecondary, ACTION_MAP } from './actionMap.js';

describe('actionMap', () => {
  describe('translateAction', () => {
    it('should translate menu to menu:open', () => {
      expect(translateAction('menu', 'music')).toEqual({
        action: 'menu:open', payload: { menuId: 'music' }
      });
    });

    it('should translate play to media:play', () => {
      expect(translateAction('play', 'scripture:1-ne-1')).toEqual({
        action: 'media:play', payload: { contentId: 'scripture:1-ne-1' }
      });
    });

    it('should translate queue to media:queue', () => {
      expect(translateAction('queue', 'hymn:2')).toEqual({
        action: 'media:queue', payload: { contentId: 'hymn:2' }
      });
    });

    it('should translate playback to media:playback', () => {
      expect(translateAction('playback', 'pause')).toEqual({
        action: 'media:playback', payload: { command: 'pause' }
      });
    });

    it('should translate escape to escape', () => {
      expect(translateAction('escape')).toEqual({
        action: 'escape', payload: {}
      });
    });

    it('should translate volume to display:volume', () => {
      expect(translateAction('volume', '+1')).toEqual({
        action: 'display:volume', payload: { command: '+1' }
      });
    });

    it('should translate shader to display:shader', () => {
      expect(translateAction('shader')).toEqual({
        action: 'display:shader', payload: {}
      });
    });

    it('should translate sleep to display:sleep', () => {
      expect(translateAction('sleep')).toEqual({
        action: 'display:sleep', payload: {}
      });
    });

    it('should translate rate to media:rate', () => {
      expect(translateAction('rate')).toEqual({
        action: 'media:rate', payload: {}
      });
    });

    it('should translate media:seek-abs with payload', () => {
      expect(translateAction('media:seek-abs', { value: 42, commandId: 'c1' })).toEqual({
        action: 'media:seek-abs', payload: { value: 42, commandId: 'c1' }
      });
    });

    it('should translate media:seek-rel with payload', () => {
      expect(translateAction('media:seek-rel', { value: -10, commandId: 'c2' })).toEqual({
        action: 'media:seek-rel', payload: { value: -10, commandId: 'c2' }
      });
    });

    it('should translate media:queue-op with payload', () => {
      expect(translateAction('media:queue-op', { op: 'clear', commandId: 'c3' })).toEqual({
        action: 'media:queue-op', payload: { op: 'clear', commandId: 'c3' }
      });
    });

    it('should translate media:config-set with payload', () => {
      expect(translateAction('media:config-set', { setting: 'shuffle', value: true, commandId: 'c4' })).toEqual({
        action: 'media:config-set', payload: { setting: 'shuffle', value: true, commandId: 'c4' }
      });
    });

    it('should translate media:adopt-snapshot with payload', () => {
      const snapshot = { sessionId: 's1', state: 'idle' };
      expect(translateAction('media:adopt-snapshot', { snapshot, autoplay: true, commandId: 'c5' })).toEqual({
        action: 'media:adopt-snapshot', payload: { snapshot, autoplay: true, commandId: 'c5' }
      });
    });

    it('should default payload to {} for structured-envelope actions with no params', () => {
      expect(translateAction('media:seek-abs')).toEqual({
        action: 'media:seek-abs', payload: {}
      });
    });

    it('should return null for unknown function', () => {
      expect(translateAction('unknown', 'params')).toBeNull();
    });
  });

  describe('ACTION_MAP registration', () => {
    it('registers the five structured-envelope media actions', () => {
      expect(ACTION_MAP).toHaveProperty('media:seek-abs');
      expect(ACTION_MAP).toHaveProperty('media:seek-rel');
      expect(ACTION_MAP).toHaveProperty('media:queue-op');
      expect(ACTION_MAP).toHaveProperty('media:config-set');
      expect(ACTION_MAP).toHaveProperty('media:adopt-snapshot');
    });

    it('preserves the existing keyboard-bound actions', () => {
      for (const name of ['menu', 'play', 'queue', 'playback', 'escape', 'volume', 'shader', 'sleep', 'rate']) {
        expect(ACTION_MAP).toHaveProperty(name);
      }
    });
  });

  describe('translateSecondary', () => {
    it('should parse and translate secondary action string', () => {
      expect(translateSecondary('menu:video')).toEqual({
        action: 'menu:open', payload: { menuId: 'video' }
      });
    });

    it('should return null for null input', () => {
      expect(translateSecondary(null)).toBeNull();
    });

    it('should return null for string without colon', () => {
      expect(translateSecondary('invalid')).toBeNull();
    });

    it('should return null for unknown function in secondary', () => {
      expect(translateSecondary('unknown:params')).toBeNull();
    });

    it('should handle whitespace around colon', () => {
      expect(translateSecondary(' play : scripture:1-ne-1 ')).toEqual({
        action: 'media:play', payload: { contentId: 'scripture:1-ne-1' }
      });
    });
  });
});
