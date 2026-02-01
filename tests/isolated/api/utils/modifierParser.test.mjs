import { describe, it, expect } from 'vitest';
import { parseModifiers } from '../../../../backend/src/4_api/v1/utils/modifierParser.mjs';

describe('parseModifiers', () => {
  describe('basic parsing', () => {
    it('returns empty modifiers and original path for path with no modifiers', () => {
      const result = parseModifiers('folder/subfolder');
      expect(result.modifiers).toEqual({});
      expect(result.localId).toBe('folder/subfolder');
    });

    it('returns empty modifiers and empty localId for empty string', () => {
      const result = parseModifiers('');
      expect(result.modifiers).toEqual({});
      expect(result.localId).toBe('');
    });

    it('returns empty modifiers and empty localId for undefined input', () => {
      const result = parseModifiers(undefined);
      expect(result.modifiers).toEqual({});
      expect(result.localId).toBe('');
    });
  });

  describe('slash-separated modifiers', () => {
    it('parses single modifier at end of path', () => {
      const result = parseModifiers('folder/shuffle');
      expect(result.modifiers).toEqual({ shuffle: true });
      expect(result.localId).toBe('folder');
    });

    it('parses playable modifier', () => {
      const result = parseModifiers('path/to/item/playable');
      expect(result.modifiers).toEqual({ playable: true });
      expect(result.localId).toBe('path/to/item');
    });

    it('parses recent_on_top modifier', () => {
      const result = parseModifiers('folder/recent_on_top');
      expect(result.modifiers).toEqual({ recent_on_top: true });
      expect(result.localId).toBe('folder');
    });

    it('parses multiple slash-separated modifiers', () => {
      const result = parseModifiers('folder/shuffle/playable');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
      expect(result.localId).toBe('folder');
    });

    it('parses all three modifiers', () => {
      const result = parseModifiers('folder/shuffle/playable/recent_on_top');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true, recent_on_top: true });
      expect(result.localId).toBe('folder');
    });
  });

  describe('comma-separated modifiers', () => {
    it('parses comma-separated modifiers', () => {
      const result = parseModifiers('folder/shuffle,playable');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
      expect(result.localId).toBe('folder');
    });

    it('parses all modifiers in comma format', () => {
      const result = parseModifiers('folder/shuffle,playable,recent_on_top');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true, recent_on_top: true });
      expect(result.localId).toBe('folder');
    });

    it('parses standalone comma-separated modifiers', () => {
      const result = parseModifiers('shuffle,playable');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
      expect(result.localId).toBe('');
    });
  });

  describe('edge cases', () => {
    it('ignores unknown modifiers (treats as path segment)', () => {
      const result = parseModifiers('folder/unknown/shuffle');
      expect(result.modifiers).toEqual({ shuffle: true });
      expect(result.localId).toBe('folder/unknown');
    });

    it('handles modifiers mixed in path', () => {
      const result = parseModifiers('shuffle/folder/playable');
      expect(result.modifiers).toEqual({ shuffle: true, playable: true });
      expect(result.localId).toBe('folder');
    });

    it('handles empty path segments (double slashes)', () => {
      const result = parseModifiers('folder//shuffle');
      expect(result.modifiers).toEqual({ shuffle: true });
      expect(result.localId).toBe('folder');
    });

    it('handles path with numeric segments', () => {
      const result = parseModifiers('plex/12345/shuffle');
      expect(result.modifiers).toEqual({ shuffle: true });
      expect(result.localId).toBe('plex/12345');
    });
  });
});
