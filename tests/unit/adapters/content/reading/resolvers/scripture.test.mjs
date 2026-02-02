// tests/unit/adapters/content/reading/resolvers/scripture.test.mjs
//
// Unit tests for ScriptureResolver
// Tests the pure logic of path resolution without external dependencies
//
import { describe, test, expect } from '@jest/globals';

/**
 * Volume to verse_id range mapping (same as in the resolver)
 */
const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

/**
 * Get volume name from verse_id (pure function to test)
 */
function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) {
      return volume;
    }
  }
  return null;
}

/**
 * Simplified resolve function that uses provided dependencies
 * This mirrors the ScriptureResolver.resolve logic but with injectable deps
 */
function createResolver({ lookupReference, getVersion }) {
  return {
    resolve(input, dataPath) {
      // Full path passthrough
      if (input.includes('/') && input.split('/').length === 3) {
        return input;
      }

      // Try as reference string
      try {
        const ref = lookupReference(input);
        const verseId = ref?.verse_ids?.[0];
        if (verseId) {
          const volume = getVolumeFromVerseId(verseId);
          const version = getVersion(dataPath, volume);
          return `${volume}/${version}/${verseId}`;
        }
      } catch {
        // Continue
      }

      // Try as numeric verse_id
      const asNumber = parseInt(input, 10);
      if (!isNaN(asNumber) && asNumber > 0) {
        const volume = getVolumeFromVerseId(asNumber);
        if (volume) {
          const version = getVersion(dataPath, volume);
          return `${volume}/${version}/${asNumber}`;
        }
      }

      // Try as volume name
      if (VOLUME_RANGES[input]) {
        const version = getVersion(dataPath, input);
        return `${input}/${version}/${VOLUME_RANGES[input].start}`;
      }

      return null;
    }
  };
}

describe('ScriptureResolver', () => {
  describe('getVolumeFromVerseId', () => {
    test('returns ot for verse 1', () => {
      expect(getVolumeFromVerseId(1)).toBe('ot');
    });

    test('returns ot for last OT verse', () => {
      expect(getVolumeFromVerseId(23145)).toBe('ot');
    });

    test('returns nt for first NT verse', () => {
      expect(getVolumeFromVerseId(23146)).toBe('nt');
    });

    test('returns bom for BOM verse', () => {
      expect(getVolumeFromVerseId(31103)).toBe('bom');
      expect(getVolumeFromVerseId(34541)).toBe('bom'); // Alma 32
    });

    test('returns dc for D&C verse', () => {
      expect(getVolumeFromVerseId(37707)).toBe('dc');
    });

    test('returns pgp for PGP verse', () => {
      expect(getVolumeFromVerseId(42000)).toBe('pgp');
    });

    test('returns null for invalid verse', () => {
      expect(getVolumeFromVerseId(99999)).toBeNull();
      expect(getVolumeFromVerseId(-1)).toBeNull();
    });
  });

  describe('resolve', () => {
    const mockLookup = (input) => {
      const refs = {
        'alma-32': { verse_ids: [34541] },
        '1-nephi-1': { verse_ids: [31103] },
        'genesis-1': { verse_ids: [1] }
      };
      if (refs[input]) return refs[input];
      throw new Error('Invalid reference');
    };

    const mockGetVersion = () => 'sebom';

    const resolver = createResolver({
      lookupReference: mockLookup,
      getVersion: mockGetVersion
    });

    test('passes through full path unchanged', () => {
      const result = resolver.resolve('bom/sebom/31103', '/data');
      expect(result).toBe('bom/sebom/31103');
    });

    test('resolves reference string to path', () => {
      const result = resolver.resolve('alma-32', '/data');
      expect(result).toBe('bom/sebom/34541');
    });

    test('resolves numeric verse_id to path', () => {
      const result = resolver.resolve('37707', '/data');
      expect(result).toBe('dc/sebom/37707');
    });

    test('resolves volume name to first verse', () => {
      const result = resolver.resolve('bom', '/data');
      expect(result).toBe('bom/sebom/31103');
    });

    test('returns null for invalid input', () => {
      const result = resolver.resolve('invalid-ref', '/data');
      expect(result).toBeNull();
    });

    test('uses getVersion to find default version', () => {
      const customResolver = createResolver({
        lookupReference: () => { throw new Error('not used'); },
        getVersion: () => 'kjv'
      });
      const result = customResolver.resolve('ot', '/data');
      expect(result).toBe('ot/kjv/1');
    });

    test('handles OT volume input', () => {
      const result = resolver.resolve('ot', '/data');
      expect(result).toBe('ot/sebom/1');
    });

    test('handles NT volume input', () => {
      const result = resolver.resolve('nt', '/data');
      expect(result).toBe('nt/sebom/23146');
    });

    test('handles DC volume input', () => {
      const result = resolver.resolve('dc', '/data');
      expect(result).toBe('dc/sebom/37707');
    });

    test('handles PGP volume input', () => {
      const result = resolver.resolve('pgp', '/data');
      expect(result).toBe('pgp/sebom/41995');
    });
  });

  describe('VOLUME_RANGES', () => {
    test('ranges are contiguous', () => {
      const ranges = Object.values(VOLUME_RANGES);
      for (let i = 1; i < ranges.length; i++) {
        expect(ranges[i].start).toBe(ranges[i - 1].end + 1);
      }
    });

    test('OT starts at 1', () => {
      expect(VOLUME_RANGES.ot.start).toBe(1);
    });

    test('PGP ends at 42663', () => {
      expect(VOLUME_RANGES.pgp.end).toBe(42663);
    });
  });
});
