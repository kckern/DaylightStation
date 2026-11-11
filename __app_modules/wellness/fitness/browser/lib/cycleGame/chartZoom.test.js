import { describe, it, expect } from 'vitest';
import { continuousWindow, evenTicks } from "./chartZoom.js";

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

describe('evenTicks', () => {
  it('three evenly spaced labels including both ends', () => {
    expect(evenTicks(0, 300, 3)).toEqual([0, 150, 300]);
    expect(evenTicks(0, 450, 4)).toEqual([0, 150, 300, 450]);
  });
  it('count of 1 returns [min]', () => expect(evenTicks(5, 10, 1)).toEqual([5]));
  it('count below 1 or non-finite returns []', () => {
    for (const c of [0, -2, NaN, Infinity, undefined, null]) expect(evenTicks(0, 10, c)).toEqual([]);
  });
  it('max < min still spaces evenly in the given order', () => {
    expect(evenTicks(300, 0, 3)).toEqual([300, 150, 0]);
  });
  it('has no float noise', () => {
    const t = evenTicks(0, 1, 4);
    [0, 1 / 3, 2 / 3, 1].forEach((v, i) => expect(Math.abs(t[i] - v)).toBeLessThan(1e-9));
    expect(evenTicks(0, 0.3, 4)).toEqual([0, 0.1, 0.2, 0.3]);
  });
  it('non-finite bounds yield []', () => {
    expect(evenTicks(NaN, 10, 3)).toEqual([]);
    expect(evenTicks(0, Infinity, 3)).toEqual([]);
  });
  it('fractional counts are floored', () => expect(evenTicks(0, 10, 3.9)).toEqual([0, 5, 10]));
});

import { niceCeil, niceCeilTime } from './chartZoom.js';

describe('niceCeil', () => {
  it('snaps up to 1 / 2 / 2.5 / 5 times a power of ten', () => {
    expect(niceCeil(512)).toBe(1000);
    expect(niceCeil(1020)).toBe(2000);
    expect(niceCeil(1990)).toBe(2000);
    expect(niceCeil(2100)).toBe(2500);
    expect(niceCeil(2600)).toBe(5000);
    expect(niceCeil(5001)).toBe(10000);
    expect(niceCeil(180)).toBe(200);
    expect(niceCeil(0.7)).toBe(1);
  });
  it('keeps an already-round value', () => {
    expect(niceCeil(500)).toBe(500);
    expect(niceCeil(1000)).toBe(1000);
    expect(niceCeil(2500)).toBe(2500);
  });
  it('is monotonic and never below its input', () => {
    let prev = 0;
    for (let v = 1; v < 20000; v += 37) {
      const n = niceCeil(v);
      expect(n).toBeGreaterThanOrEqual(v);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
  it('returns 0 for unusable input', () => {
    expect(niceCeil(0)).toBe(0);
    expect(niceCeil(-4)).toBe(0);
    expect(niceCeil(NaN)).toBe(0);
  });
});

describe('niceCeilTime', () => {
  it('rounds up to whole minutes, then 5 and 30 minute steps', () => {
    expect(niceCeilTime(247)).toBe(300);
    expect(niceCeilTime(240)).toBe(240);
    expect(niceCeilTime(121)).toBe(180);
    expect(niceCeilTime(601)).toBe(900);
    expect(niceCeilTime(3700)).toBe(5400);
  });
  it('returns 0 for unusable input', () => {
    expect(niceCeilTime(0)).toBe(0);
    expect(niceCeilTime(NaN)).toBe(0);
  });
});
