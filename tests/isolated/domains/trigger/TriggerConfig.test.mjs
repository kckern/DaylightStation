import { describe, it, expect } from 'vitest';
import { parseTriggerConfig } from '../../../../backend/src/2_domains/trigger/TriggerConfig.mjs';

describe('parseTriggerConfig', () => {
  // NOTE: parseTriggerConfig is now multi-modality and no longer takes a
  // `type` argument. The output `entries` is keyed by modality first
  // (nfc/barcode/voice/state), then by value. Type-arg-related tests
  // ("rejects unknown trigger types" / "throws when type is missing")
  // have been removed because the parser now derives modality buckets
  // from YAML keys (tags / codes / keywords / states).

  it('returns an empty registry for null input', () => {
    expect(parseTriggerConfig(null)).toEqual({});
    expect(parseTriggerConfig(undefined)).toEqual({});
    expect(parseTriggerConfig({})).toEqual({});
  });

  it('parses a valid location-rooted config', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        tags: { '83_8e_68_06': { plex: 620707 } },
      },
    };
    const result = parseTriggerConfig(raw);
    expect(result.livingroom.target).toBe('livingroom-tv');
    expect(result.livingroom.action).toBe('queue');
    expect(result.livingroom.auth_token).toBeNull();
    expect(result.livingroom.entries.nfc['83_8e_68_06']).toEqual({ plex: 620707 });
  });

  it('preserves an explicit auth_token', () => {
    const raw = {
      office: { target: 'office-tv', action: 'play', auth_token: 'secret', tags: {} },
    };
    const result = parseTriggerConfig(raw);
    expect(result.office.auth_token).toBe('secret');
  });

  it('throws when a location entry is not an object', () => {
    expect(() => parseTriggerConfig({ livingroom: 'oops' }))
      .toThrow(/location "livingroom".*object/i);
  });

  it('throws when a tag entry is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 'tv', tags: { 'aa_bb': 'oops' } },
    })).toThrow(/tag "aa_bb".*object/i);
  });

  it('throws when a location has no target', () => {
    expect(() => parseTriggerConfig({ livingroom: { action: 'queue' } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('coerces tag values to lowercase for lookups', () => {
    const result = parseTriggerConfig({
      livingroom: { target: 'tv', tags: { 'AA_BB_CC_DD': { plex: 1 } } },
    });
    expect(result.livingroom.entries.nfc['aa_bb_cc_dd']).toEqual({ plex: 1 });
    expect(result.livingroom.entries.nfc['AA_BB_CC_DD']).toBeUndefined();
  });

  it('rejects array location/tag entries', () => {
    expect(() => parseTriggerConfig({ livingroom: ['target'] }))
      .toThrow(/location "livingroom".*object/i);
    expect(() => parseTriggerConfig({
      livingroom: { target: 'tv', tags: { aa: [{ plex: 1 }] } },
    })).toThrow(/tag "aa".*object/i);
  });

  it('throws when target is not a string', () => {
    expect(() => parseTriggerConfig({ livingroom: { target: 123 } }))
      .toThrow(/location "livingroom".*target/i);
    expect(() => parseTriggerConfig({ livingroom: { target: ['tv'] } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('omits absent modality buckets from entries', () => {
    const result = parseTriggerConfig({ livingroom: { target: 'tv' } });
    // No tags/codes/keywords/states declared → no modality buckets created
    expect(result.livingroom.entries).toEqual({});
  });
});
