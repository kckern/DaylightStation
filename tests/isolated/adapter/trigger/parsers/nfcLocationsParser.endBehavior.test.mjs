import { describe, it, expect } from 'vitest';
import { parseNfcLocations } from '../../../../../backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs';

describe('parseNfcLocations — end behavior', () => {
  it('extracts end and end_location as first-class fields (not in defaults)', () => {
    const out = parseNfcLocations({
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        end: 'tv-off',
        end_location: 'living_room',
        shader: 'default', // unrelated default — should still flow into defaults
      },
    });
    expect(out.livingroom.end).toBe('tv-off');
    expect(out.livingroom.end_location).toBe('living_room');
    expect(out.livingroom.defaults).toEqual({ shader: 'default' });
    expect(out.livingroom.defaults.end).toBeUndefined();
    expect(out.livingroom.defaults.end_location).toBeUndefined();
  });

  it('defaults end and end_location to null when absent', () => {
    const out = parseNfcLocations({
      livingroom: { target: 'livingroom-tv', action: 'play-next' },
    });
    expect(out.livingroom.end).toBeNull();
    expect(out.livingroom.end_location).toBeNull();
  });

  it('throws on unknown end value', () => {
    expect(() => parseNfcLocations({
      livingroom: { target: 'livingroom-tv', end: 'self-destruct' },
    })).toThrow(/end must be one of/);
  });

  it('throws when end:tv-off is set without end_location', () => {
    expect(() => parseNfcLocations({
      livingroom: { target: 'livingroom-tv', end: 'tv-off' },
    })).toThrow(/end_location/);
  });

  it('allows end:nothing and end:clear without end_location', () => {
    expect(() => parseNfcLocations({
      a: { target: 'tv', end: 'nothing' },
      b: { target: 'tv', end: 'clear' },
    })).not.toThrow();
  });
});
