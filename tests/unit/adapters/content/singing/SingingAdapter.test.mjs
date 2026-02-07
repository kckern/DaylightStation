// tests/unit/adapters/content/singalong/SingalongAdapter.test.mjs
// Basic unit tests that don't require mocking
import { describe, test, expect, beforeEach } from '@jest/globals';
import { SingalongAdapter } from '#adapters/content/singalong/SingalongAdapter.mjs';

describe('SingalongAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SingalongAdapter({
      dataPath: '/mock/data/content/singalong',
      mediaPath: '/mock/media/singalong'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "singalong"', () => {
      expect(adapter.source).toBe('singalong');
    });

    test('prefixes returns singalong prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'singalong' }]);
    });

    test('canResolve returns true for singalong: IDs', () => {
      expect(adapter.canResolve('singalong:hymn/123')).toBe(true);
      expect(adapter.canResolve('singalong:primary/1')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('readalong:scripture/bom')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });
});
