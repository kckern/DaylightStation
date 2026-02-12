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

    it('should return null for unknown function', () => {
      expect(translateAction('unknown', 'params')).toBeNull();
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
