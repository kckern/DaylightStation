// tests/unit/adapters/content/narrated/NarratedAdapter.test.mjs
// Basic unit tests that don't require mocking
import { describe, test, expect, beforeEach } from '@jest/globals';
import { NarratedAdapter } from '#adapters/content/narrated/NarratedAdapter.mjs';

describe('NarratedAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new NarratedAdapter({
      dataPath: '/mock/data/content/narrated',
      mediaPath: '/mock/media/narrated'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "narrated"', () => {
      expect(adapter.source).toBe('narrated');
    });

    test('prefixes returns narrated prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'narrated' }]);
    });

    test('canResolve returns true for narrated: IDs', () => {
      expect(adapter.canResolve('narrated:scripture/bom')).toBe(true);
      expect(adapter.canResolve('narrated:talks/ldsgc')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singing:hymn/1')).toBe(false);
    });
  });

  describe('storage path', () => {
    test('getStoragePath returns "narrated"', () => {
      expect(adapter.getStoragePath()).toBe('narrated');
    });
  });

  describe('default style', () => {
    test('_getDefaultStyle returns narrated-appropriate defaults', () => {
      const style = adapter._getDefaultStyle();
      expect(style.fontFamily).toBe('sans-serif');
      expect(style.fontSize).toBe('1.2rem');
      expect(style.textAlign).toBe('left');
    });
  });
});
