import { describe, test, expect } from '@jest/globals';
import { packLayout } from '../../../frontend/src/modules/Menu/arcadePacker.js';
import { classifyItems } from '../../../frontend/src/modules/Menu/arcadePacker.js';

// Deterministic LCG so attempts/shuffle/mirror are reproducible.
function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('packLayout (legacy parity)', () => {
  test('returns empty array for empty input', () => {
    expect(packLayout({ itemRatios: [], W: 1000, H: 600 })).toEqual([]);
  });

  test('places every item exactly once', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(42),
    });
    expect(placements).toHaveLength(itemRatios.length);
    const idxs = placements.map(p => p.idx).sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('every tile has positive width and height', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(7),
    });
    for (const p of placements) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  test('respects each tile\'s ratio (h/w within 1% of input ratio)', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(5),
    });
    for (const p of placements) {
      const observed = p.h / p.w;
      const expected = itemRatios[p.idx];
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.01);
    }
  });
});

describe('classifyItems', () => {
  test('splits indices by ratio threshold (default 1.4)', () => {
    const ratios = [0.7, 1.0, 1.4, 1.5, 2.0, 0.5];
    const { tallIndices, normalIndices } = classifyItems(ratios);
    expect(tallIndices).toEqual([3, 4]);
    expect(normalIndices).toEqual([0, 1, 2, 5]);
  });

  test('uses custom threshold when provided', () => {
    const ratios = [1.0, 1.2, 1.4];
    const { tallIndices, normalIndices } = classifyItems(ratios, 1.1);
    expect(tallIndices).toEqual([1, 2]);
    expect(normalIndices).toEqual([0]);
  });

  test('treats threshold as exclusive lower bound (>, not >=)', () => {
    const { tallIndices } = classifyItems([1.4, 1.4001], 1.4);
    expect(tallIndices).toEqual([1]);
  });

  test('handles empty input', () => {
    expect(classifyItems([])).toEqual({ tallIndices: [], normalIndices: [] });
  });
});
