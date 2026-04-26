import { describe, it, expect } from 'vitest';
import { parseTriggerConfig } from '../../../../backend/src/2_domains/trigger/TriggerConfig.mjs';

describe('parseTriggerConfig', () => {
  it('returns an empty registry for null input', () => {
    expect(parseTriggerConfig(null, 'nfc')).toEqual({});
    expect(parseTriggerConfig(undefined, 'nfc')).toEqual({});
    expect(parseTriggerConfig({}, 'nfc')).toEqual({});
  });

  it('parses a valid location-rooted config', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'queue',
        tags: { '83_8e_68_06': { plex: 620707 } },
      },
    };
    const result = parseTriggerConfig(raw, 'nfc');
    expect(result.livingroom.target).toBe('livingroom-tv');
    expect(result.livingroom.action).toBe('queue');
    expect(result.livingroom.auth_token).toBeNull();
    expect(result.livingroom.entries['83_8e_68_06']).toEqual({ plex: 620707 });
  });

  it('preserves an explicit auth_token', () => {
    const raw = {
      office: { target: 'office-tv', action: 'play', auth_token: 'secret', tags: {} },
    };
    const result = parseTriggerConfig(raw, 'nfc');
    expect(result.office.auth_token).toBe('secret');
  });

  it('throws when a location entry is not an object', () => {
    expect(() => parseTriggerConfig({ livingroom: 'oops' }, 'nfc'))
      .toThrow(/location "livingroom".*object/i);
  });

  it('throws when a tag entry is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 'tv', tags: { 'aa_bb': 'oops' } },
    }, 'nfc')).toThrow(/tag "aa_bb".*object/i);
  });

  it('throws when a location has no target', () => {
    expect(() => parseTriggerConfig({ livingroom: { action: 'queue' } }, 'nfc'))
      .toThrow(/location "livingroom".*target/i);
  });

  it('coerces tag values to lowercase for lookups', () => {
    const result = parseTriggerConfig({
      livingroom: { target: 'tv', tags: { 'AA_BB_CC_DD': { plex: 1 } } },
    }, 'nfc');
    expect(result.livingroom.entries['aa_bb_cc_dd']).toEqual({ plex: 1 });
    expect(result.livingroom.entries['AA_BB_CC_DD']).toBeUndefined();
  });

  it('rejects array location/tag entries', () => {
    expect(() => parseTriggerConfig({ livingroom: ['target'] }, 'nfc'))
      .toThrow(/location "livingroom".*object/i);
    expect(() => parseTriggerConfig({
      livingroom: { target: 'tv', tags: { aa: [{ plex: 1 }] } },
    }, 'nfc')).toThrow(/tag "aa".*object/i);
  });

  it('throws when target is not a string', () => {
    expect(() => parseTriggerConfig({ livingroom: { target: 123 } }, 'nfc'))
      .toThrow(/location "livingroom".*target/i);
    expect(() => parseTriggerConfig({ livingroom: { target: ['tv'] } }, 'nfc'))
      .toThrow(/location "livingroom".*target/i);
  });

  it('treats an empty tags map as a valid (empty) entries map', () => {
    const result = parseTriggerConfig({ livingroom: { target: 'tv' } }, 'nfc');
    expect(result.livingroom.entries).toEqual({});
  });

  it('rejects unknown trigger types', () => {
    expect(() => parseTriggerConfig({ livingroom: { target: 'tv' } }, 'mystery'))
      .toThrow(/Unknown trigger type/);
  });

  it('throws when type is missing', () => {
    expect(() => parseTriggerConfig({ livingroom: { target: 'tv' } }))
      .toThrow(/type is required/);
  });
});
