// tests/unit/adapters/content/reading/ReadingAdapter.test.mjs
// Basic unit tests that don't require mocking
import { describe, test, expect, beforeEach } from '@jest/globals';
import { ReadingAdapter } from '#adapters/content/reading/ReadingAdapter.mjs';

describe('ReadingAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ReadingAdapter({
      dataPath: '/mock/data/content/reading',
      mediaPath: '/mock/media/reading'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "reading"', () => {
      expect(adapter.source).toBe('reading');
    });

    test('prefixes returns reading prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'reading' }]);
    });

    test('canResolve returns true for reading: IDs', () => {
      expect(adapter.canResolve('reading:scripture/bom')).toBe(true);
      expect(adapter.canResolve('reading:talks/ldsgc')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singing:hymn/1')).toBe(false);
    });
  });

  describe('storage path', () => {
    test('getStoragePath returns "reading"', () => {
      expect(adapter.getStoragePath()).toBe('reading');
    });
  });

  describe('default style', () => {
    test('_getDefaultStyle returns reading-appropriate defaults', () => {
      const style = adapter._getDefaultStyle();
      expect(style.fontFamily).toBe('sans-serif');
      expect(style.fontSize).toBe('1.2rem');
      expect(style.textAlign).toBe('left');
    });
  });
});
