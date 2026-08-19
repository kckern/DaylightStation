import { describe, it, expect } from 'vitest';
import {
  resolveBandConfig, showsNowHeading, nowSideFor, accordionShares, playheadFraction,
  bondConnector, BAND_DEFAULTS, NOW_SIDE_THRESHOLD, NOW_SIDE_HYSTERESIS,
  SEGMENT_FLOOR_PX, ACCORDION_MS, NOW_PANEL_SHARE,
} from './band.js';

const withBand = (band) => ({ definition: { regions: {}, collapse: {}, band } });

/** The Eroica's four movements, as the rail derives them: 976/949/353/677 of 2955. */
const EROICA_SEGMENTS = [
  { start: 0, stop: 976 },
  { start: 976, stop: 1925 },
  { start: 1925, stop: 2278 },
  { start: 2278, stop: 2955 },
];
const EROICA_NATURAL = EROICA_SEGMENTS.map((s) => (s.stop - s.start) / 2955);

describe('resolveBandConfig', () => {
  it('defaults to today’s behaviour when nothing is authored', () => {
    expect(resolveBandConfig(null)).toEqual(BAND_DEFAULTS);
    expect(resolveBandConfig({})).toEqual(BAND_DEFAULTS);
    expect(resolveBandConfig({ definition: {} })).toEqual(BAND_DEFAULTS);
  });

  it('reads the three authored keys', () => {
    expect(resolveBandConfig(withBand({
      nowSide: 'left', nowHeading: 'always', railDensity: 'bars',
    }))).toEqual({ nowSide: 'left', nowHeading: 'always', railDensity: 'bars' });
  });

  it('always returns a COMPLETE object, so no call site needs a fallback of its own', () => {
    const partial = resolveBandConfig(withBand({ nowSide: 'dynamic' }));
    expect(partial).toEqual({ nowSide: 'dynamic', nowHeading: 'auto', railDensity: 'names' });
  });

  it('degrades an unrecognised or wrong-typed value to its default', () => {
    expect(resolveBandConfig(withBand({ nowSide: 'middle' })).nowSide).toBe('right');
    expect(resolveBandConfig(withBand({ nowHeading: true })).nowHeading).toBe('auto');
    expect(resolveBandConfig(withBand({ railDensity: 7 })).railDensity).toBe('names');
    expect(resolveBandConfig(withBand([]))).toEqual(BAND_DEFAULTS);
    expect(resolveBandConfig(withBand('right'))).toEqual(BAND_DEFAULTS);
  });

  it('trims whitespace rather than failing on it — YAML round-trips carry it', () => {
    expect(resolveBandConfig(withBand({ nowSide: ' dynamic ' })).nowSide).toBe('dynamic');
  });
});

describe('showsNowHeading', () => {
  it('auto + a rail that names movements: the register does NOT repeat the name', () => {
    expect(showsNowHeading({ nowHeading: 'auto', railDensity: 'names' })).toBe(false);
  });

  it('auto + a bars-only rail: the register is the only place left to name it', () => {
    expect(showsNowHeading({ nowHeading: 'auto', railDensity: 'bars' })).toBe(true);
  });

  it('always and never override the rail, in both densities', () => {
    for (const railDensity of ['names', 'bars']) {
      expect(showsNowHeading({ nowHeading: 'always', railDensity })).toBe(true);
      expect(showsNowHeading({ nowHeading: 'never', railDensity })).toBe(false);
    }
  });

  it('is safe on a missing config', () => {
    expect(showsNowHeading(null)).toBe(false);
    expect(showsNowHeading(undefined)).toBe(false);
  });
});

describe('nowSideFor', () => {
  it('honours a fixed side at every position', () => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      expect(nowSideFor({ nowSide: 'left' }, f, null)).toBe('left');
      expect(nowSideFor({ nowSide: 'right' }, f, null)).toBe('right');
    }
  });

  it('dynamic: left under half-way, right at and past it', () => {
    const cfg = { nowSide: 'dynamic' };
    expect(nowSideFor(cfg, 0, null)).toBe('left');
    expect(nowSideFor(cfg, 0.4, null)).toBe('left');
    expect(nowSideFor(cfg, NOW_SIDE_THRESHOLD, null)).toBe('right');
    expect(nowSideFor(cfg, 0.9, null)).toBe('right');
  });

  it('HOLDS inside the hysteresis band rather than flapping', () => {
    const cfg = { nowSide: 'dynamic' };
    const inside = NOW_SIDE_THRESHOLD - (NOW_SIDE_HYSTERESIS / 2);
    expect(nowSideFor(cfg, inside, 'right')).toBe('right');
    expect(nowSideFor(cfg, inside, 'left')).toBe('left');
  });

  it('swaps back only once the playhead clears the whole hysteresis band', () => {
    const cfg = { nowSide: 'dynamic' };
    const edge = NOW_SIDE_THRESHOLD - NOW_SIDE_HYSTERESIS;
    expect(nowSideFor(cfg, edge, 'right')).toBe('right');
    expect(nowSideFor(cfg, edge - 0.0001, 'right')).toBe('left');
  });

  it('cannot be flapped by a scrub sitting on the mark', () => {
    const cfg = { nowSide: 'dynamic' };
    let side = nowSideFor(cfg, 0.4999, null);
    expect(side).toBe('left');
    // A 10 Hz wobble across the threshold: it crosses ONCE and then stays.
    const wobble = [0.5001, 0.4999, 0.5002, 0.4998, 0.5000, 0.4999];
    const seen = [];
    for (const f of wobble) { side = nowSideFor(cfg, f, side); seen.push(side); }
    expect(seen).toEqual(['right', 'right', 'right', 'right', 'right', 'right']);
  });

  it('seeds deterministically from the fraction alone on a fresh mount', () => {
    const cfg = { nowSide: 'dynamic' };
    const inside = NOW_SIDE_THRESHOLD - (NOW_SIDE_HYSTERESIS / 2);
    expect(nowSideFor(cfg, inside, null)).toBe('left');
    expect(nowSideFor(cfg, NOW_SIDE_THRESHOLD + 0.001, null)).toBe('right');
  });

  it('holds its previous answer when the fraction is not a number', () => {
    const cfg = { nowSide: 'dynamic' };
    expect(nowSideFor(cfg, NaN, 'right')).toBe('right');
    expect(nowSideFor(cfg, undefined, null)).toBe('left');
  });
});

describe('accordionShares', () => {
  const RAIL = 858;   // the office screen's measured rule width at 1280x720

  it('returns the natural widths when nothing is sounding', () => {
    expect(accordionShares({
      natural: EROICA_NATURAL, activeIndex: -1, railPx: RAIL, desiredPx: 400,
    })).toEqual(EROICA_NATURAL);
  });

  it('returns the natural widths for a single-movement piece — no neighbour to compress', () => {
    expect(accordionShares({
      natural: [1], activeIndex: 0, railPx: RAIL, desiredPx: 900,
    })).toEqual([1]);
  });

  it('never NARROWS the active segment below what its duration earns it', () => {
    // Movement 1 is 976/2955 of the rail — 283px. A 40px name asks for nothing.
    const out = accordionShares({
      natural: EROICA_NATURAL, activeIndex: 0, railPx: RAIL, desiredPx: 40,
    });
    expect(out).toEqual(EROICA_NATURAL);
  });

  it('widens the sounding movement to exactly what it asked for', () => {
    const desired = 260;
    const out = accordionShares({
      natural: EROICA_NATURAL, activeIndex: 2, railPx: RAIL, desiredPx: desired,
    });
    expect(out[2] * RAIL).toBeCloseTo(desired, 6);
  });

  it('still sums to one — the rail is never over- or under-filled', () => {
    for (const desired of [120, 260, 400, 700, 5000]) {
      const out = accordionShares({
        natural: EROICA_NATURAL, activeIndex: 2, railPx: RAIL, desiredPx: desired,
      });
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('takes from neighbours in proportion to their NATURAL widths', () => {
    const desired = 200;   // Scherzo is 102.5px naturally; asks for ~97.5px more
    const out = accordionShares({
      natural: EROICA_NATURAL, activeIndex: 2, railPx: RAIL, desiredPx: desired,
    });
    const given = [0, 1, 3].map((i) => (EROICA_NATURAL[i] - out[i]) * RAIL);
    // Each donor's contribution over its own natural width is the same ratio.
    const ratios = [0, 1, 3].map((i, k) => given[k] / (EROICA_NATURAL[i] * RAIL));
    expect(ratios[1]).toBeCloseTo(ratios[0], 9);
    expect(ratios[2]).toBeCloseTo(ratios[0], 9);
  });

  it('holds every neighbour at or above the floor, however greedy the ask', () => {
    const out = accordionShares({
      natural: EROICA_NATURAL, activeIndex: 0, railPx: RAIL, desiredPx: 5000,
    });
    [1, 2, 3].forEach((i) => {
      expect(out[i] * RAIL).toBeGreaterThanOrEqual(SEGMENT_FLOOR_PX - 1e-6);
    });
  });

  it('DEGRADES rather than breaking: a name longer than the rail takes only what is free', () => {
    const out = accordionShares({
      natural: EROICA_NATURAL, activeIndex: 2, railPx: RAIL, desiredPx: 5000,
    });
    const free = RAIL - 3 * SEGMENT_FLOOR_PX;
    expect(out[2] * RAIL).toBeCloseTo(free, 6);
    // ...and it is still short of what it asked for, so it keeps its ellipsis.
    expect(out[2] * RAIL).toBeLessThan(5000);
  });

  it('gives nothing when every neighbour is already at or under the floor', () => {
    // Eight short movements on a narrow rail: 400/8 = 50px each, under the floor.
    const many = new Array(8).fill(1 / 8);
    const out = accordionShares({
      natural: many, activeIndex: 3, railPx: 400, desiredPx: 300,
    });
    expect(out).toEqual(many);
  });

  it('re-spreads the shortfall when one donor hits the floor before the others', () => {
    // One donor is nearly at the floor; the rest must absorb its share.
    const natural = [0.6, 0.1, 0.3];
    const railPx = 800;   // 480 / 80 / 240 px; the floor is 72
    const out = accordionShares({
      natural, activeIndex: 0, railPx, desiredPx: 640, floorPx: SEGMENT_FLOOR_PX,
    });
    expect(out[0] * railPx).toBeCloseTo(640, 6);
    expect(out[1] * railPx).toBeGreaterThanOrEqual(SEGMENT_FLOOR_PX - 1e-6);
    expect(out[2] * railPx).toBeGreaterThanOrEqual(SEGMENT_FLOOR_PX - 1e-6);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('is inert until the rail has been measured', () => {
    expect(accordionShares({
      natural: EROICA_NATURAL, activeIndex: 2, railPx: 0, desiredPx: 300,
    })).toEqual(EROICA_NATURAL);
    expect(accordionShares({
      natural: EROICA_NATURAL, activeIndex: 2, railPx: 858, desiredPx: NaN,
    })).toEqual(EROICA_NATURAL);
  });

  it('handles an empty rail', () => {
    expect(accordionShares({ natural: [], activeIndex: 0, railPx: 858, desiredPx: 100 })).toEqual([]);
    expect(accordionShares({ natural: null, activeIndex: 0, railPx: 858, desiredPx: 100 })).toEqual([]);
  });
});

describe('playheadFraction — the law the accordion must not break', () => {
  const widened = accordionShares({
    natural: EROICA_NATURAL, activeIndex: 2, railPx: 858, desiredPx: 260,
  });

  it('reaches each boundary EXACTLY at the boundary, whatever the widths', () => {
    for (const shares of [EROICA_NATURAL, widened]) {
      let acc = 0;
      for (let i = 0; i < EROICA_SEGMENTS.length - 1; i += 1) {
        acc += shares[i];
        const at = playheadFraction({
          segments: EROICA_SEGMENTS, shares, position: EROICA_SEGMENTS[i].stop, end: 2955,
        });
        expect(at).toBeCloseTo(acc, 9);
      }
    }
  });

  it('is that segment’s OWN elapsed fraction inside the segment', () => {
    // Half-way through the widened Scherzo (1925..2278).
    const mid = 1925 + (2278 - 1925) / 2;
    const before = widened[0] + widened[1];
    const at = playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: mid, end: 2955,
    });
    expect(at).toBeCloseTo(before + widened[2] * 0.5, 9);
  });

  it('is NOT the piece’s overall elapsed fraction once the accordion has moved', () => {
    const mid = 1925 + (2278 - 1925) / 2;
    const naive = (mid - 0) / 2955;
    const at = playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: mid, end: 2955,
    });
    expect(Math.abs(at - naive)).toBeGreaterThan(0.02);
  });

  it('pins to the ends', () => {
    expect(playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: 0, end: 2955,
    })).toBe(0);
    expect(playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: 2955, end: 2955,
    })).toBe(1);
    expect(playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: 3200, end: 2955,
    })).toBe(1);
  });

  it('is monotonic across the whole piece under the accordion', () => {
    let last = -1;
    for (let t = 0; t <= 2955; t += 7) {
      const at = playheadFraction({
        segments: EROICA_SEGMENTS, shares: widened, position: t, end: 2955,
      });
      expect(at).toBeGreaterThanOrEqual(last - 1e-12);
      last = at;
    }
  });

  it('survives an empty rail and a non-numeric position', () => {
    expect(playheadFraction({ segments: [], shares: [], position: 10, end: 100 })).toBe(0);
    expect(playheadFraction({
      segments: EROICA_SEGMENTS, shares: widened, position: NaN, end: 2955,
    })).toBe(0);
  });
});

describe('bondConnector', () => {
  it('needs no bridge when the active segment already sits over the panel', () => {
    expect(bondConnector({ segStart: 0.6, segEnd: 0.8, side: 'right' }).width).toBe(0);
    expect(bondConnector({ segStart: 0.1, segEnd: 0.3, side: 'left' }).width).toBe(0);
  });

  it('needs no bridge when the segment merely overlaps the panel’s edge', () => {
    expect(bondConnector({ segStart: 0.4, segEnd: 0.6, side: 'right' }).width).toBe(0);
  });

  it('bridges rightwards from a segment that ends before the right panel', () => {
    const c = bondConnector({ segStart: 0.05, segEnd: 0.2, side: 'right' });
    expect(c.start).toBeCloseTo(0.2, 9);
    expect(c.width).toBeCloseTo(0.3, 9);
    expect(c.start + c.width).toBeCloseTo(1 - NOW_PANEL_SHARE, 9);
  });

  it('bridges leftwards from a segment that starts after the left panel', () => {
    const c = bondConnector({ segStart: 0.8, segEnd: 0.95, side: 'left' });
    expect(c.start).toBeCloseTo(NOW_PANEL_SHARE, 9);
    expect(c.width).toBeCloseTo(0.3, 9);
  });

  it('never returns a negative width', () => {
    for (const side of ['left', 'right']) {
      for (let a = 0; a < 1; a += 0.05) {
        const c = bondConnector({ segStart: a, segEnd: a + 0.05, side });
        expect(c.width).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the constants are single-sourced and stated', () => {
  it('the accordion has one duration', () => {
    expect(ACCORDION_MS).toBe(420);
  });

  it('the two registers are halves', () => {
    expect(NOW_PANEL_SHARE).toBe(0.5);
  });

  it('the hysteresis band is the brief’s ~47%', () => {
    expect(NOW_SIDE_THRESHOLD - NOW_SIDE_HYSTERESIS).toBeCloseTo(0.47, 9);
  });
});
