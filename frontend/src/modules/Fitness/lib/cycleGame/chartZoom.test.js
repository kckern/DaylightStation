import { describe, it, expect } from 'vitest';
import { continuousWindow, gridUnit, gridValues, pickAxisTicks } from './chartZoom.js';

describe('continuousWindow', () => {
  it('holds at the base window while the data is small', () => {
    expect(continuousWindow(50, { base: 150, fillFrac: 0.85 })).toBe(150);
    expect(continuousWindow(0, { base: 150, fillFrac: 0.85 })).toBe(150);
  });
  it('grows continuously to keep the data at fillFrac of the window', () => {
    // 200 m of data at 0.85 fill → window ≈ 235.3 m (data sits at 85% height).
    expect(continuousWindow(200, { base: 150, fillFrac: 0.85 })).toBeCloseTo(235.29, 1);
  });
  it('never doubles between adjacent data steps (no 2× rug-pull)', () => {
    const a = continuousWindow(300, { base: 150 });
    const b = continuousWindow(306, { base: 150 }); // one tick later, +6 m
    expect(b / a).toBeLessThan(1.05); // a gentle drift, nowhere near 2×
    expect(b).toBeGreaterThanOrEqual(a); // monotonic
  });
  it('is monotonic across a rising series', () => {
    let prev = 0;
    for (const d of [0, 100, 200, 400, 800, 1600]) {
      const w = continuousWindow(d, { base: 150 });
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });
});

describe('gridUnit', () => {
  it('uses the base unit when its on-screen spacing clears the pixel floor', () => {
    expect(gridUnit(500, 600, 250, 32)).toBe(250);
  });
  it('coarsens (doubles) the unit when lines would crowd below the floor', () => {
    expect(gridUnit(8000, 600, 250, 32)).toBe(500);
  });
});

describe('gridValues', () => {
  it('returns ascending multiples of the unit up to the window span', () => {
    expect(gridValues(500, 250, 600, 32)).toEqual([0, 250, 500]);
  });
  it('uses the coarsened unit so values never crowd below the floor', () => {
    const v = gridValues(8000, 250, 600, 32);
    expect(v[0]).toBe(0);
    expect(v[1]).toBe(500);
    expect(v[v.length - 1]).toBe(8000);
  });
});

describe('pickAxisTicks', () => {
  it('returns the whole array when it already fits under the cap', () => {
    expect(pickAxisTicks([0, 250, 500], 3)).toEqual([0, 250, 500]);
  });
  it('down-samples to the cap, anchoring the first and last', () => {
    const out = pickAxisTicks([0, 250, 500, 750, 1000], 3);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(1000);
    expect(out.length).toBeLessThanOrEqual(3);
  });
  it('dedupes rounding collisions on a short array', () => {
    const out = pickAxisTicks([0, 0, 0], 3);
    expect(out).toEqual([0]);
  });
  it('tolerates an empty or missing input', () => {
    expect(pickAxisTicks([], 3)).toEqual([]);
    expect(pickAxisTicks(undefined, 3)).toEqual([]);
  });
});
