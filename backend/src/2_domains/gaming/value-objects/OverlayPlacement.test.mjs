import { describe, it, expect } from 'vitest';
import { parseBezel, choosePlacement, intersects, contains } from './OverlayPlacement.mjs';

const GB = {
  source: 'gameboy_animated_border',
  screen: [0.2896, 0.1065, 0.4182, 0.6713],
  zones: [
    { name: 'bottom', box: [0, 0.7889, 1, 0.2111], toast: [0.525, 0.7889, 0.2188, 0.1111], orientation: 'wide' },
    { name: 'left', box: [0, 0, 0.2783, 1], toast: [0.0625, 0.4148, 0.2158, 0.1111], orientation: 'wide' },
  ],
};

describe('intersects', () => {
  it('does not count shared edges as overlap', () => {
    expect(intersects([0, 0, 0.5, 1], [0.5, 0, 0.5, 1])).toBe(false);
  });
  it('detects a real overlap', () => {
    expect(intersects([0, 0, 0.6, 1], [0.5, 0, 0.5, 1])).toBe(true);
  });
});

describe('contains', () => {
  it('accepts an inner rect flush with the outer edge', () => {
    expect(contains([0, 0, 1, 0.2], [0.5, 0, 0.5, 0.2])).toBe(true);
  });
  it('rejects one that escapes', () => {
    expect(contains([0, 0, 1, 0.2], [0.5, 0, 0.5, 0.3])).toBe(false);
  });
});

describe('parseBezel', () => {
  it('parses a measured bezel and freezes it', () => {
    const bezel = parseBezel(GB, { system: 'gb' });
    expect(bezel.zones).toHaveLength(2);
    expect(bezel.screen).toEqual([0.2896, 0.1065, 0.4182, 0.6713]);
    expect(Object.isFrozen(bezel)).toBe(true);
  });

  it('returns null for a system with no bezel rather than throwing', () => {
    expect(parseBezel(null)).toBeNull();
  });

  // The whole point of the geometry: a zone is a promise that the game is not
  // underneath it. A drifted measurement must fail loudly at boot.
  it('refuses a zone that overlaps the game screen', () => {
    expect(() => parseBezel({
      screen: [0.2, 0.2, 0.6, 0.6],
      zones: [{ name: 'bad', box: [0, 0, 0.5, 0.5] }],
    }, { system: 'x' })).toThrow(/overlaps the game screen/);
  });

  it('refuses a toast that escapes its own zone', () => {
    expect(() => parseBezel({
      screen: [0.2, 0.2, 0.6, 0.6],
      zones: [{ name: 'top', box: [0, 0, 1, 0.2], toast: [0, 0, 1, 0.5] }],
    }, { system: 'x' })).toThrow(/escapes its own zone/);
  });

  it('refuses a rect outside the unit square', () => {
    expect(() => parseBezel({ screen: [0, 0, 1.5, 1], zones: [] }, { system: 'x' }))
      .toThrow(/unit square/);
  });

  it('refuses a malformed rect', () => {
    expect(() => parseBezel({ screen: [0, 0, 1], zones: [] }, { system: 'x' }))
      .toThrow(/\[x, y, w, h\]/);
  });

  it('defaults a zone with no toast to the whole zone', () => {
    const bezel = parseBezel({
      screen: [0, 0.3, 1, 0.7],
      zones: [{ name: 'top', box: [0, 0, 1, 0.3] }],
    }, { system: 'x' });
    expect(bezel.zones[0].toast).toEqual([0, 0, 1, 0.3]);
  });

  it('treats an unknown orientation as wide', () => {
    const bezel = parseBezel({
      screen: [0, 0.3, 1, 0.7],
      zones: [{ name: 'top', box: [0, 0, 1, 0.3], orientation: 'sideways' }],
    }, { system: 'x' });
    expect(bezel.zones[0].orientation).toBe('wide');
  });
});

describe('choosePlacement', () => {
  it('takes the first zone, which is the quietest artwork', () => {
    expect(choosePlacement(parseBezel(GB, { system: 'gb' })).zone).toBe('bottom');
  });

  it('honours a preference', () => {
    expect(choosePlacement(parseBezel(GB, { system: 'gb' }), { prefer: 'left' }).zone).toBe('left');
  });

  it('falls back rather than failing when the preferred zone is absent', () => {
    expect(choosePlacement(parseBezel(GB, { system: 'gb' }), { prefer: 'nope' }).zone).toBe('bottom');
  });

  // A bezel with nowhere to draw is a real answer, not an error: the caller
  // should speak instead of covering the game.
  it('returns null when there is no room at all', () => {
    expect(choosePlacement(parseBezel({ screen: [0, 0, 1, 1], zones: [] }, { system: 'x' }))).toBeNull();
    expect(choosePlacement(null)).toBeNull();
  });

  it('never returns a toast that touches the game screen', () => {
    const bezel = parseBezel(GB, { system: 'gb' });
    for (const zone of bezel.zones) {
      expect(intersects(zone.toast, bezel.screen)).toBe(false);
    }
  });
});
