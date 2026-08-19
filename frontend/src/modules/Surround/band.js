import { useEffect, useState } from 'react';

// frontend/src/modules/Surround/band.js
//
// THE BAND'S SHARED MIND.
//
// Under the video there are two modules — the movement rail (`MovementMap`) and
// the split listening band (`CueTicker`) — and since design wave 7 they are no
// longer independent. The rail's active segment and the band's NOW register are
// drawn as ONE SHAPE (the bond), which means both modules have to agree, on the
// same tick, about three things they used to decide alone:
//
//   * WHICH SIDE the NOW register is on. The rail draws the bond's connector
//     toward it; the band puts the register there.
//   * WHETHER the NOW register prints a movement heading. It is the rail's
//     business (the heading is redundant while the rail names movements) and the
//     band's element.
//   * HOW WIDE each segment is rendered. The accordion widens the sounding
//     movement, which moves the bond and re-derives the playhead.
//
// Two modules agreeing by each re-deriving the same answer from the same props
// is only safe if the derivation lives in ONE place. That is this file. Every
// DECISION here is a pure function or a frozen constant — which is what makes
// the accordion's arithmetic unit-testable without rendering anything — and the
// single React binding at the foot (`useNowSide`) is memory, not judgement.
//
// CONFIG. The keys live on the surround DEFINITION (`definition.band.*`, from
// `_surrounds/<id>.yml`), beside `regions` and `collapse` — they are decisions
// about how this frame's band is laid out, which is exactly what a definition
// is for. Every reader goes through `resolveBandConfig`, so an unauthored,
// misspelled or wrong-typed value degrades to the documented default rather
// than reaching a component.

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

/** Which register sits where. `dynamic` follows the playhead — see `nowSideFor`. */
export const NOW_SIDES = Object.freeze(['right', 'left', 'dynamic']);
/** Whether the NOW register prints the sounding movement's name. */
export const NOW_HEADINGS = Object.freeze(['auto', 'always', 'never']);
/** Whether the rail itself prints movement names, or is bars only. */
export const RAIL_DENSITIES = Object.freeze(['names', 'bars']);

export const BAND_DEFAULTS = Object.freeze({
  /** Today's behaviour, unchanged: the NOW register on the right. */
  nowSide: 'right',
  /**
   * `auto` — print the heading only where the rail is NOT already naming
   * movements. With the rail in its normal `names` density the movement heading
   * is six inches above the register, and printing it twice is the repetition
   * design wave 7 exists to remove.
   */
  nowHeading: 'auto',
  /**
   * What the rail prints. `names` is the shipped rail; `bars` is the hook the
   * compact / high-density rail will set, and it is what makes `nowHeading:
   * auto` resolve the other way — with no names on the rule, the band is the
   * only surface left that can say what is sounding.
   */
  railDensity: 'names',
});

const oneOf = (value, allowed, fallback) => (
  typeof value === 'string' && allowed.includes(value.trim()) ? value.trim() : fallback
);

/**
 * Read the band's config off a resolved surround payload.
 *
 * @param {object|null} data the module contract's `data` prop.
 * @returns {{nowSide:string, nowHeading:string, railDensity:string}} always a
 *   complete, valid object — never a partial one, so no call site needs `??`.
 */
export function resolveBandConfig(data) {
  const band = data?.definition?.band;
  const raw = (band && typeof band === 'object' && !Array.isArray(band)) ? band : {};
  return {
    nowSide: oneOf(raw.nowSide, NOW_SIDES, BAND_DEFAULTS.nowSide),
    nowHeading: oneOf(raw.nowHeading, NOW_HEADINGS, BAND_DEFAULTS.nowHeading),
    railDensity: oneOf(raw.railDensity, RAIL_DENSITIES, BAND_DEFAULTS.railDensity),
  };
}

/**
 * Does the NOW register print the sounding movement's heading?
 *
 * @param {{nowHeading:string, railDensity:string}} config resolved config.
 * @returns {boolean}
 */
export function showsNowHeading(config) {
  if (config?.nowHeading === 'always') return true;
  if (config?.nowHeading === 'never') return false;
  // `auto`: the rail's names ARE the heading. Print it here only when the rail
  // has none of its own.
  return config?.railDensity === 'bars';
}

/* -------------------------------------------------------------------------- */
/* Which side the NOW register sits on                                         */
/* -------------------------------------------------------------------------- */

/**
 * Where `dynamic` puts the register. Under half-way the NOW register is on the
 * LEFT, because that is the half of the rail the active segment is in, and a
 * short bond is a legible bond. At or past half-way both move to the right.
 */
export const NOW_SIDE_THRESHOLD = 0.5;
/**
 * How far back the playhead has to fall before the register swaps BACK.
 *
 * Without it a scrub sitting on 50%, or a rounding wobble at 0.4999/0.5001,
 * flaps the whole band's layout at 10 Hz. 0.03 of the piece is ~90 s of the
 * Eroica and ~19 s of Vivaldi's Spring — long enough that no scrub lands inside
 * it twice by accident, short enough that a genuine seek backwards past the
 * half-way mark still swaps.
 */
export const NOW_SIDE_HYSTERESIS = 0.03;

/**
 * Resolve the NOW register's side for this instant.
 *
 * PURE, and deliberately so: the hysteresis needs the PREVIOUS answer, and
 * passing it in (rather than closing over a ref) is what lets the two modules
 * that call this stay in lockstep — they hold their own previous value but feed
 * this function the same fraction on the same tick, so they cannot disagree.
 *
 * @param {{nowSide:string}} config resolved band config.
 * @param {number} fraction elapsed fraction of the PIECE, 0..1.
 * @param {string|null} previous the side this caller last resolved, or null on
 *   the first call (seeded from the bare threshold, with no hysteresis).
 * @returns {'left'|'right'}
 */
export function nowSideFor(config, fraction, previous = null) {
  const side = config?.nowSide ?? BAND_DEFAULTS.nowSide;
  if (side === 'left' || side === 'right') return side;
  if (!Number.isFinite(fraction)) return previous === 'right' ? 'right' : 'left';
  if (fraction >= NOW_SIDE_THRESHOLD) return 'right';
  if (fraction < NOW_SIDE_THRESHOLD - NOW_SIDE_HYSTERESIS) return 'left';
  // Inside the band: hold whatever we already showed. On the very first call
  // there is nothing to hold, so the bare threshold decides — which makes a
  // fresh mount deterministic from `fraction` alone.
  if (previous === 'left' || previous === 'right') return previous;
  return fraction >= NOW_SIDE_THRESHOLD ? 'right' : 'left';
}

/* -------------------------------------------------------------------------- */
/* The accordion                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How long a segment takes to widen or compress.
 *
 * The frame's existing timing constants are the ENTRANCE (`entrance.js`, one
 * arrival gesture) and the DISSOLVE (`dissolve.js`, one content swap). An
 * accordion is neither: it is a layout move, and it happens on a movement
 * boundary — a beat the viewer is already watching. 420 ms is the chrome's own
 * `ENTER_MS`, reused as a value rather than imported as a meaning: the two are
 * the same *feel* (one considered move) and would be wrong to couple, because
 * retiming the entrance must not retime the rail.
 */
export const ACCORDION_MS = 420;

/**
 * The narrowest a compressed neighbour may be drawn, in pixels.
 *
 * MEASURED, not chosen. A segment has to show its numeral, some glyphs of its
 * name and the ellipsis that says there is more; below that it is an unlabelled
 * stripe and the rail has stopped being a contents page.
 *
 * A segment's chrome — the text inset (0.55em), the numeral's gutter, and the
 * inset on the far side (0.5em) — is 46.5px, constant at every screen in the
 * fleet because it is built entirely from `em`/`ch` of one rem-fixed size.
 * Swept in the harness against the real compiled sheet and the real string
 * ("III. Scherzo. Allegro vivace"), counting the glyphs that actually paint
 * inside the clipped box: 48px shows NONE (the ellipsis alone), 56px one, 64px
 * two, 72px three ("Sch…"), 88px five ("Scherzo…"). Three glyphs and the
 * ellipsis is the point at which a compressed neighbour still reads as a named
 * movement rather than as a stripe, so the floor is 72.
 */
export const SEGMENT_FLOOR_PX = 72;

const EPS = 1e-6;

/**
 * Solve the rail's rendered segment widths.
 *
 * THE RULE THE USER SET. Everything is one line with an ellipsis when inactive;
 * the sounding movement widens until its heading and its translation each fit on
 * one line with nothing cut. Neighbours give up the difference in proportion to
 * their own natural (duration-derived) widths, and stop giving at the floor.
 * When the ideal width would starve them, the active segment takes what is
 * available and keeps its ellipsis — degrade, do not break.
 *
 * NON-UNIFORM TIME IS THE ACCEPTED PRICE. The rail stops being a linear time
 * axis the moment a segment is not its duration's share of the rule. The
 * playhead stays truthful WITHIN a segment (see `playheadFraction`), which is
 * the property that actually matters: it still reaches a boundary exactly when
 * the music does.
 *
 * @param {object} args
 * @param {number[]} args.natural each movement's share of the piece, 0..1,
 *   summing to 1 (the duration-derived widths).
 * @param {number} args.activeIndex the sounding movement, or -1 for none.
 * @param {number} args.railPx the rule's measured width in pixels.
 * @param {number} args.desiredPx the active segment's ideal rendered width — the
 *   width at which neither its heading nor its translation is cut.
 * @param {number} [args.floorPx] the compressed-neighbour floor.
 * @returns {number[]} rendered shares, 0..1, summing to 1. Identical to
 *   `natural` whenever no widening applies.
 */
export function accordionShares({
  natural, activeIndex, railPx, desiredPx, floorPx = SEGMENT_FLOOR_PX,
}) {
  const shares = Array.isArray(natural) ? natural.map((n) => (Number.isFinite(n) ? n : 0)) : [];
  const n = shares.length;
  if (n === 0) return shares;
  // Nothing sounding (the applause), a single movement with no neighbour to
  // compress, or a rail we have not measured yet: the rail is its own timeline.
  if (n < 2 || activeIndex < 0 || activeIndex >= n) return shares;
  if (!(railPx > 0) || !Number.isFinite(desiredPx)) return shares;

  const px = shares.map((s) => s * railPx);
  const extra = desiredPx - px[activeIndex];
  // The active segment is never made NARROWER than its duration earns it. A
  // short name in a long movement keeps the long movement's width; the
  // accordion only ever opens.
  if (!(extra > EPS)) return shares;

  const floor = Math.max(0, floorPx);
  const donors = [];
  let available = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === activeIndex) continue;
    const slack = px[i] - floor;
    if (slack > EPS) { donors.push(i); available += slack; }
  }
  if (!(available > EPS)) return shares;

  const take = Math.min(extra, available);
  const out = px.slice();
  let remaining = take;
  // Water-filling. One proportional pass would overshoot on any donor already
  // close to the floor; clipping there and re-spreading the shortfall over the
  // donors that still have slack is what keeps the split proportional AND
  // inside every floor. It converges in at most one round per donor.
  for (let guard = 0; guard <= n && remaining > EPS; guard += 1) {
    const pool = donors.filter((i) => out[i] - floor > EPS);
    if (!pool.length) break;
    const base = pool.reduce((sum, i) => sum + px[i], 0);
    if (!(base > EPS)) break;
    let taken = 0;
    for (const i of pool) {
      const give = Math.min(remaining * (px[i] / base), out[i] - floor);
      out[i] -= give;
      taken += give;
    }
    if (taken <= EPS) break;
    remaining -= taken;
  }
  out[activeIndex] += (take - remaining);

  return out.map((w) => w / railPx);
}

/**
 * Where the playhead sits on the rule, 0..1 — measured against the RENDERED
 * widths, not the durations.
 *
 * THIS IS THE LAW THE ACCORDION MUST NOT BREAK. Inside a segment the head is
 * still that segment's own elapsed fraction, so it arrives at the segment's
 * right edge at exactly the second the music crosses the boundary. Reading the
 * head off the piece's overall elapsed fraction — which is what the rail did
 * before the accordion existed, and which was correct while every width was its
 * duration's share — would put the cursor mid-segment at a boundary the moment
 * any segment is drawn wider or narrower than its time.
 *
 * @param {object} args
 * @param {Array<{start:number, stop:number}>} args.segments in rail order.
 * @param {number[]} args.shares the RENDERED shares from `accordionShares`.
 * @param {number} args.position the transport's position, in seconds.
 * @param {number} args.end where the music stops (musicEndsAt, or the duration).
 * @returns {number} 0..1.
 */
export function playheadFraction({ segments, shares, position, end }) {
  const segs = Array.isArray(segments) ? segments : [];
  if (!segs.length) return 0;
  const first = Number(segs[0].start) || 0;
  if (!(Number.isFinite(position))) return 0;
  if (position <= first) return 0;
  if (Number.isFinite(end) && position >= end) return 1;

  let acc = 0;
  for (let i = 0; i < segs.length; i += 1) {
    const share = Number(shares?.[i]);
    const w = Number.isFinite(share) ? share : 0;
    const start = Number(segs[i].start) || 0;
    const stop = Number(segs[i].stop) || 0;
    const length = stop - start;
    if (position < stop || i === segs.length - 1) {
      const inside = length > 0 ? (position - start) / length : 0;
      return acc + w * Math.min(1, Math.max(0, inside));
    }
    acc += w;
  }
  return 1;
}

/* -------------------------------------------------------------------------- */
/* The bond's geometry                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The NOW register's share of the band's width. The two registers are halves
 * (`CueTicker.scss`, "HALF EACH, and equally"), so the panel the rail's
 * connector has to reach is exactly one of them.
 */
export const NOW_PANEL_SHARE = 0.5;

/**
 * The connector: the horizontal interval, in shares of the rule, that the rail
 * has to bridge to reach the NOW panel.
 *
 * Returns an interval of zero width whenever the active segment already sits
 * over the panel — "when the active segment sits directly above the panel, the
 * two simply touch". Nothing is drawn in that case; the segment's own box and
 * the panel's box are already contiguous.
 *
 * @param {object} args
 * @param {number} args.segStart the active segment's left edge, 0..1 of the rule.
 * @param {number} args.segEnd its right edge, 0..1.
 * @param {'left'|'right'} args.side which side the NOW panel is on.
 * @returns {{start:number, width:number}} in shares of the rule.
 */
export function bondConnector({ segStart, segEnd, side }) {
  const panelStart = side === 'left' ? 0 : 1 - NOW_PANEL_SHARE;
  const panelEnd = side === 'left' ? NOW_PANEL_SHARE : 1;
  const a = Number.isFinite(segStart) ? segStart : 0;
  const b = Number.isFinite(segEnd) ? segEnd : 0;
  // Overlapping intervals need no bridge.
  if (b > panelStart && a < panelEnd) return { start: a, width: 0 };
  if (b <= panelStart) return { start: b, width: panelStart - b };
  return { start: panelEnd, width: a - panelEnd };
}

export default resolveBandConfig;

/* -------------------------------------------------------------------------- */
/* The one React binding in this file                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hold the NOW register's side across ticks, with the hysteresis applied.
 *
 * It lives HERE rather than in either module because both of them need the same
 * answer on the same tick — the rail draws the bond's connector toward the
 * panel, the band draws the panel — and two copies of a stateful rule is two
 * chances for the halves of one shape to point in different directions. The
 * decision itself is `nowSideFor` above and stays pure; this is only the memory.
 *
 * @param {{nowSide:string}} config resolved band config.
 * @param {number} fraction elapsed fraction of the piece, 0..1.
 * @returns {'left'|'right'}
 */
export function useNowSide(config, fraction) {
  const nowSide = config?.nowSide ?? BAND_DEFAULTS.nowSide;
  const [side, setSide] = useState(() => nowSideFor(config, fraction, null));
  useEffect(() => {
    // `setState` with an unchanged value bails out before re-rendering, so this
    // running at the transport's 10 Hz costs a comparison and nothing else.
    setSide((prev) => nowSideFor({ nowSide }, fraction, prev));
  }, [nowSide, fraction]);
  return nowSide === 'dynamic' ? side : (nowSide === 'left' ? 'left' : 'right');
}
