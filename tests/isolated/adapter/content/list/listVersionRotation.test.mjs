import { describe, it, expect, beforeAll } from 'vitest';

describe('version rotation helpers', () => {
  let ScriptureResolver;

  beforeAll(async () => {
    const mod = await import('#adapters/content/readalong/resolvers/scripture.mjs');
    ScriptureResolver = mod.ScriptureResolver;
  });

  describe('getVolumeFromVerseId', () => {
    it('maps Genesis 1 (verse 1) to ot', () => {
      expect(ScriptureResolver.getVolumeFromVerseId(1)).toBe('ot');
    });

    it('maps Malachi (verse 23091) to ot', () => {
      expect(ScriptureResolver.getVolumeFromVerseId(23091)).toBe('ot');
    });

    it('maps Moses 1 (verse 41361) to pgp', () => {
      expect(ScriptureResolver.getVolumeFromVerseId(41361)).toBe('pgp');
    });

    it('returns null for out-of-range IDs', () => {
      expect(ScriptureResolver.getVolumeFromVerseId(99999)).toBeNull();
    });
  });

  describe('selectVersion', () => {
    it('picks first version when nothing watched', () => {
      const result = ScriptureResolver.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        []
      );
      expect(result.version).toBe('esv-music');
      expect(result.watchState).toBe('unwatched');
    });

    it('picks second version when first is watched', () => {
      const result = ScriptureResolver.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music']
      );
      expect(result.version).toBe('kjv-maxmclean');
      expect(result.watchState).toBe('partial');
    });

    it('returns complete when all versions watched', () => {
      const result = ScriptureResolver.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music', 'kjv-maxmclean']
      );
      expect(result.version).toBe('esv-music');
      expect(result.watchState).toBe('complete');
    });

    it('returns unwatched with null version when no prefs', () => {
      const result = ScriptureResolver.selectVersion([], []);
      expect(result.version).toBeNull();
      expect(result.watchState).toBe('unwatched');
    });
  });

  describe('buildVersionedStorageKey', () => {
    it('constructs readalong:scripture/{vol}/{version}/{id} key', () => {
      const key = ScriptureResolver.buildVersionedStorageKey('1', 'ot', 'esv-music');
      expect(key).toBe('readalong:scripture/ot/esv-music/1');
    });

    it('constructs pgp key', () => {
      const key = ScriptureResolver.buildVersionedStorageKey('41361', 'pgp', 'rex');
      expect(key).toBe('readalong:scripture/pgp/rex/41361');
    });
  });
});
