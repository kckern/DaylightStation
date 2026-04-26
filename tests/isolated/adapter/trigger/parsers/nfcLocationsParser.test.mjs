import { describe, it, expect } from 'vitest';
import { parseNfcLocations } from '#adapters/trigger/parsers/nfcLocationsParser.mjs';

describe('parseNfcLocations', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseNfcLocations(null)).toEqual({});
    expect(parseNfcLocations(undefined)).toEqual({});
    expect(parseNfcLocations({})).toEqual({});
  });

  it('parses a minimal location with target+action', () => {
    const result = parseNfcLocations({
      livingroom: { target: 'livingroom-tv', action: 'play-next' },
    });
    expect(result.livingroom).toEqual({
      target: 'livingroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: {},
    });
  });

  it('separates reserved fields (target/action/auth_token) from defaults', () => {
    const result = parseNfcLocations({
      bedroom: {
        target: 'bedroom-tv',
        action: 'play-next',
        auth_token: 'secret',
        shader: 'blackout',
        volume: 8,
      },
    });
    expect(result.bedroom.target).toBe('bedroom-tv');
    expect(result.bedroom.action).toBe('play-next');
    expect(result.bedroom.auth_token).toBe('secret');
    expect(result.bedroom.defaults).toEqual({ shader: 'blackout', volume: 8 });
  });

  it('throws when location is not an object', () => {
    expect(() => parseNfcLocations({ livingroom: 'oops' }))
      .toThrow(/location "livingroom".*object/i);
  });

  it('throws when location has no target', () => {
    expect(() => parseNfcLocations({ livingroom: { action: 'play' } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('throws when target is not a non-empty string', () => {
    expect(() => parseNfcLocations({ livingroom: { target: '' } }))
      .toThrow(/location "livingroom".*target/i);
    expect(() => parseNfcLocations({ livingroom: { target: 123 } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('defaults auth_token to null when omitted', () => {
    const result = parseNfcLocations({
      kitchen: { target: 'kitchen-display', action: 'open' },
    });
    expect(result.kitchen.auth_token).toBeNull();
  });

  it('defaults action to null when omitted', () => {
    const result = parseNfcLocations({
      kitchen: { target: 'kitchen-display' },
    });
    expect(result.kitchen.action).toBeNull();
  });
});
