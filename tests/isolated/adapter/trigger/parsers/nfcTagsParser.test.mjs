import { describe, it, expect } from 'vitest';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';

const KNOWN_READERS = new Set(['livingroom', 'bedroom', 'kitchen']);

describe('parseNfcTags', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseNfcTags(null, KNOWN_READERS)).toEqual({});
    expect(parseNfcTags(undefined, KNOWN_READERS)).toEqual({});
    expect(parseNfcTags({}, KNOWN_READERS)).toEqual({});
  });

  it('parses a minimal tag with content shorthand', () => {
    const result = parseNfcTags({
      '83_8e_68_06': { plex: 620707 },
    }, KNOWN_READERS);
    expect(result['83_8e_68_06']).toEqual({
      global: { plex: 620707 },
      overrides: {},
    });
  });

  it('lowercases the tag UID', () => {
    const result = parseNfcTags({
      '83_8E_68_06': { plex: 620707 },
    }, KNOWN_READERS);
    expect(result['83_8e_68_06']).toBeDefined();
    expect(result['83_8E_68_06']).toBeUndefined();
  });

  it('separates tag-global scalar fields from per-reader override blocks', () => {
    const result = parseNfcTags({
      'aa_bb_cc_dd': {
        plex: 100,
        shader: 'default',     // scalar -> tag-global
        volume: 10,            // scalar -> tag-global
        livingroom: {          // object + matches reader ID -> override block
          shader: 'blackout',
        },
        bedroom: {             // another override block
          shader: 'night',
          volume: 5,
        },
      },
    }, KNOWN_READERS);
    expect(result['aa_bb_cc_dd'].global).toEqual({ plex: 100, shader: 'default', volume: 10 });
    expect(result['aa_bb_cc_dd'].overrides).toEqual({
      livingroom: { shader: 'blackout' },
      bedroom: { shader: 'night', volume: 5 },
    });
  });

  it('throws when an object-valued key does not match a known reader', () => {
    expect(() => parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingrm: { shader: 'blackout' },   // typo!
      },
    }, KNOWN_READERS))
      .toThrow(/tag "aa_bb".*reader-override.*"livingrm".*not registered/i);
  });

  it('accepts an object-valued field whose key matches a known reader (override block)', () => {
    expect(() => parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingroom: { shader: 'blackout' },
      },
    }, KNOWN_READERS)).not.toThrow();
  });

  it('throws when tag entry is not an object', () => {
    expect(() => parseNfcTags({ 'aa_bb': 'oops' }, KNOWN_READERS))
      .toThrow(/tag "aa_bb".*object/i);
  });

  it('treats null override block as empty (graceful)', () => {
    const result = parseNfcTags({
      'aa_bb': {
        plex: 1,
        livingroom: null,
      },
    }, KNOWN_READERS);
    // null should be treated as a scalar tag-global field (degenerate but valid)
    expect(result['aa_bb'].global).toEqual({ plex: 1, livingroom: null });
    expect(result['aa_bb'].overrides).toEqual({});
  });

  it('ignores arrays as tag-global scalars (rejects as override blocks)', () => {
    // Arrays are not plain objects; they go into global like other scalars.
    const result = parseNfcTags({
      'aa_bb': {
        plex: 1,
        tags: ['x', 'y'],   // array -> goes into global
      },
    }, KNOWN_READERS);
    expect(result['aa_bb'].global).toEqual({ plex: 1, tags: ['x', 'y'] });
  });
});
