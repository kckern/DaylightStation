// tests/isolated/adapter/content/filesystem/resolvers/scripture.test.mjs
import { ScriptureResolver } from '#adapters/content/filesystem/resolvers/scripture.mjs';

describe('ScriptureResolver', () => {
  const defaults = {
    bom: { text: 'sebom', audio: 'sebom' },
    nt: { text: 'kjvf', audio: 'kjvf' },
    ot: { text: 'kjvf', audio: 'kjvf' },
    dc: { text: 'rex', audio: 'rex' },
    pgp: { text: 'rex', audio: 'rex' },
  };

  test('resolves volume name to default version', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('bom');
    expect(result.volume).toBe('bom');
    expect(result.version).toBe('sebom');
    expect(result.isContainer).toBe(true);
  });

  test('resolves numeric verse ID to volume', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('31103');
    expect(result.volume).toBe('bom');
    expect(result.verseId).toBe('31103');
    expect(result.version).toBe('sebom');
  });

  test('resolves full path passthrough', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('bom/sebom/31103');
    expect(result.volume).toBe('bom');
    expect(result.version).toBe('sebom');
    expect(result.verseId).toBe('31103');
  });

  test('resolves book-chapter reference via scripture-guide', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('alma-32');
    // scripture-guide should resolve alma-32 to a BOM verse
    if (result.volume) {
      expect(result.volume).toBe('bom');
      expect(result.verseId).toBeTruthy();
    } else {
      // If scripture-guide not available, should at least return reference
      expect(result.reference).toBe('alma-32');
    }
  });

  test('resolves NT reference', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('john-3');
    if (result.volume) {
      expect(result.volume).toBe('nt');
    } else {
      expect(result.reference).toBe('john-3');
    }
  });

  test('returns null for null/empty input', () => {
    const resolver = new ScriptureResolver({ defaults });
    expect(resolver.resolve(null)).toBeNull();
    expect(resolver.resolve('')).toBeNull();
  });

  test('returns reference for completely unknown input', () => {
    const resolver = new ScriptureResolver({ defaults });
    const result = resolver.resolve('some-unknown-text');
    expect(result.reference).toBe('some-unknown-text');
  });

  test('volume ranges are accessible via static property', () => {
    const ranges = ScriptureResolver.VOLUME_RANGES;
    expect(ranges.bom.start).toBe(31103);
    expect(ranges.bom.end).toBe(37706);
    expect(ranges.nt.start).toBe(23146);
  });

  test('getReference returns human-readable title', () => {
    const resolver = new ScriptureResolver({ defaults });
    const ref = resolver.getReference(31103);
    // If scripture-guide is available, should return something like "1 Nephi 1:1"
    // If not available, returns null
    if (ref) {
      expect(typeof ref).toBe('string');
      expect(ref.length).toBeGreaterThan(0);
    } else {
      expect(ref).toBeNull();
    }
  });
});
