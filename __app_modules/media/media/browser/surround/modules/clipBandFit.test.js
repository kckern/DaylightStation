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
});

describe('lineCount', () => {
  it('reads lines off a block height', () => {
    expect(lineCount(28 * 1.12 * 2, 28, 1.12)).toBe(2);
    expect(lineCount(0, 28, 1.12)).toBe(0);
  });
});
