import { describe, it, expect } from 'vitest';
import { ScriptureResolver } from '#adapters/content/readalong/resolvers/scripture.mjs';

// Regression guard for the numeric-verse-id fast path.
//
// tryResolveReference() used to call scripture-guide's lookupReference() for EVERY
// segment before the cheap numeric check. lookupReference returns an empty match for
// a bare numeric verse id (verified against the real package) yet costs ~150ms, and
// was invoked once per child × 2 per getItem during a watchlist resolve — dominating
// a ~4.5s queue resolve. The fix tries the numeric branch FIRST so numeric verse ids
// never hit lookupReference. These tests pin that numeric ids resolve to the SAME
// {volume, verseId} as before (the reorder must not change resolution), and that
// non-numeric references still resolve.
describe('ScriptureResolver — numeric verse-id resolution', () => {
  it('maps numeric verse ids to the correct volume (no /-path)', () => {
    // VOLUME_RANGES: ot 1–23145, nt 23146–31102, bom 31103–37706, dc 37707–41360, pgp 41361–42663
    const cases = [
      ['1', 'ot'],
      ['23146', 'nt'],
      ['31103', 'bom'],
      ['37707', 'dc'],
      ['41361', 'pgp'],
    ];
    for (const [id, volume] of cases) {
      const r = ScriptureResolver.resolve(id, '/fake/scripture', {});
      expect(r, `resolve(${id})`).toBeTruthy();
      expect(r.volume, `volume for ${id}`).toBe(volume);
      expect(r.verseId, `verseId for ${id}`).toBe(id);
      expect(r.textPath, `textPath for ${id}`).toBe(`${volume}/default/${id}`);
    }
  });

  it('still resolves a non-numeric reference via lookupReference', () => {
    // "alma-32" is a Book of Mormon chapter — resolved through scripture-guide.
    const r = ScriptureResolver.resolve('alma-32', '/fake/scripture', {});
    expect(r).toBeTruthy();
    expect(r.volume).toBe('bom');
    expect(parseInt(r.verseId, 10)).toBeGreaterThan(0);
  });

  it('returns null for an out-of-range / unrecognized segment', () => {
    expect(ScriptureResolver.resolve('999999999', '/fake/scripture', {})).toBeNull();
    expect(ScriptureResolver.resolve('not-a-reference-xyz', '/fake/scripture', {})).toBeNull();
  });
});
