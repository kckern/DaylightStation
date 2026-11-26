// __app_modules/media/media/browser/surround/modules/clipBandFit.test.js
import { describe, it, expect } from 'vitest';
import { fitDown, lineCount } from './clipBandFit.js';

describe('fitDown', () => {
  const run = (limit, ceilPx = 28, floorPx = 16) => {
    const applied = [];
    const r = fitDown({ ceilPx, floorPx, apply: (px) => applied.push(px), ok: (px) => px <= limit });
    return { ...r, last: applied[applied.length - 1] };
  };

  it('keeps the stylesheet size when it already fits', () => {
    expect(run(40)).toEqual({ px: 28, fits: true, last: 28 });
  });

  it('steps down to the largest size that fits, and leaves it applied', () => {
    expect(run(21.5)).toEqual({ px: 21, fits: true, last: 21 });
  });

  it('reports a miss and leaves the floor applied when nothing fits', () => {
    expect(run(10)).toEqual({ px: 16, fits: false, last: 16 });
  });

  it('measures the floor itself when it falls between steps', () => {
    // 16 -> 12 by 1px, then 11.52: the old walk applied 11.52 without measuring it.
    const r = fitDown({ ceilPx: 16, floorPx: 11.52, apply: () => {}, ok: (px) => px <= 11.6 });
    expect(r).toEqual({ px: 11.52, fits: true });
  });

  it('finds the answer in a handful of measurements, not one per pixel', () => {
    let measured = 0;
    const r = fitDown({ ceilPx: 28, floorPx: 14, apply: () => {}, ok: (px) => { measured += 1; return px <= 15; } });
    expect(r).toEqual({ px: 15, fits: true });
    // 15 candidates (28..14): the ceiling, the floor, then a bisection of the rest.
    expect(measured).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(15)));
  });

  it('leaves the winner applied when the last probe was a failing size', () => {
    // 28..14 with ok at <= 16: the search ends probing 17, which fails.
    const applied = [];
    const measuredAt = [];
    const r = fitDown({
      ceilPx: 28, floorPx: 14,
      apply: (px) => applied.push(px),
      ok: (px) => { measuredAt.push(px); return px <= 16; },
    });
    expect(r).toEqual({ px: 16, fits: true });
    expect(measuredAt[measuredAt.length - 1]).toBe(17);
    expect(applied[applied.length - 1]).toBe(16);
  });

  it('never sets type larger than the ceiling it was given', () => {
    const applied = [];
    const r = fitDown({ ceilPx: 26.8375, floorPx: 14, apply: (px) => applied.push(px), ok: () => true });
    expect(r).toEqual({ px: 26.8375, fits: true });
    expect(applied).toEqual([26.8375]);
  });

  it('returns a size that passed when measured, even for a check that is not monotonic', () => {
    // Passes only at 20, 15 and the floor 14 (the floor passing lets the search start).
    const passedAt = new Set();
    const r = fitDown({
      ceilPx: 28, floorPx: 14, apply: () => {},
      ok: (px) => { const pass = px === 20 || px === 15 || px === 14; if (pass) passedAt.add(px); return pass; },
    });
    expect(r.fits).toBe(true);
    expect(passedAt.has(r.px)).toBe(true);
  });

  it('never rounds a candidate below a floor with more than two decimals', () => {
    // 11.5249 rounds to 11.52, under the 11.5241 floor.
    const applied = [];
    const r = fitDown({ ceilPx: 12.5249, floorPx: 11.5241, apply: (px) => applied.push(px), ok: (px) => px <= 11.6 });
    expect(r).toEqual({ px: 11.5241, fits: true });
    expect(applied.every((px) => px >= 11.5241)).toBe(true);
  });

  it('measures once when the ceiling is the floor', () => {
    let measured = 0;
    const ok = (limit) => (px) => { measured += 1; return px <= limit; };
    expect(fitDown({ ceilPx: 14, floorPx: 14, apply: () => {}, ok: ok(20) })).toEqual({ px: 14, fits: true });
    expect(fitDown({ ceilPx: 14, floorPx: 14, apply: () => {}, ok: ok(10) })).toEqual({ px: 14, fits: false });
    expect(measured).toBe(2);
  });
});

describe('lineCount', () => {
  it('reads lines off a block height', () => {
    expect(lineCount(28 * 1.12 * 2, 28, 1.12)).toBe(2);
    expect(lineCount(0, 28, 1.12)).toBe(0);
  });
});
