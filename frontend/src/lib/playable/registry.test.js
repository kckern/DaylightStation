import { describe, it, expect } from 'vitest';
import { getRenderer, isMediaFormat, getRegisteredFormats } from './registry.js';

describe('playable format registry', () => {
  describe('getRenderer', () => {
    it('should return a component for registered content formats', () => {
      const renderer = getRenderer('singalong');
      expect(renderer).toBeTruthy();
    });

    it('should return null for unregistered formats', () => {
      expect(getRenderer('nonexistent')).toBe(null);
    });

    it('should return null for media formats (handled separately)', () => {
      expect(getRenderer('video')).toBe(null);
      expect(getRenderer('audio')).toBe(null);
    });

    it('should return distinct components for each format', () => {
      const singalong = getRenderer('singalong');
      const readalong = getRenderer('readalong');
      expect(singalong).not.toBe(readalong);
    });
  });

  describe('isMediaFormat', () => {
    it('should return true for video', () => {
      expect(isMediaFormat('video')).toBe(true);
    });

    it('should return true for dash_video', () => {
      expect(isMediaFormat('dash_video')).toBe(true);
    });

    it('should return true for audio', () => {
      expect(isMediaFormat('audio')).toBe(true);
    });

    it('should return false for content formats', () => {
      expect(isMediaFormat('singalong')).toBe(false);
      expect(isMediaFormat('readalong')).toBe(false);
      expect(isMediaFormat('app')).toBe(false);
    });

    it('should return false for unknown formats', () => {
      expect(isMediaFormat('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredFormats', () => {
    it('should return all registered format names', () => {
      const formats = getRegisteredFormats();
      expect(formats).toContain('singalong');
      expect(formats).toContain('readalong');
      expect(formats).toContain('app');
      expect(formats).toContain('readable_paged');
      expect(formats).toContain('readable_flow');
      expect(formats.length).toBe(5);
    });
  });
});
