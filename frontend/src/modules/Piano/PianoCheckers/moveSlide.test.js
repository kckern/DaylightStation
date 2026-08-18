import { describe, it, expect } from 'vitest';
import { slideOffsetCells, slideDurationMs } from './moveSlide.js';

describe('slideOffsetCells', () => {
  it('gives a one-cell diagonal for a simple move', () => {
    // square 8 -> 12 is one row down; columns differ by one.
    const off = slideOffsetCells({ from: 8, to: 12 });
    expect(Math.abs(off.dy)).toBe(1);
    expect(Math.abs(off.dx)).toBe(1);
  });

  it('gives a two-cell diagonal for a jump', () => {
    const off = slideOffsetCells({ from: 8, to: 17 });
    expect(Math.abs(off.dy)).toBe(2);
    expect(Math.abs(off.dx)).toBe(2);
  });

  it('points BACK to the origin — the piece starts there and slides to zero', () => {
    // from is up-board of to, so the offset must be negative on y.
    const off = slideOffsetCells({ from: 8, to: 12 });
    expect(off.dy).toBeLessThan(0);
  });

  it('returns null when there is nothing to animate', () => {
    expect(slideOffsetCells(null)).toBeNull();
    expect(slideOffsetCells(undefined)).toBeNull();
    expect(slideOffsetCells({ from: 5, to: 5 })).toBeNull();
    expect(slideOffsetCells({ from: -1, to: 12 })).toBeNull();
    expect(slideOffsetCells({ from: 8, to: 999 })).toBeNull();
  });
});

describe('slideDurationMs', () => {
  it('gives a jump longer than a step, so distance reads as distance', () => {
    const step = slideDurationMs(slideOffsetCells({ from: 8, to: 12 }));
    const jump = slideDurationMs(slideOffsetCells({ from: 8, to: 17 }));
    expect(jump).toBeGreaterThan(step);
  });

  it('is zero when there is no slide', () => {
    expect(slideDurationMs(null)).toBe(0);
  });
});
