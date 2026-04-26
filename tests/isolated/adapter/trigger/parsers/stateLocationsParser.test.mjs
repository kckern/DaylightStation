import { describe, it, expect } from 'vitest';
import { parseStateLocations } from '#adapters/trigger/parsers/stateLocationsParser.mjs';

describe('parseStateLocations', () => {
  it('returns empty for null/undefined/empty input', () => {
    expect(parseStateLocations(null)).toEqual({});
    expect(parseStateLocations(undefined)).toEqual({});
    expect(parseStateLocations({})).toEqual({});
  });

  it('parses a location with state mappings', () => {
    const result = parseStateLocations({
      livingroom: {
        target: 'livingroom-tv',
        states: {
          off: { action: 'clear' },
          on: { action: 'play', queue: 'ambient' },
        },
      },
    });
    expect(result.livingroom).toEqual({
      target: 'livingroom-tv',
      auth_token: null,
      states: {
        off: { action: 'clear' },
        on: { action: 'play', queue: 'ambient' },
      },
    });
  });

  it('lowercases state values for lookup', () => {
    const result = parseStateLocations({
      livingroom: { target: 'tv', states: { OFF: { action: 'clear' } } },
    });
    expect(result.livingroom.states.off).toEqual({ action: 'clear' });
    expect(result.livingroom.states.OFF).toBeUndefined();
  });

  it('preserves auth_token when set', () => {
    const result = parseStateLocations({
      livingroom: { target: 'tv', auth_token: 'secret', states: {} },
    });
    expect(result.livingroom.auth_token).toBe('secret');
  });

  it('throws when location has no target', () => {
    expect(() => parseStateLocations({ livingroom: { states: {} } }))
      .toThrow(/location "livingroom".*target/i);
  });

  it('throws when states is not an object', () => {
    expect(() => parseStateLocations({
      livingroom: { target: 'tv', states: 'oops' },
    })).toThrow(/states.*object/i);
  });

  it('throws when a state entry is not an object', () => {
    expect(() => parseStateLocations({
      livingroom: { target: 'tv', states: { off: 'oops' } },
    })).toThrow(/state "off".*object/i);
  });

  it('treats missing states block as empty', () => {
    const result = parseStateLocations({
      kitchen: { target: 'kitchen-display' },
    });
    expect(result.kitchen.states).toEqual({});
  });
});
