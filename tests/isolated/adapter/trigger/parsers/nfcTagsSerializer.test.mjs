import { describe, it, expect } from 'vitest';
import { serializeNfcTags } from '#adapters/trigger/parsers/nfcTagsSerializer.mjs';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';

describe('serializeNfcTags', () => {
  it('returns an empty object for an empty input', () => {
    expect(serializeNfcTags({})).toEqual({});
  });

  it('flattens a tag with only global fields', () => {
    const parsed = {
      '83_8e_68_06': { global: { plex: 620707 }, overrides: {} },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '83_8e_68_06': { plex: 620707 },
    });
  });

  it('flattens a tag with global + per-reader overrides', () => {
    const parsed = {
      '83_8e_68_06': {
        global: { plex: 620707, shader: 'default' },
        overrides: {
          livingroom: { shader: 'blackout' },
          bedroom: { shader: 'night', volume: 5 },
        },
      },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '83_8e_68_06': {
        plex: 620707,
        shader: 'default',
        livingroom: { shader: 'blackout' },
        bedroom: { shader: 'night', volume: 5 },
      },
    });
  });

  it('round-trips through parseNfcTags', () => {
    const original = {
      '83_8e_68_06': {
        plex: 620707,
        shader: 'default',
        livingroom: { shader: 'blackout' },
      },
      '04_a1_b2_c3': {
        scanned_at: '2026-04-26 14:32:18',
        note: 'kids favorite',
      },
    };
    const parsed = parseNfcTags(original, new Set(['livingroom']));
    const reserialized = serializeNfcTags(parsed);
    expect(reserialized).toEqual(original);
  });

  it('preserves placeholder entries (only scanned_at)', () => {
    const parsed = {
      '04_a1_b2_c3': {
        global: { scanned_at: '2026-04-26 14:32:18' },
        overrides: {},
      },
    };
    expect(serializeNfcTags(parsed)).toEqual({
      '04_a1_b2_c3': { scanned_at: '2026-04-26 14:32:18' },
    });
  });
});
