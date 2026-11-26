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
    expect(measured).toBeLessThanOrEqual(6);
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
