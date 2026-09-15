import { describe, expect, it } from 'vitest';
import { FLICKER_GROUP_COUNT, assignFlickerGroups, nextColorIndex } from './segmentFlicker.js';

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe('assignFlickerGroups', () => {
  it('puts every segment in exactly one of three near-equal groups', () => {
    const groups = assignFlickerGroups(50);
    expect(groups).toHaveLength(FLICKER_GROUP_COUNT);
    expect(groups.flat().sort((left, right) => left - right)).toEqual([...Array(50).keys()]);
    const sizes = groups.map(group => group.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('shuffles membership instead of sweeping across the display in order', () => {
    const groups = assignFlickerGroups(48, seededRandom(7));
    const inOrder = Array.from({ length: 16 }, (_, index) => index * 3);
    expect(groups[0]).not.toEqual(inOrder);
  });
});

describe('nextColorIndex', () => {
  it('always picks a different color within the palette', () => {
    for (const paletteLength of [2, 7, 8]) {
      for (let current = 0; current < paletteLength; current += 1) {
        for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
          const next = nextColorIndex(current, paletteLength, () => roll);
          expect(next).not.toBe(current);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(paletteLength);
        }
      }
    }
  });

  it('leaves a one-color palette unchanged', () => {
    expect(nextColorIndex(0, 1)).toBe(0);
  });
});
