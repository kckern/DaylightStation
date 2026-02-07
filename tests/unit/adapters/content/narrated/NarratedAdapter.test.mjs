// tests/unit/adapters/content/readalong/ReadalongAdapter.test.mjs
// Basic unit tests that don't require mocking
import { describe, test, expect, beforeEach } from '@jest/globals';
import { ReadalongAdapter } from '#adapters/content/readalong/ReadalongAdapter.mjs';

describe('ReadalongAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ReadalongAdapter({
      dataPath: '/mock/data/content/readalong',
      mediaPath: '/mock/media/readalong'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "readalong"', () => {
      expect(adapter.source).toBe('readalong');
    });

    test('prefixes returns readalong prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'readalong' }]);
    });

    test('canResolve returns true for readalong: IDs', () => {
      expect(adapter.canResolve('readalong:scripture/bom')).toBe(true);
      expect(adapter.canResolve('readalong:talks/ldsgc')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('singalong:hymn/1')).toBe(false);
    });
  });

  describe('storage path', () => {
    test('getStoragePath returns "readalong" for talks', () => {
      expect(adapter.getStoragePath('talks/ldsgc')).toBe('readalong');
    });
  });

  describe('default style', () => {
    test('_getDefaultStyle returns readalong defaults', () => {
      const style = adapter._getDefaultStyle();
      expect(style.fontFamily).toBe('sans-serif');
      expect(style.fontSize).toBe('1.2rem');
      expect(style.textAlign).toBe('left');
    });
  });
});
