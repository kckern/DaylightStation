import { describe, test, expect } from '@jest/globals';
import { packLayout, classifyItems, solveSingleBand, solveDoubleBand, buildBands, renderBands } from '../../../frontend/src/modules/Menu/arcadePacker.js';

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

describe('solveSingleBand', () => {
  test('three squares fill width 1000, gap 10 → rowH=(1000-20)/3', () => {
    const out = solveSingleBand([1, 1, 1], 1000, 10);
    expect(out.valid).toBe(true);
    expect(out.rowH).toBeCloseTo((1000 - 20) / 3, 6); // 326.666…
  });

  test('mixed ratios solve correctly', () => {
    // ratios 0.5, 1.0, 2.0 → Σ(1/r) = 2 + 1 + 0.5 = 3.5
    const out = solveSingleBand([0.5, 1.0, 2.0], 1000, 10);
    expect(out.rowH).toBeCloseTo((1000 - 20) / 3.5, 6);
  });

  test('single tile: rowH = W * ratio', () => {
    const out = solveSingleBand([1.5], 600, 10);
    expect(out.rowH).toBeCloseTo(600 * 1.5, 6);
  });

  test('returns valid=false when ratios is empty', () => {
    expect(solveSingleBand([], 1000, 10)).toEqual({ rowH: 0, valid: false });
  });

  test('returns valid=false when computed rowH would be non-positive', () => {
    // Force gaps > W: 5 tiles at gap=300 → 4 gaps = 1200 > W=1000
    const out = solveSingleBand([1, 1, 1, 1, 1], 1000, 300);
    expect(out).toEqual({ rowH: 0, valid: false });
  });
});

describe('solveDoubleBand', () => {
  test('symmetric worked example: tall r=2, two squares above and below, W=1000, gap=10', () => {
    const out = solveDoubleBand({
      tallRatio: 2,
      upperRatios: [1, 1],
      lowerRatios: [1, 1],
      W: 1000,
      gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.H_pair).toBeCloseTo(660, 4);
    expect(out.w_t).toBeCloseTo(330, 4);
    expect(out.upper_h).toBeCloseTo(325, 4);
    expect(out.lower_h).toBeCloseTo(325, 4);
  });

  test('upper and lower rows each fill exactly W (within rounding)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5,
      upperRatios: [0.5],
      lowerRatios: [1, 1, 1],
      W: 1000,
      gap: 10,
    });
    expect(out.valid).toBe(true);
    // upper: w_t + gap + (upper_h / 0.5) === W
    expect(out.w_t + 10 + out.upper_h / 0.5).toBeCloseTo(1000, 3);
    // lower: w_t + gap + 3*(lower_h) + 2*gap === W
    expect(out.w_t + 10 + 3 * out.lower_h + 20).toBeCloseTo(1000, 3);
    // pair geometry
    expect(out.upper_h + 10 + out.lower_h).toBeCloseTo(out.H_pair, 3);
    expect(out.w_t).toBeCloseTo(out.H_pair / 1.5, 3);
  });

  test('valid=false when upperRatios is empty (degenerate)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5, upperRatios: [], lowerRatios: [1, 1], W: 1000, gap: 10,
    });
    expect(out.valid).toBe(false);
  });

  test('valid=false when lowerRatios is empty (degenerate)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5, upperRatios: [1, 1], lowerRatios: [], W: 1000, gap: 10,
    });
    expect(out.valid).toBe(false);
  });

  test('valid=false when computed dimensions are non-positive', () => {
    // Crank gap so high that all derived heights collapse
    const out = solveDoubleBand({
      tallRatio: 2, upperRatios: [1, 1], lowerRatios: [1, 1], W: 100, gap: 80,
    });
    expect(out).toEqual({ valid: false, H_pair: 0, w_t: 0, upper_h: 0, lower_h: 0 });
  });
});

describe('buildBands', () => {
  test('all-normal items produce only single bands', () => {
    const itemRatios = [1.0, 1.0, 0.7, 1.0, 0.8];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    expect(bands.every(b => b.type === 'single')).toBe(true);
    const placedIdxs = bands.flatMap(b => b.items).sort((a, b) => a - b);
    expect(placedIdxs).toEqual([0, 1, 2, 3, 4]);
  });

  test('a tall item creates a double band with balanced upper/lower', () => {
    const itemRatios = [1.0, 1.0, 1.5, 1.0, 1.0]; // index 2 is tall
    const bands = buildBands({
      itemRatios,
      order: [2, 0, 1, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    const doubles = bands.filter(b => b.type === 'double');
    expect(doubles).toHaveLength(1);
    expect(doubles[0].talls).toEqual([2]);
    // |upper| - |lower| <= 1
    expect(Math.abs(doubles[0].upper.length - doubles[0].lower.length)).toBeLessThanOrEqual(1);
  });

  test('every input index appears exactly once across all bands', () => {
    const itemRatios = [1.0, 1.5, 0.7, 1.0, 1.6, 0.8, 1.0, 1.4, 1.0];
    const bands = buildBands({
      itemRatios,
      order: itemRatios.map((_, i) => i),
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    const seen = new Set();
    for (const b of bands) {
      const ids = b.type === 'double'
        ? [...b.talls, ...b.upper, ...b.lower]
        : b.items;
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(itemRatios.length);
  });

  test('tall item with no normals available falls back to single band', () => {
    const itemRatios = [2.0]; // only one tall
    const bands = buildBands({
      itemRatios,
      order: [0],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
    });
    expect(bands).toHaveLength(1);
    expect(bands[0].type).toBe('single');
    expect(bands[0].items).toEqual([0]);
  });

  test('alternation puts indices into upper/lower in interleaved order', () => {
    // tall at 0, then 4 normals — 1st goes upper, 2nd lower, 3rd upper, 4th lower.
    const bands = buildBands({
      itemRatios: [1.5, 1, 1, 1, 1],
      order: [0, 1, 2, 3, 4],
      tallThreshold: 1.4,
      refH: 50,
      W: 1000,
      gap: 10,
      minPerRow: 1,
    });
    const d = bands.find(b => b.type === 'double');
    expect(d.upper).toEqual([1, 3]);
    expect(d.lower).toEqual([2, 4]);
  });
});

describe('renderBands', () => {
  test('single band: emits placements that fill W exactly', () => {
    const bands = [{ type: 'single', items: [0, 1, 2] }];
    const itemRatios = [1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 600, gap: 10 });
    expect(result.valid).toBe(true);
    expect(result.placements).toHaveLength(3);
    const lastTile = result.placements[2];
    expect(lastTile.x + lastTile.w).toBeCloseTo(1000, 3);
  });

  test('double band: tall spans both rows, non-tall tiles fill remaining width per row', () => {
    const bands = [{ type: 'double', talls: [0], upper: [1, 2], lower: [3, 4] }];
    const itemRatios = [2, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 700, gap: 10 });
    expect(result.valid).toBe(true);
    const tall = result.placements.find(p => p.idx === 0);
    const upperTiles = [1, 2].map(i => result.placements.find(p => p.idx === i));
    const lowerTiles = [3, 4].map(i => result.placements.find(p => p.idx === i));

    // Tall height = upper_h + gap + lower_h (top-to-bottom span)
    const upperBottom = upperTiles[0].y + upperTiles[0].h;
    const lowerTop = lowerTiles[0].y;
    expect(lowerTop).toBeCloseTo(upperBottom + 10, 3);
    expect(tall.y).toBeCloseTo(upperTiles[0].y, 3);
    expect(tall.y + tall.h).toBeCloseTo(lowerTiles[0].y + lowerTiles[0].h, 3);

    // Upper row width fills to W
    expect(upperTiles[1].x + upperTiles[1].w).toBeCloseTo(1000, 3);
    // Lower row width fills to W
    expect(lowerTiles[1].x + lowerTiles[1].w).toBeCloseTo(1000, 3);
  });

  test('scales down when bands\' total height exceeds H', () => {
    // Tiny H forces scale-down
    const bands = [
      { type: 'single', items: [0, 1] },
      { type: 'single', items: [2, 3] },
    ];
    const itemRatios = [1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 100, gap: 10 });
    expect(result.valid).toBe(true);
    const lastY = Math.max(...result.placements.map(p => p.y + p.h));
    expect(lastY).toBeLessThanOrEqual(100 + 0.01);
  });

  test('returns valid=false if any band fails to solve', () => {
    const bands = [{ type: 'double', talls: [0], upper: [], lower: [1] }];
    const result = renderBands({ bands, itemRatios: [2, 1], W: 1000, H: 700, gap: 10 });
    expect(result.valid).toBe(false);
  });

  test('double band stays inside H when scaled down', () => {
    // One double band: tall r=2 + 2 squares each in upper/lower.
    // Naturally H_pair = 660 at W=1000, gap=10. Pin H=300 to force scale ~ 0.45.
    const bands = [{ type: 'double', talls: [0], upper: [1, 2], lower: [3, 4] }];
    const itemRatios = [2, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 300, gap: 10 });
    expect(result.valid).toBe(true);
    const lastY = Math.max(...result.placements.map(p => p.y + p.h));
    expect(lastY).toBeLessThanOrEqual(300 + 0.01);
    // Tall tile should still span the full pair vertically (top of upper to bottom of lower).
    const tall = result.placements.find(p => p.idx === 0);
    const upperT = result.placements.find(p => p.idx === 1);
    const lowerT = result.placements.find(p => p.idx === 3);
    expect(tall.y).toBeCloseTo(upperT.y, 3);
    expect(tall.y + tall.h).toBeCloseTo(lowerT.y + lowerT.h, 3);
  });
});
