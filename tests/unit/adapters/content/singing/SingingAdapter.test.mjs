// tests/unit/adapters/content/singing/SingingAdapter.test.mjs
import { describe, test, expect, beforeEach } from '@jest/globals';
import { SingingAdapter } from '#adapters/content/singing/SingingAdapter.mjs';

describe('SingingAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SingingAdapter({
      dataPath: '/mock/data/content/singing',
      mediaPath: '/mock/media/singing'
    });
  });

  describe('source and prefixes', () => {
    test('source returns "singing"', () => {
      expect(adapter.source).toBe('singing');
    });

    test('prefixes returns singing prefix', () => {
      expect(adapter.prefixes).toEqual([{ prefix: 'singing' }]);
    });

    test('canResolve returns true for singing: IDs', () => {
      expect(adapter.canResolve('singing:hymn/123')).toBe(true);
      expect(adapter.canResolve('singing:primary/1')).toBe(true);
    });

    test('canResolve returns false for other IDs', () => {
      expect(adapter.canResolve('reading:scripture/bom')).toBe(false);
      expect(adapter.canResolve('plex:12345')).toBe(false);
    });
  });
});
