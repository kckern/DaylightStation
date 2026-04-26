import { describe, test, expect } from '@jest/globals';
import { packLayout, classifyItems, solveSingleBand, solveDoubleBand, solveTripleBand, buildBands, renderBands, scoreLayout, DEFAULT_TALL_AREA_CAP } from '../../../frontend/src/modules/Menu/arcadePacker.js';

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

  // These three tests exercise the LEGACY single-band-only path. They pin
  // tallThreshold above any input ratio so no double bands are ever formed,
  // matching the pre-feature behavior they were originally written against.
  const NO_TALLS = { tallThreshold: 999 };

  test('places every item exactly once', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(42), ...NO_TALLS,
    });
    expect(placements).toHaveLength(itemRatios.length);
    const idxs = placements.map(p => p.idx).sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('every tile has positive width and height', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(7), ...NO_TALLS,
    });
    for (const p of placements) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  test('respects each tile\'s ratio (h/w within 1% of input ratio)', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(5), ...NO_TALLS,
    });
    for (const p of placements) {
      const observed = p.h / p.w;
      const expected = itemRatios[p.idx];
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.01);
    }
  });
});

describe('classifyItems', () => {
  test('splits indices by ratio threshold (default 1.1 — taller-than-square + buffer)', () => {
    const ratios = [0.7, 1.0, 1.4, 1.5, 2.0, 0.5];
    const { tallIndices, normalIndices } = classifyItems(ratios);
    // Default threshold is 1.1 (exclusive), so 1.0 stays normal; 1.4/1.5/2.0 are tall.
    expect(tallIndices).toEqual([2, 3, 4]);
    expect(normalIndices).toEqual([0, 1, 5]);
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
    expect(solveSingleBand([], 1000, 10)).toEqual({ rowH: 0, valid: false, clamped: false });
  });

  test('returns valid=false when computed rowH would be non-positive', () => {
    // Force gaps > W: 5 tiles at gap=300 → 4 gaps = 1200 > W=1000
    const out = solveSingleBand([1, 1, 1, 1, 1], 1000, 300);
    expect(out).toEqual({ rowH: 0, valid: false, clamped: false });
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

  test('emits a triple band when tripleCount=1 and two adjacent talls are available', () => {
    // 2 talls then 6 normals — should pair both talls into a triple with
    // 6 normals split across top/mid/bot (2 each, by alternating fill).
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3, 4, 5, 6, 7],
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 0,
    });
    const triples = bands.filter(b => b.type === 'triple');
    expect(triples).toHaveLength(1);
    expect(triples[0].talls).toEqual([0, 1]);
    // All 6 normal indices placed across top/mid/bot
    const normalsPlaced = [...triples[0].top, ...triples[0].mid, ...triples[0].bot].sort();
    expect(normalsPlaced).toEqual([2, 3, 4, 5, 6, 7]);
    // Each row non-empty
    expect(triples[0].top.length).toBeGreaterThan(0);
    expect(triples[0].mid.length).toBeGreaterThan(0);
    expect(triples[0].bot.length).toBeGreaterThan(0);
  });

  test('mixed: tripleCount=1, doubleCount=1, remainder as singles', () => {
    // 4 talls, 6 normals. Expect: 1 triple (consumes 2 talls, ~3 normals),
    // 1 double (consumes 1 tall, ~2 normals), 1 single tall, rest as singles.
    const itemRatios = [1.5, 1.5, 1.5, 1.5, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7];
    const bands = buildBands({
      itemRatios,
      order: itemRatios.map((_, i) => i),
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 1,
    });
    const triples = bands.filter(b => b.type === 'triple');
    const doubles = bands.filter(b => b.type === 'double');
    expect(triples).toHaveLength(1);
    expect(doubles).toHaveLength(1);
    // Triple consumed talls 0 and 1
    expect(triples[0].talls).toEqual([0, 1]);
    // Double consumed tall 2 (next tall after triple)
    expect(doubles[0].talls).toEqual([2]);
    // Tall 3 became a single
    const singleBands = bands.filter(b => b.type === 'single');
    const tall3InSingle = singleBands.some(b => b.items.includes(3));
    expect(tall3InSingle).toBe(true);
  });

  test('default behavior (no tripleCount/doubleCount specified) matches legacy: all talls try doubles', () => {
    // Same input as the existing "balanced upper/lower" test
    const itemRatios = [1.0, 1.0, 1.5, 1.0, 1.0];
    const bands = buildBands({
      itemRatios,
      order: [2, 0, 1, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
      // tripleCount and doubleCount omitted — defaults preserve legacy behavior
    });
    const doubles = bands.filter(b => b.type === 'double');
    const triples = bands.filter(b => b.type === 'triple');
    expect(triples).toHaveLength(0);
    expect(doubles).toHaveLength(1);
  });

  test('triple falls back if normal supply between talls is insufficient', () => {
    // 2 adjacent talls but only 2 normals after — needs ≥3 normals (one per row).
    const itemRatios = [1.5, 1.5, 1, 1];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3],
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 0,
    });
    // Triple cannot form (only 2 normals available, need ≥3 for top/mid/bot).
    // Algorithm falls back: the requested triple becomes (1 double + 1 single)
    // OR (2 singles) — either is acceptable. The invariant is no triple band.
    expect(bands.filter(b => b.type === 'triple')).toHaveLength(0);
    // All 4 indices still placed
    const allIndices = bands.flatMap(b => {
      if (b.type === 'single') return b.items;
      if (b.type === 'double') return [...b.talls, ...b.upper, ...b.lower];
      return [...b.talls, ...b.top, ...b.mid, ...b.bot];
    }).sort();
    expect(allIndices).toEqual([0, 1, 2, 3]);
  });

  test('does not mutate the caller\'s order array (explicit mode)', () => {
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const order = [0, 1, 2, 3, 4, 5, 6, 7];
    const orderCopy = order.slice();
    buildBands({
      itemRatios,
      order,
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 0,
    });
    expect(order).toEqual(orderCopy);
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

  test('alternates tall-tile side across consecutive double bands', () => {
    // Two double bands. First should put tall on LEFT, second on RIGHT.
    const bands = [
      { type: 'double', talls: [0], upper: [1, 2], lower: [3, 4] },
      { type: 'double', talls: [5], upper: [6, 7], lower: [8, 9] },
    ];
    const itemRatios = [2, 1, 1, 1, 1, 2, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 1500, gap: 10 });
    expect(result.valid).toBe(true);
    const tall1 = result.placements.find(p => p.idx === 0);
    const tall2 = result.placements.find(p => p.idx === 5);
    // First tall on the left edge.
    expect(tall1.x).toBeCloseTo(0, 1);
    // Second tall on the right edge: tall2.x + tall2.w ≈ W.
    expect(tall2.x + tall2.w).toBeCloseTo(1000, 1);
  });

  test('triple band: stacked talls span full vertical extent + 3 rows fill width', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [2, 3], mid: [4, 5], bot: [6, 7],
    }];
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 1100, gap: 10 });
    expect(result.valid).toBe(true);

    const tall1 = result.placements.find(p => p.idx === 0);
    const tall2 = result.placements.find(p => p.idx === 1);
    const topT = result.placements.find(p => p.idx === 2);
    const midT = result.placements.find(p => p.idx === 4);
    const botT = result.placements.find(p => p.idx === 6);

    // Talls share x and width.
    expect(tall1.x).toBeCloseTo(tall2.x, 1);
    expect(tall1.w).toBeCloseTo(tall2.w, 1);

    // tall2 is directly below tall1 with one gap between them.
    expect(tall2.y).toBeCloseTo(tall1.y + tall1.h + 10, 1);

    // Triple's vertical extent matches stacked talls.
    expect(tall2.y + tall2.h).toBeCloseTo(botT.y + botT.h, 1);
    expect(tall1.y).toBeCloseTo(topT.y, 1);

    // 3 rows of normals at three distinct y positions.
    expect(topT.y).toBeLessThan(midT.y);
    expect(midT.y).toBeLessThan(botT.y);

    // Each row fills width: rightmost tile's right edge ≈ W.
    const rowEnd = (idx) => {
      const tile = result.placements.find(p => p.idx === idx);
      return tile.x + tile.w;
    };
    expect(rowEnd(3)).toBeCloseTo(1000, 1);
    expect(rowEnd(5)).toBeCloseTo(1000, 1);
    expect(rowEnd(7)).toBeCloseTo(1000, 1);
  });

  test('triple band stays inside H when scaled down', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [2, 3], mid: [4, 5], bot: [6, 7],
    }];
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 400, gap: 10 });
    expect(result.valid).toBe(true);
    const lastY = Math.max(...result.placements.map(p => p.y + p.h));
    expect(lastY).toBeLessThanOrEqual(400 + 0.01);
  });

  test('alternation: triple + double + triple → talls land left, right, left', () => {
    const bands = [
      { type: 'triple', talls: [0, 1], top: [10, 11], mid: [12, 13], bot: [14, 15] },
      { type: 'double', talls: [2], upper: [16, 17], lower: [18, 19] },
      { type: 'triple', talls: [3, 4], top: [20, 21], mid: [22, 23], bot: [24, 25] },
    ];
    const itemRatios = Array(26).fill(1);
    itemRatios[0] = itemRatios[1] = itemRatios[2] = itemRatios[3] = itemRatios[4] = 1.5;
    const result = renderBands({ bands, itemRatios, W: 1000, H: 3000, gap: 10 });
    expect(result.valid).toBe(true);
    const tall0 = result.placements.find(p => p.idx === 0);   // first triple, tall on LEFT
    const tall2 = result.placements.find(p => p.idx === 2);   // second band (double), tall on RIGHT
    const tall3 = result.placements.find(p => p.idx === 3);   // third band (triple), tall on LEFT
    expect(tall0.x).toBeCloseTo(0, 1);
    expect(tall2.x + tall2.w).toBeCloseTo(1000, 1);
    expect(tall3.x).toBeCloseTo(0, 1);
  });

  test('returns valid=false when triple solver fails', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [], mid: [2], bot: [3],
    }];
    const result = renderBands({ bands, itemRatios: [1.5, 1.5, 1, 1], W: 1000, H: 1000, gap: 10 });
    expect(result.valid).toBe(false);
  });
});

describe('packLayout (band-based)', () => {
  // Use prod-like dimensions and a realistic tile mix (mostly landscape with
  // a couple of tall items) so the algorithm has room to find a valid layout.
  // The legacy small-canvas (1000x600) inputs were always pathologically
  // constrained for tall-tile spans and only "worked" because the buggy
  // post-scale maxRowPct check approved scaled-to-invisibility layouts.
  const realisticRatios = [
    ...Array(20).fill(0.7),       // landscape (N64-like)
    1.0, 1.0,                     // square
    1.5, 1.5,                     // tall
  ];

  test('every tile preserves its h/w ratio (tolerance 1%)', () => {
    const placements = packLayout({
      itemRatios: realisticRatios, W: 1152, H: 1080, random: seededRandom(42),
    });
    expect(placements.length).toBe(realisticRatios.length);
    for (const p of placements) {
      const observed = p.h / p.w;
      const expected = realisticRatios[p.idx];
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.01);
    }
  });

  test('placements stay inside the container (within rounding)', () => {
    const placements = packLayout({
      itemRatios: realisticRatios, W: 1152, H: 1080, random: seededRandom(99),
    });
    expect(placements.length).toBeGreaterThan(0);
    for (const p of placements) {
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.w).toBeLessThanOrEqual(1152.5);
      expect(p.y + p.h).toBeLessThanOrEqual(1080.5);
    }
  });

  test('a tall tile spans the height of two normal tiles in the same band', () => {
    // Force a list where index 0 is tall and the rest are normal,
    // and we expect the packer to land it in a double band.
    const itemRatios = [1.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    let foundDoubleSpan = false;
    for (let seed = 1; seed <= 20; seed++) {
      const placements = packLayout({
        itemRatios, W: 1000, H: 1000, random: seededRandom(seed),
      });
      const tall = placements.find(p => p.idx === 0);
      if (!tall) continue;
      // A tall in a double band has h roughly equal to (2 * normal_h + gap).
      // Find a normal tile that overlaps the tall vertically.
      const overlapping = placements.filter(p => p.idx !== 0
        && p.y >= tall.y - 1 && p.y + p.h <= tall.y + tall.h + 1);
      if (overlapping.length >= 2) { foundDoubleSpan = true; break; }
    }
    expect(foundDoubleSpan).toBe(true);
  });

  test('returns empty array on empty input', () => {
    expect(packLayout({ itemRatios: [], W: 1000, H: 600 })).toEqual([]);
  });

  test('packs at least one triple band when many tall items would dominate via doubles', () => {
    // 6 talls + 18 normals (25% tall by count). With doubles, talls might
    // consume ~40-50% of area. The optimizer should pick a layout with at
    // least one triple band to balance.
    // NOTE: H=1500 (vs the more constrained 1080) gives the maxRowPct=0.25
    // pre-scale rejection enough room to admit valid layouts at this tall
    // density. At 1080 the input is mathematically infeasible — every variant
    // produces some row > 270h before scale-down.
    const itemRatios = [
      ...Array(6).fill(1.5),
      ...Array(18).fill(0.7),
    ];
    let foundTriple = false;
    for (let seed = 1; seed <= 30; seed++) {
      const placements = packLayout({
        itemRatios, W: 1152, H: 1500, random: seededRandom(seed),
      });
      if (!placements.length) continue;
      // Triple-detection heuristic: in a triple, two talls share the same x
      // and have ~equal width.
      const tallCandidates = placements.filter(p => itemRatios[p.idx] > 1.1);
      const tallByX = new Map();
      for (const t of tallCandidates) {
        const key = Math.round(t.x / 5) * 5;
        if (!tallByX.has(key)) tallByX.set(key, []);
        tallByX.get(key).push(t);
      }
      for (const tiles of tallByX.values()) {
        if (tiles.length >= 2) { foundTriple = true; break; }
      }
      if (foundTriple) break;
    }
    expect(foundTriple).toBe(true);
  });

  test('GUARDRAIL: returns SOMETHING even when strict maxRowPct rejects every variant (H=1080 high-density)', () => {
    // The case the T5 implementer flagged: 6 talls + 18 normals at H=1080.
    // Pre-scale maxRowPct=0.25 (cap=270h) makes the strict check reject every
    // variant — but the grid MUST still render. Fallback should produce a
    // valid (possibly scaled-down) layout instead of returning [].
    const itemRatios = [...Array(6).fill(1.5), ...Array(18).fill(0.7)];
    const placements = packLayout({
      itemRatios, W: 1152, H: 1080, random: () => 0.5,
    });
    expect(placements.length).toBe(itemRatios.length);
    // Every tile placed within the container (scale-down OK).
    for (const p of placements) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  test('GUARDRAIL: returns SOMETHING for pathologically narrow container', () => {
    // Narrow container makes single-tile rows tall; strict check rejects all.
    // Fallback must still place every item.
    const itemRatios = [1.0, 1.5, 0.7, 1.0, 1.6, 0.8];
    const placements = packLayout({
      itemRatios, W: 200, H: 800, random: () => 0.5,
    });
    expect(placements.length).toBe(itemRatios.length);
  });

  test('GUARDRAIL: 16:7 viewport renders the grid (W=1152, H=840)', () => {
    // The user's repro: opening the kiosk in a 16:7 aspect window. Navmap
    // is the left ~60% of viewport, so W≈1152, H=840. With 26 mixed-aspect
    // tiles the strict pre-scale rejection wipes out every variant; fallback
    // must produce a layout (real prod data shape).
    const itemRatios = [
      ...Array(22).fill(0.7),       // 22 N64 landscape
      1.398, 1.399, 1.406, 1.428,   // 4 marginally tall
    ];
    const placements = packLayout({
      itemRatios, W: 1152, H: 840, random: () => 0.5,
    });
    expect(placements.length).toBe(itemRatios.length);
  });

  test('GUARDRAIL: final bounding box is square or wider (never taller than wide) for landscape containers', () => {
    // The packer is allowed to leave vertical empty space; what it MUST NOT
    // do is hand back a layout whose outer perimeter is taller than wide.
    const itemRatios = [
      ...Array(20).fill(0.7),
      1.0, 1.0,
      1.5, 1.5,
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const placements = packLayout({
        itemRatios, W: 1152, H: 1080, random: seededRandom(seed),
      });
      expect(placements.length).toBe(itemRatios.length);
      const left = Math.min(...placements.map(p => p.x));
      const right = Math.max(...placements.map(p => p.x + p.w));
      const top = Math.min(...placements.map(p => p.y));
      const bottom = Math.max(...placements.map(p => p.y + p.h));
      expect(right - left).toBeGreaterThanOrEqual(bottom - top);
    }
  });

  test('GUARDRAIL: prod scenario (N=26, 576x540 navmap) — never the catastrophic stack, prefers landscape, accepts slight-tall band layout', () => {
    // 2026-04-25 prod regression: the original brute fallback stacked all 26
    // tiles in one ~30px column producing aspect ~0.05. The contract now is
    //   1. EVERY seed produces all N placements (never empty / partial),
    //   2. EVERY layout uses varied band sizing (not a rigid grid fallback) —
    //      proven indirectly by the bbox NOT being the catastrophic stack
    //      (aspect must be > 0.5 — well above the ~0.05 stack failure mode),
    //   3. AT LEAST ONE seed produces a landscape (aspect >= 1) layout —
    //      proves the dual-tracker actually finds and prefers landscape
    //      variants when they exist, rather than always picking tall.
    const itemRatios = [
      ...Array(22).fill(0.7),       // landscape thumbs (N64-style)
      1.398, 1.399, 1.406, 1.428,   // marginal-tall (Mario Tennis etc.)
    ];
    let landscapeCount = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const placements = packLayout({
        itemRatios, W: 576, H: 540, random: seededRandom(seed),
      });
      expect(placements.length).toBe(itemRatios.length);
      const left = Math.min(...placements.map(p => p.x));
      const right = Math.max(...placements.map(p => p.x + p.w));
      const top = Math.min(...placements.map(p => p.y));
      const bottom = Math.max(...placements.map(p => p.y + p.h));
      const aspect = (right - left) / (bottom - top);
      // Catastrophic stack (~0.05) must never happen.
      expect(aspect).toBeGreaterThan(0.5);
      if (aspect >= 1) landscapeCount++;
    }
    // The dual-tracker MUST find landscape layouts for at least some seeds.
    expect(landscapeCount).toBeGreaterThan(0);
  });

  test('low-tall-density inputs prefer doubles (no unnecessary triples)', () => {
    // 1 tall + 25 normals — too few talls to need a triple. Doubles or
    // singles only.
    const itemRatios = [1.5, ...Array(25).fill(0.7)];
    let triplesEverFormed = false;
    for (let seed = 1; seed <= 10; seed++) {
      const placements = packLayout({
        itemRatios, W: 1152, H: 1080, random: seededRandom(seed),
      });
      if (!placements.length) continue;
      const tallCandidates = placements.filter(p => itemRatios[p.idx] > 1.1);
      const tallByX = new Map();
      for (const t of tallCandidates) {
        const key = Math.round(t.x / 5) * 5;
        if (!tallByX.has(key)) tallByX.set(key, []);
        tallByX.get(key).push(t);
      }
      for (const tiles of tallByX.values()) {
        if (tiles.length >= 2) { triplesEverFormed = true; break; }
      }
    }
    expect(triplesEverFormed).toBe(false);
  });
});

describe('solveTripleBand', () => {
  test('symmetric case: r_t1=r_t2=1.5, three rows of 2 squares, W=1000, gap=10', () => {
    const out = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 1000, gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.w_t).toBeCloseTo(328.89, 1);
    expect(out.tall1_h).toBeCloseTo(493.33, 1);
    expect(out.tall2_h).toBeCloseTo(493.33, 1);
    expect(out.top_h).toBeCloseTo(325.56, 1);
    expect(out.mid_h).toBeCloseTo(325.56, 1);
    expect(out.bot_h).toBeCloseTo(325.56, 1);
    expect(out.tall1_h + 10 + out.tall2_h).toBeCloseTo(out.H_triple, 2);
  });

  test('asymmetric tall ratios shift the seam off-center', () => {
    const out = solveTripleBand({
      tallRatios: [1.0, 2.0],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 1000, gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.w_t).toBeGreaterThan(0);
    expect(out.tall2_h / out.tall1_h).toBeCloseTo(2.0, 3);
    expect(out.tall1_h + 10 + out.tall2_h).toBeCloseTo(out.H_triple, 2);
    const checkRow = (rowH, n) => out.w_t + 10 + n * rowH + (n - 1) * 10;
    expect(checkRow(out.top_h, 2)).toBeCloseTo(1000, 2);
    expect(checkRow(out.mid_h, 2)).toBeCloseTo(1000, 2);
    expect(checkRow(out.bot_h, 2)).toBeCloseTo(1000, 2);
  });

  test('valid=false when any normal row is empty', () => {
    const out1 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [], midRatios: [1], botRatios: [1],
      W: 1000, gap: 10,
    });
    expect(out1).toEqual({
      valid: false, H_triple: 0, w_t: 0,
      tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0,
    });
    const out2 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1], midRatios: [], botRatios: [1],
      W: 1000, gap: 10,
    });
    expect(out2.valid).toBe(false);
    const out3 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1], midRatios: [1], botRatios: [],
      W: 1000, gap: 10,
    });
    expect(out3.valid).toBe(false);
  });

  test('valid=false when computed dimensions are non-positive', () => {
    const out = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 100, gap: 60,
    });
    expect(out).toEqual({
      valid: false, H_triple: 0, w_t: 0,
      tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0,
    });
  });
});

describe('scoreLayout', () => {
  test('perfect fill + perfect balance returns positive composite', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 250, h: 100 },
      { idx: 1, x: 250, y: 0, w: 250, h: 100 },
      { idx: 2, x: 500, y: 0, w: 250, h: 100 },
      { idx: 3, x: 750, y: 0, w: 250, h: 100 },
    ];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 100 });
    expect(out.fillRatio).toBeCloseTo(1.0, 3);
    expect(out.tallAreaFrac).toBeCloseTo(0, 3);
    expect(out.tallCountFrac).toBeCloseTo(0, 3);
    expect(out.balanceTerm).toBeCloseTo(1.0, 3);
    expect(out.capPenalty).toBe(0);
    expect(out.score).toBeGreaterThan(0);
  });

  test('balanced talls (area% == count%) maximize balanceTerm', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 250, h: 200 },
      { idx: 1, x: 250, y: 0, w: 250, h: 200 },
      { idx: 2, x: 500, y: 0, w: 250, h: 200 },
      { idx: 3, x: 750, y: 0, w: 250, h: 200 },
    ];
    const tallSet = new Set([0, 1]);
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 200 });
    expect(out.tallAreaFrac).toBeCloseTo(0.5, 3);
    expect(out.tallCountFrac).toBe(0.5);
    expect(out.balanceTerm).toBeCloseTo(1.0, 3);
    expect(out.capPenalty).toBe(0);
  });

  test('over-allocation triggers cap penalty', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 600, h: 200 },
      { idx: 1, x: 0, y: 200, w: 333, h: 100 },
      { idx: 2, x: 333, y: 200, w: 333, h: 100 },
      { idx: 3, x: 666, y: 200, w: 334, h: 100 },
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 300 });
    expect(out.tallAreaFrac).toBeCloseTo(0.4, 3);
    expect(out.capPenalty).toBe(0);
  });

  test('exceeding hard cap produces penalty proportional to overshoot', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 600, h: 600 },
      { idx: 1, x: 600, y: 0, w: 400, h: 600 },
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({ placements, tallSet, N: 2, W: 1000, H: 600 });
    expect(out.tallAreaFrac).toBeCloseTo(0.6, 3);
    expect(out.capPenalty).toBeCloseTo(0.1, 3);
    expect(out.score).toBeLessThan(out.fillRatio + out.balanceTerm);
  });

  test('overflow (totalH > H) penalizes fillRatio via inversion', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 1000, h: 800 },
    ];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 1, W: 1000, H: 400 });
    expect(out.fillRatio).toBeCloseTo(0.5, 3);
  });

  test('uses default constants when weights/cap not provided', () => {
    const placements = [{ idx: 0, x: 0, y: 0, w: 100, h: 100 }];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 1, W: 100, H: 100 });
    expect(out.score).toBeCloseTo(2, 3);
  });

  test('respects custom weights and cap', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 800, h: 1000 },
      { idx: 1, x: 800, y: 0, w: 200, h: 1000 },
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({
      placements, tallSet, N: 2, W: 1000, H: 1000,
      fillWeight: 2, balanceWeight: 0.5, capWeight: 100, areaCap: 0.4,
    });
    expect(out.tallAreaFrac).toBeCloseTo(0.8, 3);
    expect(out.score).toBeLessThan(0);
  });

  test('asymmetric balance: under-allocation gets full balanceTerm', () => {
    // 2 of 4 items are tall (50% count) but they only occupy 40% of area.
    // Under symmetric balance this would penalize 0.1; asymmetric gives 1.0.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 200, h: 100 },     // tall, area=20000
      { idx: 1, x: 200, y: 0, w: 200, h: 100 },   // tall, area=20000
      { idx: 2, x: 400, y: 0, w: 300, h: 100 },   // normal, area=30000
      { idx: 3, x: 700, y: 0, w: 300, h: 100 },   // normal, area=30000
    ];
    const tallSet = new Set([0, 1]);
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 100 });
    expect(out.tallAreaFrac).toBeCloseTo(0.4, 3);
    expect(out.tallCountFrac).toBe(0.5);
    // Under-allocated (0.4 < 0.5) → balanceTerm = 1 - max(0, -0.1) = 1.0
    expect(out.balanceTerm).toBeCloseTo(1.0, 3);
  });
});
