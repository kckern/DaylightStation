import { describe, it, expect } from 'vitest';
import {
  resolveBandConfig, showsNowHeading, nowSideFor, accordionShares, playheadFraction,
  bondConnector, elapsedFraction, easeAccordion, BAND_DEFAULTS,
  placedMovements, activeMovementIndex, roman,
  NOW_SIDE_THRESHOLD, NOW_SIDE_HYSTERESIS, SEGMENT_FLOOR_PX, NOW_PANEL_SHARE,
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

/**
 * THE WAIST IS THE HULL (design wave 9).
 *
 * It used to run from the segment's near edge only as far as the panel's NEAR
 * edge, so the two lit areas met at one point — the waist's bottom corner
 * against the panel's top corner, which the user called "kitty corner" and which
 * is not a shape at all. It now spans from the leftmost of (segment, panel) to
 * the rightmost, which welds the panel's WHOLE top edge and the segment's WHOLE
 * bottom edge by construction.
 *
 * These are asserted as the two properties rather than as coordinates, because
 * the coordinates are what changed and the properties are what must hold.
 */
describe('bondConnector', () => {
  const PANEL = { right: [0.5, 1], left: [0, 0.5] };
  const overlap = ([a, b], [c, d]) => Math.min(b, d) - Math.max(a, c);

  it('always spans the NOW panel entirely, wherever the segment is', () => {
    for (const side of ['left', 'right']) {
      for (let a = 0; a <= 0.9; a += 0.05) {
        const c = bondConnector({ segStart: a, segEnd: a + 0.1, side });
        const waist = [c.start, c.start + c.width];
        expect(
          overlap(waist, PANEL[side]),
          `side ${side}, segment [${a.toFixed(2)}, ${(a + 0.1).toFixed(2)}]: the waist covers `
          + `${overlap(waist, PANEL[side]).toFixed(4)} of the panel's ${NOW_PANEL_SHARE} width`,
        ).toBeCloseTo(NOW_PANEL_SHARE, 9);
      }
    }
  });

  it('always spans the sounding segment entirely, so the join above it is an interval too', () => {
    for (const side of ['left', 'right']) {
      for (let a = 0; a <= 0.9; a += 0.05) {
        const seg = [a, a + 0.1];
        const c = bondConnector({ segStart: seg[0], segEnd: seg[1], side });
        expect(
          overlap([c.start, c.start + c.width], seg),
          `side ${side}, segment [${a.toFixed(2)}, ${(a + 0.1).toFixed(2)}]`,
        ).toBeCloseTo(0.1, 9);
      }
    }
  });

  it('collapses onto the panel when the segment already sits over it', () => {
    const c = bondConnector({ segStart: 0.6, segEnd: 0.8, side: 'right' });
    expect(c.start).toBeCloseTo(0.5, 9);
    expect(c.width).toBeCloseTo(0.5, 9);
    const l = bondConnector({ segStart: 0.1, segEnd: 0.3, side: 'left' });
    expect(l.start).toBeCloseTo(0, 9);
    expect(l.width).toBeCloseTo(0.5, 9);
  });

  it('reaches back to a segment on the far side of the band', () => {
    const c = bondConnector({ segStart: 0.05, segEnd: 0.2, side: 'right' });
    expect(c.start).toBeCloseTo(0.05, 9);
    expect(c.start + c.width).toBeCloseTo(1, 9);
    const l = bondConnector({ segStart: 0.8, segEnd: 0.95, side: 'left' });
    expect(l.start).toBeCloseTo(0, 9);
    expect(l.start + l.width).toBeCloseTo(0.95, 9);
  });

  /**
   * THE CORNER RULE, as geometry. A waist corner takes the radius only where
   * neither of the other two parts continues past that end — anywhere else a
   * radius would cut a notch out of the middle of one shape. Exactly one of each
   * vertical pair can be exterior, because the waist's end IS one of the two
   * edges it was built from.
   */
  it('marks exactly the waist corners that are on the outside of the silhouette', () => {
    // Segment far left, panel right: the left end is the segment's (so the
    // TOP-left is welded and the BOTTOM-left is exposed), the right end is the
    // panel's (so the bottom-right is welded and the top-right is exposed).
    const far = bondConnector({ segStart: 0.05, segEnd: 0.2, side: 'right' }).corners;
    expect(far).toEqual({ tl: false, tr: true, bl: true, br: false });
    // Segment inside the panel: both ends are the panel's, so both bottom
    // corners are welded and both top corners flank the segment.
    const over = bondConnector({ segStart: 0.6, segEnd: 0.8, side: 'right' }).corners;
    expect(over).toEqual({ tl: true, tr: true, bl: false, br: false });
    // Segment exactly the panel: every corner is a weld. This is the degenerate
    // case where the waist disappears into the two panels it joins.
    const flush = bondConnector({ segStart: 0.5, segEnd: 1, side: 'right' }).corners;
    expect(flush).toEqual({ tl: false, tr: false, bl: false, br: false });
    for (const side of ['left', 'right']) {
      for (let a = 0; a <= 0.9; a += 0.05) {
        const { corners } = bondConnector({ segStart: a, segEnd: a + 0.1, side });
        expect(corners.tl && corners.bl, `both left corners exterior at ${a}`).toBe(false);
        expect(corners.tr && corners.br, `both right corners exterior at ${a}`).toBe(false);
      }
    }
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

/**
 * ONE definition of "how far through the piece" (review finding I3).
 *
 * The rail and the band each decide which side the NOW register sits on. They
 * used to compute the input themselves — `(position - first) / span` on the
 * rail, `position / end` in the band — which agree only while the first
 * movement starts at 0. When they disagree the two halves of one shape point at
 * opposite sides of the screen, each held there by its own hysteresis, and
 * nothing reports it.
 */
describe('elapsedFraction', () => {
  it('measures from the first movement, not from the top of the file', () => {
    // A late first movement: tuning, applause, an offset transfer — the same
    // class of fact `musicEndsAt` models at the other end.
    expect(elapsedFraction({ position: 1530, first: 60, end: 3000 })).toBeCloseTo(0.5, 9);
    // The reading the band used to take would have put this at 0.51 — past the
    // threshold while the rail was still short of it.
    expect(1530 / 3000).toBeGreaterThan(NOW_SIDE_THRESHOLD);
  });

  it('agrees with the naive reading exactly when the first movement starts at 0', () => {
    // Which is why both shipped sidecars hid the defect.
    for (const position of [0, 700, 1477, 2955]) {
      expect(elapsedFraction({ position, first: 0, end: 2955 }))
        .toBeCloseTo(position / 2955, 12);
    }
  });

  it('puts the two halves of the bond on the same side of the mark, always', () => {
    // The failure this exists to prevent, driven end to end: with `starts: [60]`
    // and `musicEndsAt: 3000` the two old readings crossed 30s apart.
    const cfg = { nowSide: 'dynamic' };
    let rail = null; let band = null;
    for (let t = 1400; t <= 1600; t += 5) {
      const f = elapsedFraction({ position: t, first: 60, end: 3000 });
      rail = nowSideFor(cfg, f, rail);
      band = nowSideFor(cfg, f, band);
      expect(band, `the halves disagree at ${t}s`).toBe(rail);
    }
  });

  it('refuses to answer before the transport reports an extent', () => {
    // NaN, not 0 — a fraction of zero is a real answer ("at the beginning") and
    // seeding the side from it plays a spurious swap on the first real tick.
    expect(elapsedFraction({ position: 10, first: 0, end: 0 })).toBeNaN();
    expect(elapsedFraction({ position: 10, first: 0, end: null })).toBeNaN();
    expect(elapsedFraction({ position: 10, first: 0, end: undefined })).toBeNaN();
    expect(elapsedFraction({ position: NaN, first: 0, end: 100 })).toBeNaN();
  });

  it('clamps rather than running past either end', () => {
    expect(elapsedFraction({ position: -50, first: 0, end: 100 })).toBe(0);
    expect(elapsedFraction({ position: 500, first: 0, end: 100 })).toBe(1);
  });
});

/**
 * The accordion's easing, evaluated in JS because the widths are no longer
 * animated by CSS (review finding I2) while the bond's travel still is. One
 * curve, two engines.
 */
describe('easeAccordion', () => {
  it('pins both ends', () => {
    expect(easeAccordion(0)).toBe(0);
    expect(easeAccordion(1)).toBe(1);
    expect(easeAccordion(-1)).toBe(0);
    expect(easeAccordion(2)).toBe(1);
  });

  it('is monotonic — a width it drives can never move backwards mid-flight', () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const e = easeAccordion(t);
      expect(e).toBeGreaterThanOrEqual(last - 1e-12);
      last = e;
    }
  });

  it('IS cubic-bezier(0.2, 0.8, 0.2, 1) — the frame’s own --enter-ease', () => {
    // Solved independently here (a coarse parametric sweep for the t whose x
    // matches, then its y) rather than by calling the implementation, so this
    // can fail if the curve is ever quietly retyped.
    const bez = (a, b, u) => (((1 - 3 * b + 3 * a) * u + (3 * b - 6 * a)) * u + 3 * a) * u;
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      let best = 0; let bestErr = Infinity;
      for (let u = 0; u <= 1; u += 0.00005) {
        const err = Math.abs(bez(0.2, 0.2, u) - x);
        if (err < bestErr) { bestErr = err; best = u; }
      }
      expect(easeAccordion(x)).toBeCloseTo(bez(0.8, 1, best), 4);
    }
  });

  it('front-loads, the way an ease-out does', () => {
    expect(easeAccordion(0.25)).toBeGreaterThan(0.25);
    expect(easeAccordion(0.5)).toBeGreaterThan(0.5);
  });
});

describe('the band’s shared numbers', () => {
  it('the two registers are halves, and the waist covers exactly one of them', () => {
    // NOT `expect(NOW_PANEL_SHARE).toBe(0.5)`, which restates the constant and
    // cannot fail for any behaviour. What matters is that the geometry the panel
    // share drives spans the panel — the whole of it, and no more than it needs.
    const c = bondConnector({ segStart: 0.05, segEnd: 0.2, side: 'right' });
    expect(c.start + c.width, 'the waist stops short of the band’s right edge')
      .toBeCloseTo(1, 12);
    expect(1 - Math.max(c.start, 1 - NOW_PANEL_SHARE)).toBeCloseTo(NOW_PANEL_SHARE, 12);
    const l = bondConnector({ segStart: 0.85, segEnd: 0.95, side: 'left' });
    expect(l.start, 'the waist stops short of the band’s left edge').toBeCloseTo(0, 12);
  });

  it('the hysteresis band is the brief’s ~47%, and it is where the swap-back happens', () => {
    const edge = NOW_SIDE_THRESHOLD - NOW_SIDE_HYSTERESIS;
    expect(edge).toBeCloseTo(0.47, 9);
    expect(nowSideFor({ nowSide: 'dynamic' }, edge, 'right')).toBe('right');
    expect(nowSideFor({ nowSide: 'dynamic' }, edge - 1e-9, 'right')).toBe('left');
  });
});

/**
 * WHAT IS SOUNDING — one derivation, for both halves of the band (wave 8).
 *
 * The rail and the listening band each held a near-copy of this loop, and the
 * copies disagreed at exactly the two edges no shipped recording exercises.
 */
describe('which movement is sounding', () => {
  const EROICA = [
    { n: 1, name: 'Allegro con brio', start: 0 },
    { n: 2, name: 'Marcia funebre. Adagio assai', start: 976 },
    { n: 3, name: 'Scherzo. Allegro vivace', start: 1925 },
    { n: 4, name: 'Finale. Allegro molto', start: 2278 },
  ];

  it('places every movement of a well-timed recording, in order', () => {
    expect(placedMovements(EROICA).map((p) => p.start)).toEqual([0, 976, 1925, 2278]);
    expect(placedMovements(EROICA).map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  // The store ships `start: undefined` for an entry it refused, deliberately
  // keeping the slot so `starts` still pairs positionally with `movements`.
  it('declines to place a movement whose start the store refused', () => {
    const bad = [EROICA[0], { ...EROICA[1], start: undefined }, EROICA[2], EROICA[3]];
    const placed = placedMovements(bad);
    expect(placed.map((p) => p.start)).toEqual([0, 1925, 2278]);
    // ...and the survivors still know which authored movement they are, so the
    // band can still reach the right listening notes.
    expect(placed.map((p) => p.index)).toEqual([0, 2, 3]);
  });

  it('declines a start that runs backwards — it cannot bound the segment before it', () => {
    const jumbled = [EROICA[0], { ...EROICA[1], start: 500 }, { ...EROICA[2], start: 200 }, EROICA[3]];
    expect(placedMovements(jumbled).map((p) => p.start)).toEqual([0, 500, 2278]);
  });

  it('declines a start that is not a number at all, or is negative', () => {
    expect(placedMovements([{ start: null }, { start: -5 }, { start: NaN }, {}, null]))
      .toEqual([]);
  });

  // COERCED, the same reading `musicEndsAt` takes (review finding I4): a YAML
  // round-trip can hand a timing back as a string, and refusing that would drop
  // a movement whose start is perfectly well known. It is the values that carry
  // no position — null, negative, NaN — that cannot be placed.
  it('places a start that arrived as a numeric string', () => {
    expect(placedMovements([{ start: '0' }, { start: '976' }]).map((p) => p.start))
      .toEqual([0, 976]);
  });

  it('names the sounding movement inside its own span', () => {
    const placed = placedMovements(EROICA);
    expect(activeMovementIndex({ placed, position: 0, end: 2955 })).toBe(0);
    expect(activeMovementIndex({ placed, position: 975.9, end: 2955 })).toBe(0);
    expect(activeMovementIndex({ placed, position: 976, end: 2955 })).toBe(1);
    expect(activeMovementIndex({ placed, position: 2954, end: 2955 })).toBe(3);
  });

  // The two edges the two copies disagreed about.
  it('says NOTHING is sounding after the music ends', () => {
    const placed = placedMovements(EROICA);
    expect(activeMovementIndex({ placed, position: 2955, end: 2955 })).toBe(-1);
    expect(activeMovementIndex({ placed, position: 3100, end: 2955 })).toBe(-1);
  });

  it('says NOTHING is sounding before the first movement starts', () => {
    // A transfer that opens on tuning or an announcement — `starts: [45, …]`,
    // which the store explicitly permits. The rail used to fall through to
    // "movement I is active" here and light a segment over music that had not
    // begun, while the band printed its "nothing is playing" header.
    const late = placedMovements([{ n: 1, start: 45 }, { n: 2, start: 900 }]);
    expect(activeMovementIndex({ placed: late, position: 0, end: 2955 })).toBe(-1);
    expect(activeMovementIndex({ placed: late, position: 44.9, end: 2955 })).toBe(-1);
    expect(activeMovementIndex({ placed: late, position: 45, end: 2955 })).toBe(0);
  });

  it('answers -1 rather than throwing for an empty or unusable list', () => {
    expect(activeMovementIndex({ placed: [], position: 10, end: 100 })).toBe(-1);
    expect(activeMovementIndex({ placed: null, position: 10, end: 100 })).toBe(-1);
    expect(activeMovementIndex({ placed: placedMovements(EROICA), position: NaN, end: 2955 })).toBe(-1);
  });

  it('sets a movement numeral, falling back to its position where none is authored', () => {
    expect(roman(3, 99)).toBe('III.');
    expect(roman(undefined, 2)).toBe('III.');
    // Past the table, the number itself is a better answer than nothing.
    expect(roman(14, 0)).toBe('14.');
  });
});
