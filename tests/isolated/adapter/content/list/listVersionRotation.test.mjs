import { describe, it, expect, beforeAll } from 'vitest';

describe('version rotation helpers', () => {
  let helpers;

  beforeAll(async () => {
    helpers = await import('#adapters/content/list/listVersionHelpers.mjs');
  });

  describe('getVolumeFromVerseId', () => {
    it('maps Genesis 1 (verse 1) to ot', () => {
      expect(helpers.getVolumeFromVerseId(1)).toBe('ot');
    });

    it('maps Malachi (verse 23091) to ot', () => {
      expect(helpers.getVolumeFromVerseId(23091)).toBe('ot');
    });

    it('maps Moses 1 (verse 41995) to pgp', () => {
      expect(helpers.getVolumeFromVerseId(41995)).toBe('pgp');
    });

    it('returns null for out-of-range IDs', () => {
      expect(helpers.getVolumeFromVerseId(99999)).toBeNull();
    });
  });

  describe('selectVersion', () => {
    it('picks first version when nothing watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        []
      );
      expect(result.version).toBe('esv-music');
      expect(result.watchState).toBe('unwatched');
    });

    it('picks second version when first is watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music']
      );
      expect(result.version).toBe('kjv-maxmclean');
      expect(result.watchState).toBe('partial');
    });

    it('returns complete when all versions watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music', 'kjv-maxmclean']
      );
      expect(result.version).toBe('esv-music');
      expect(result.watchState).toBe('complete');
    });

    it('returns unwatched with null version when no prefs', () => {
      const result = helpers.selectVersion([], []);
      expect(result.version).toBeNull();
      expect(result.watchState).toBe('unwatched');
    });
  });

  describe('buildVersionedStorageKey', () => {
    it('constructs readalong:scripture/{vol}/{version}/{id} key', () => {
      const key = helpers.buildVersionedStorageKey('1', 'ot', 'esv-music');
      expect(key).toBe('readalong:scripture/ot/esv-music/1');
    });

    it('constructs pgp key', () => {
      const key = helpers.buildVersionedStorageKey('41361', 'pgp', 'rex');
      expect(key).toBe('readalong:scripture/pgp/rex/41361');
    });
  });
});
