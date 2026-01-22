// tests/unit/api/middleware/legacyLocalContentShim.test.mjs
import {
  translateLegacyScripturePath,
  translateLegacyTalkPath,
  translateLegacyHymnPath,
  translateLegacyPrimaryPath,
  translateLegacyPoetryPath,
  parseLegacyModifiers
} from '@backend/src/4_api/middleware/legacyLocalContentShim.mjs';

describe('Legacy LocalContent Shim', () => {
  describe('translateLegacyScripturePath', () => {
    it('translates simple scripture path', () => {
      const result = translateLegacyScripturePath('cfm');
      expect(result).toBe('scripture/cfm');
    });

    it('translates scripture path with subdirectory', () => {
      const result = translateLegacyScripturePath('cfm/1nephi1');
      expect(result).toBe('scripture/cfm/1nephi1');
    });

    it('handles version modifier', () => {
      const result = translateLegacyScripturePath('bom', { version: 'redc' });
      expect(result).toBe('scripture/bom?version=redc');
    });
  });

  describe('translateLegacyTalkPath', () => {
    it('translates talk path', () => {
      const result = translateLegacyTalkPath('ldsgc202510/11');
      expect(result).toBe('talk/ldsgc202510/11');
    });

    it('translates simple talk path', () => {
      const result = translateLegacyTalkPath('general/test-talk');
      expect(result).toBe('talk/general/test-talk');
    });
  });

  describe('translateLegacyHymnPath', () => {
    it('translates hymn number', () => {
      const result = translateLegacyHymnPath('113');
      expect(result).toBe('hymn/113');
    });

    it('translates string hymn number', () => {
      const result = translateLegacyHymnPath('42');
      expect(result).toBe('hymn/42');
    });
  });

  describe('translateLegacyPrimaryPath', () => {
    it('translates primary song number', () => {
      const result = translateLegacyPrimaryPath('42');
      expect(result).toBe('primary/42');
    });
  });

  describe('translateLegacyPoetryPath', () => {
    it('translates poetry path', () => {
      const result = translateLegacyPoetryPath('remedy/01');
      expect(result).toBe('poem/remedy/01');
    });

    it('translates simple poetry path', () => {
      const result = translateLegacyPoetryPath('test');
      expect(result).toBe('poem/test');
    });
  });

  describe('parseLegacyModifiers', () => {
    it('parses simple path without modifiers', () => {
      const result = parseLegacyModifiers('bom');
      expect(result).toEqual({ path: 'bom', modifiers: {} });
    });

    it('parses path with version modifier', () => {
      const result = parseLegacyModifiers('bom; version redc');
      expect(result).toEqual({ path: 'bom', modifiers: { version: 'redc' } });
    });

    it('handles extra whitespace', () => {
      const result = parseLegacyModifiers('bom  ;  version  redc  ');
      expect(result).toEqual({ path: 'bom', modifiers: { version: 'redc' } });
    });

    it('ignores unknown modifiers', () => {
      const result = parseLegacyModifiers('bom; unknown value');
      expect(result).toEqual({ path: 'bom', modifiers: {} });
    });
  });
});
