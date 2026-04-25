import { describe, it, expect } from '@jest/globals';
import { parseNfcConfig } from '../../../../backend/src/2_domains/nfc/NfcConfig.mjs';

describe('parseNfcConfig', () => {
  it('returns empty readers/tags for null input', () => {
    expect(parseNfcConfig(null)).toEqual({ readers: {}, tags: {} });
    expect(parseNfcConfig(undefined)).toEqual({ readers: {}, tags: {} });
    expect(parseNfcConfig({})).toEqual({ readers: {}, tags: {} });
  });

  it('parses a valid config', () => {
    const raw = {
      readers: { 'livingroom-nfc': { target: 'livingroom-tv', action: 'queue' } },
      tags: { '83_8e_68_06': { plex: 620707 } },
    };
    const result = parseNfcConfig(raw);
    expect(result.readers['livingroom-nfc']).toEqual({ target: 'livingroom-tv', action: 'queue' });
    expect(result.tags['83_8e_68_06']).toEqual({ plex: 620707 });
  });

  it('throws when a reader entry is not an object', () => {
    expect(() => parseNfcConfig({ readers: { 'r1': 'oops' } }))
      .toThrow(/reader "r1".*object/i);
  });

  it('throws when a tag entry is not an object', () => {
    expect(() => parseNfcConfig({ tags: { 'aa_bb': 'oops' } }))
      .toThrow(/tag "aa_bb".*object/i);
  });

  it('throws when a reader has no target', () => {
    expect(() => parseNfcConfig({ readers: { 'r1': { action: 'queue' } } }))
      .toThrow(/reader "r1".*target/i);
  });

  it('coerces tag UIDs to lowercase for lookups', () => {
    const result = parseNfcConfig({ tags: { 'AA_BB_CC_DD': { plex: 1 } } });
    expect(result.tags['aa_bb_cc_dd']).toEqual({ plex: 1 });
    expect(result.tags['AA_BB_CC_DD']).toBeUndefined();
  });

  it('rejects array reader/tag entries', () => {
    expect(() => parseNfcConfig({ readers: { r1: ['target'] } }))
      .toThrow(/reader "r1".*object/i);
    expect(() => parseNfcConfig({ tags: { aa: [{ plex: 1 }] } }))
      .toThrow(/tag "aa".*object/i);
  });

  it('throws when target is not a string', () => {
    expect(() => parseNfcConfig({ readers: { r1: { target: 123 } } }))
      .toThrow(/reader "r1".*target/i);
    expect(() => parseNfcConfig({ readers: { r1: { target: ['tv'] } } }))
      .toThrow(/reader "r1".*target/i);
  });
});
