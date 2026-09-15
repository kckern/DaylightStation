import { describe, expect, it } from 'vitest';
import { nextColorIndex } from './segmentFlicker.js';

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

describe('nextColorIndex with touching colors to avoid', () => {
  it('never picks a color a touching segment holds while another is free', () => {
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      expect(nextColorIndex(0, 8, () => roll, [1, 2, 3, 4, 5, 6])).toBe(7);
    }
  });

  it('still changes color when every other color is taken', () => {
    expect(nextColorIndex(0, 3, () => 0.5, [1, 2])).not.toBe(0);
  });
});
