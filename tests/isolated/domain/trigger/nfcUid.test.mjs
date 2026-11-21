// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canonicalizeNfcUid } from "../../../../__capabilities/device-dispatch/server/domain/nfcUid.mjs";

describe('canonicalizeNfcUid', () => {
  it('folds the two spellings of one physical card onto the same identity', () => {
    // The bug this exists for: the audiobook readers write separated lowercase,
    // the omr-relay's ST25R3916 reports packed uppercase. Same NTAG 215.
    const fromConfig = canonicalizeNfcUid('04_f0_00_00_00_00_05');
    const fromRelay = canonicalizeNfcUid('04F00000000005');
    expect(fromRelay).toBe(fromConfig);
    expect(fromConfig).toBe('04f00000000005');
  });

  it.each([
    ['underscores', '04_F0_00_00_00_00_05'],
    ['colons', '04:f0:00:00:00:00:05'],
    ['hyphens', '04-F0-00-00-00-00-05'],
    ['spaces', '04 f0 00 00 00 00 05'],
    ['already canonical', '04f00000000005'],
    ['surrounding whitespace', '  04F00000000005\n'],
  ])('accepts %s', (_label, input) => {
    expect(canonicalizeNfcUid(input)).toBe('04f00000000005');
  });

  it('keeps short legacy registry keys usable', () => {
    // `1001` and `83_8e_68_06` are real entries in the live registry. A
    // canonicalizer that validated length or hex would silently drop them.
    expect(canonicalizeNfcUid('1001')).toBe('1001');
    expect(canonicalizeNfcUid('83_8e_68_06')).toBe('838e6806');
  });

  it.each([[null], [undefined], ['']])('returns empty for %s rather than throwing', (input) => {
    expect(canonicalizeNfcUid(input)).toBe('');
  });

  it('does not merge two genuinely different tags', () => {
    expect(canonicalizeNfcUid('04_f0_00_00_00_00_05'))
      .not.toBe(canonicalizeNfcUid('04_f0_00_00_00_00_0a'));
  });

  // Found the hard way while migrating the live registry: stripping separators
  // can turn an unambiguous string into valid YAML scientific notation. Both of
  // these canonicalize to something Number() reads as Infinity, so an unquoted
  // dump collapses two distinct audiobook tags into one duplicated mapping key
  // and the file stops parsing at all.
  it('produces uids that stay DISTINCT even when they look like scientific notation', () => {
    const a = canonicalizeNfcUid('83_8e_68_06');
    const b = canonicalizeNfcUid('04_10_e5_00_00_00_02');
    expect(a).toBe('838e6806');
    expect(b).toBe('0410e500000002');
    expect(a).not.toBe(b);
    // The trap itself: as numbers they are indistinguishable.
    expect(Number(a)).toBe(Infinity);
    expect(Number(b)).toBe(Infinity);
  });

  it('survives a YAML round-trip as two separate keys', async () => {
    // The registry is persisted as YAML, so "distinct in JS" is not enough —
    // the writer must quote these or the two tags become one on reload.
    const { default: yaml } = await import('js-yaml');
    const registry = {
      [canonicalizeNfcUid('83_8e_68_06')]: { plex: 620707 },
      [canonicalizeNfcUid('04_10_e5_00_00_00_02')]: { plex: 456598 },
    };
    const reloaded = yaml.load(yaml.dump(registry));
    expect(Object.keys(reloaded)).toHaveLength(2);
    expect(reloaded['838e6806'].plex).toBe(620707);
    expect(reloaded['0410e500000002'].plex).toBe(456598);
  });
});
