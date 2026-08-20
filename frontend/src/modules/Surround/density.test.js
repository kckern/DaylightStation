import { describe, it, expect } from 'vitest';
import { densityShares, SEGMENT_CHIP_FLOOR_PX } from './band.js';

const sum = (a) => a.reduce((n, x) => n + x, 0);
const px = (shares, railPx) => shares.map((s) => Math.round(s * railPx));

/** needs[i] is the width segment i's own label asks for, chrome excluded. */
const call = (over = {}) => densityShares({
  segments: [{}, {}, {}],
  needs: [40, 40, 40],
  chromePx: 10,
  railPx: 1000,
  activeIndex: 1,
  ...over,
});

describe('densityShares', () => {
  it('gives every chipped segment the SAME width', () => {
    // Three segments, one active: the two chips must be identical whatever
    // their durations or their own label widths were.
    const s = densityShares({
      segments: [{}, {}, {}],
      needs: [200, 40, 5],
      chromePx: 10,
      railPx: 1000,
      activeIndex: 1,
    });
    expect(s[0]).toBeCloseTo(s[2], 9);
  });

  it('gives the active segment the width its own title needs', () => {
    const railPx = 1000;
    const s = densityShares({
      segments: [{}, {}, {}], needs: [40, 300, 40], chromePx: 10, railPx, activeIndex: 1,
    });
    // chrome + need, and nothing taken back off it.
    expect(Math.round(s[1] * railPx)).toBeGreaterThanOrEqual(300);
  });

  it('gives a fold the width its PARENT TITLE needs, not a chip', () => {
    const railPx = 1000;
    const s = densityShares({
      segments: [{ collapsed: true }, {}, {}],
      needs: [180, 40, 40],
      chromePx: 10,
      railPx,
      activeIndex: 1,
    });
    expect(Math.round(s[0] * railPx)).toBeGreaterThanOrEqual(180);
    // …and it is wider than the chip beside it, which is the whole point.
    expect(s[0]).toBeGreaterThan(s[2]);
  });

  it('always fills exactly one rail', () => {
    expect(sum(call())).toBeCloseTo(1, 9);
    expect(sum(call({ segments: [{ collapsed: true }, {}, {}, {}, {}] , needs: [90, 9, 9, 9, 9] }))).toBeCloseTo(1, 9);
  });

  it('no longer encodes duration at all — two segments of wildly different length draw the same', () => {
    const s = densityShares({
      segments: [{ duration: 5 }, {}, { duration: 5000 }],
      needs: [40, 40, 40],
      chromePx: 10,
      railPx: 1000,
      activeIndex: 1,
    });
    expect(s[0]).toBeCloseTo(s[2], 9);
  });

  it('squeezes the CHIPS when the claims overrun the rail, never the active title', () => {
    // 40 chips at 24px plus a 400px active title cannot fit 600px of rail.
    const railPx = 600;
    const segments = Array.from({ length: 41 }, () => ({}));
    const needs = segments.map((_, i) => (i === 0 ? 400 : 8));
    const s = densityShares({ segments, needs, chromePx: 4, railPx, activeIndex: 0 });
    const drawn = px(s, railPx);
    expect(drawn[0]).toBeGreaterThan(300);          // the title kept its room
    expect(drawn[1]).toBeLessThan(SEGMENT_CHIP_FLOOR_PX); // the chips gave it up
    expect(sum(s)).toBeCloseTo(1, 9);
  });

  it('holds chips at their floor while there is room to do so', () => {
    const railPx = 2000;
    const segments = Array.from({ length: 11 }, () => ({}));
    const needs = segments.map((_, i) => (i === 0 ? 300 : 8));
    const drawn = px(densityShares({ segments, needs, chromePx: 4, railPx, activeIndex: 0 }), railPx);
    expect(drawn[1]).toBeGreaterThanOrEqual(SEGMENT_CHIP_FLOOR_PX);
  });

  it('falls back to the rail it was given when nothing is sounding', () => {
    const s = densityShares({
      segments: [{}, {}, {}], needs: [40, 40, 40], chromePx: 10, railPx: 1000, activeIndex: -1,
    });
    expect(sum(s)).toBeCloseTo(1, 9);
    expect(s[0]).toBeCloseTo(s[1], 9); // all chips, all equal
  });

  it('survives an unmeasured rail rather than dividing by zero', () => {
    expect(densityShares({ segments: [{}, {}], needs: [], chromePx: 0, railPx: 0, activeIndex: 0 }))
      .toEqual([0.5, 0.5]);
  });

  it('survives an empty rail', () => {
    expect(densityShares({ segments: [], needs: [], chromePx: 0, railPx: 100, activeIndex: -1 })).toEqual([]);
  });
});
