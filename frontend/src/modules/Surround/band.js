import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './dissolve.js';

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
// two React bindings at the foot are memory and a clock, not judgement.
//
// THE ACCORDION HAS EXACTLY ONE CLOCK, and it is `useEasedShares`. Segment
// widths, the playhead, the bond and its connector are all derived from the one
// array it returns, in the same render. Anything animated by CSS *instead*
// would be on a second timeline, and the playhead leaving the boundary it is
// supposed to sit on is precisely what that costs (see the hook's own comment).
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
/* Which movement is sounding — ONE derivation, for both halves of the band     */
/* -------------------------------------------------------------------------- */

/** Movement numerals, as an engraved score sets them. */
export const ROMAN = Object.freeze([
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
]);

/**
 * The index mark for a movement: its authored `n` as a numeral, or its position
 * in the list where the corpus authored no number.
 */
export function roman(n, index) {
  const value = Number.isFinite(n) ? n : index + 1;
  return `${ROMAN[value] ?? value}.`;
}

/**
 * The movements this recording can actually PLACE on a timeline.
 *
 * THE RENDERER MUST NOT DRAW CONFIDENT GARBAGE FROM BAD DATA. The store ships
 * `start: undefined` for any `starts` entry it refused (a quoted timestamp, a
 * null holding a place, a negative) and warns — deliberately keeping the entry
 * so `starts` still pairs positionally with `movements`. Both halves of the band
 * then coerced that with `Number(m?.start) || 0`, which re-anchors a mid-piece
 * movement to the top of the file: a zero-width segment, an out-of-order rail,
 * and a playhead that jumps backwards, all drawn with total confidence.
 *
 * The fix belongs HERE rather than in the store, and the reason is what the two
 * layers each know. The store's `resolvedMovements` is not only a timeline — it
 * carries each movement's name, translation and listen notes, which are
 * RECORDING-INDEPENDENT knowledge and still true when this recording's timing is
 * wrong; and its positional pairing is the thing the mismatch warn is derived
 * from. Dropping an entry there would renumber the list, hide authored teaching
 * material, and destroy the pairing the store went out of its way to preserve.
 * Only the renderer knows what it needs a start FOR — a segment's geometry — so
 * the renderer is the layer that declines to draw one.
 *
 * OUT OF ORDER IS THE SAME DEFECT. A start that runs backwards cannot bound the
 * segment before it either, so it is unplaceable for exactly the same reason.
 *
 * @param {Array<object>} movements the payload's movement list, in authored order.
 * @returns {Array<{index:number, start:number, movement:object}>} the placeable
 *   subset, in rail order, with `index` naming the entry's position in the
 *   AUTHORED list — so a caller can still reach its listen notes.
 */
export function placedMovements(movements) {
  const list = Array.isArray(movements) ? movements : [];
  const out = [];
  let last = -Infinity;
  list.forEach((movement, index) => {
    const raw = movement?.start;
    // TYPE FIRST, THEN COERCE, and the order is the whole point. `Number(null)`
    // is 0 and `Number([])` is 0 — bare coercion turns "this recording never
    // said when this movement starts" into "it starts at the top of the file",
    // which is exactly the re-anchoring this function exists to stop. A NUMERIC
    // STRING is still accepted: a YAML round-trip can hand a timing back as
    // "976", and that is a start we know (the same reading `musicEndsAt` takes,
    // review finding I4).
    if (typeof raw !== 'number' && !(typeof raw === 'string' && raw.trim())) return;
    const start = Number(raw);
    if (!Number.isFinite(start) || start < 0) return;
    if (start < last) return;
    last = start;
    out.push({ index, start, movement });
  });
  return out;
}

/**
 * Which placed movement is sounding, or -1 when none is.
 *
 * ONE derivation, called by the rail and by the listening band, because the two
 * used to hold two near-copies that disagreed at the edges. The rail's loop fell
 * through to `return 0` for a position BEFORE the first movement's start, while
 * the band's fell through to -1 — invisible only because both shipped recordings
 * start at 0. The store explicitly permits `starts: [45, …]` (a transfer with
 * tuning or an announcement at the head), and that recording got a lit "active"
 * segment on the rule above a header saying nothing was playing.
 *
 * -1 IS THE CORRECT ANSWER THERE, and it is the same answer for the same reason
 * the band already gives -1 after `musicEndsAt`: a movement is sounding between
 * its own start and the next one's, and the head of the file is outside every
 * movement's span. Lighting movement I before it begins is a claim about the
 * music that the recording contradicts.
 *
 * @param {object} args
 * @param {Array<{start:number}>} args.placed from `placedMovements`.
 * @param {number} args.position the transport's position, in seconds.
 * @param {number|null} args.end where the music stops, or null for "unbounded".
 * @returns {number} an index into `placed`, or -1.
 */
export function activeMovementIndex({ placed, position, end }) {
  const list = Array.isArray(placed) ? placed : [];
  if (!list.length) return -1;
  const at = Number(position);
  if (!Number.isFinite(at)) return -1;
  const stop = Number(end);
  if (Number.isFinite(stop) && stop > 0 && at >= stop) return -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (at >= list[i].start) return i;
  }
  return -1;
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
 * How far through the PIECE the transport is, 0..1.
 *
 * ONE definition, because two halves of one shape decide their side from it.
 * Review finding I3: the rail measured `(position - first) / (end - first)` and
 * the band measured `position / end`, which agree only while the first movement
 * starts at 0. Both shipped sidecars do — and a sidecar whose first movement
 * starts late (tuning, an offset transfer, the same class of fact `musicEndsAt`
 * models at the other end) would have put the rail's connector and the band's
 * panel on OPPOSITE SIDES for tens of seconds, each held there by its own
 * hysteresis, with no error raised anywhere. The elapsed fraction is a property
 * of the piece, so it is computed once.
 *
 * @returns {number} 0..1, or NaN when the transport has not reported a usable
 *   extent yet — callers must treat that as "no answer", not as zero.
 */
export function elapsedFraction({ position, first = 0, end }) {
  const start = Number.isFinite(first) ? first : 0;
  const stop = Number(end);
  const at = Number(position);
  if (!Number.isFinite(stop) || !Number.isFinite(at)) return NaN;
  const span = stop - start;
  if (!(span > 0)) return NaN;
  const f = (at - start) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

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
/* The React bindings in this file                                             */
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
export function useNowSide(config, fraction, log = null) {
  const nowSide = config?.nowSide ?? BAND_DEFAULTS.nowSide;
  const [side, setSide] = useState(() => nowSideFor(config, fraction, null));
  // RESOLVED DURING RENDER, remembered in the effect. Returning the stored
  // state would put the answer one render behind the fraction that produced it,
  // and that lag is not harmless: the band would commit the OLD side into its
  // dissolve and then swap again a frame later, playing a full band-blanking
  // transition for a side it had never actually shown. `nowSideFor` is pure and
  // `side` is only its previous output, so computing it here writes nothing.
  const resolved = nowSideFor({ nowSide }, fraction, side);
  useEffect(() => {
    // `setState` with an unchanged value bails out before re-rendering, so this
    // running at the transport's 10 Hz costs a comparison and nothing else.
    setSide((prev) => {
      const next = nowSideFor({ nowSide }, fraction, prev);
      // Review finding I5. The crossover is the one decision in this wave with
      // no surface a viewer could point at afterwards — it happens once in a
      // fifty-minute symphony, moves the whole band, and (flag: never yet seen
      // on a real screen) is the thing a prod log has to be able to confirm.
      // Both modules emit it, tagged with their own component, so the log also
      // proves the two halves of the bond agreed on the same tick.
      if (next !== prev && nowSide === 'dynamic') {
        log?.debug?.('surround.band.side', {
          side: next, from: prev, fraction: Number(fraction.toFixed?.(4) ?? fraction),
        });
      }
      return next;
    });
  }, [nowSide, fraction, log]);
  return nowSide === 'dynamic' ? resolved : (nowSide === 'left' ? 'left' : 'right');
}

/* -------------------------------------------------------------------------- */
/* The accordion's clock                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `cubic-bezier(0.2, 0.8, 0.2, 1)` — the frame's `--enter-ease`, evaluated in JS.
 *
 * It exists because the accordion's widths are no longer animated by CSS (see
 * `useEasedShares`), and the rest of the frame's motion still is: the bond's
 * travel between segments and the band's panel slide both ride the same curve.
 * One easing, two engines, so nothing in the band moves on a different feel.
 *
 * Newton's method on x(t) for the parameter, then y at it — the same solve a
 * browser does, to a tolerance far finer than a pixel at these durations.
 */
export function easeAccordion(t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (x === 0 || x === 1) return x;
  const X1 = 0.2; const X2 = 0.2; const Y1 = 0.8; const Y2 = 1;
  const cx = (u) => (((1 - 3 * X2 + 3 * X1) * u + (3 * X2 - 6 * X1)) * u + 3 * X1) * u;
  const dcx = (u) => (3 * (1 - 3 * X2 + 3 * X1) * u + 2 * (3 * X2 - 6 * X1)) * u + 3 * X1;
  const cy = (u) => (((1 - 3 * Y2 + 3 * Y1) * u + (3 * Y2 - 6 * Y1)) * u + 3 * Y1) * u;
  let u = x;
  for (let i = 0; i < 8; i += 1) {
    const err = cx(u) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = dcx(u);
    if (Math.abs(d) < 1e-9) break;
    u -= err / d;
  }
  return cy(Math.min(1, Math.max(0, u)));
}

/**
 * Animate the rail's shares in JS, and hand back the array that is on screen.
 *
 * REVIEW FINDING I2 — THE REASON THIS EXISTS. The widths used to be animated by
 * a CSS `transition: width` over `ACCORDION_MS` while the playhead ran on its
 * own 120 ms ramp against the TARGET shares. At a movement boundary the head
 * therefore reached the widened solution in ~120 ms while the painted boundary
 * was still ~300 ms away from it — measured on the Eroica at 1280x720, the
 * cursor sat ~70 px inside the elapsed fill's still-painted right edge for that
 * window. The brief's instruction was explicit ("Do not let the accordion
 * desynchronise the head from the boundaries"), and two clocks cannot satisfy
 * it however either one is tuned.
 *
 * So there is ONE clock, and it is this one. The shares are interpolated here;
 * the segment widths, the playhead, the bond and its connector are all derived
 * from the array this returns, in the same render. They cannot drift because
 * there is nothing left for them to drift against.
 *
 * The loop runs only while a move is in flight — a movement boundary is minutes
 * apart, so this is idle for all but ~420 ms of a symphony.
 *
 * @param {number[]} target the solved shares.
 * @param {number} durationMs
 * @returns {{shares:number[], moving:boolean}}
 */
export function useEasedShares(target, durationMs) {
  const [, tick] = useState(0);
  const from = useRef(target);
  const current = useRef(target);
  const startedAt = useRef(0);
  const frame = useRef(0);
  const moving = useRef(false);

  // A different piece, or a piece with a different number of movements, is not
  // a move to animate — it is a new rail. Snap.
  const sameShape = current.current.length === target.length;

  useEffect(() => {
    if (!sameShape) {
      from.current = target;
      current.current = target;
      moving.current = false;
      return undefined;
    }
    if (current.current.every((v, i) => Math.abs(v - target[i]) < 1e-6)) return undefined;
    // Reduced motion: the widths snap. The accordion is layout, and layout that
    // moves is exactly what the preference asks to stop.
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      from.current = target;
      current.current = target;
      moving.current = false;
      tick((n) => n + 1);
      return undefined;
    }
    from.current = current.current.slice();
    startedAt.current = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    moving.current = true;
    const step = () => {
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      const t = Math.min(1, (now - startedAt.current) / Math.max(1, durationMs));
      const e = easeAccordion(t);
      current.current = from.current.map((v, i) => v + (target[i] - v) * e);
      if (t >= 1) {
        current.current = target.slice();
        moving.current = false;
        tick((n) => n + 1);
        return;
      }
      tick((n) => n + 1);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, durationMs, sameShape]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  if (!sameShape) return { shares: target, moving: false };
  return { shares: current.current, moving: moving.current };
}
