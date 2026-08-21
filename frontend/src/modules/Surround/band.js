import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './dissolve.js';

// frontend/src/modules/Surround/band.js
//
// THE BAND'S SHARED MIND.
//
// Under the video there are two modules — the segment rail (`SegmentMap`) and
// the split listening band (`CueTicker`) — and since design wave 7 they are no
// longer independent. The rail's active segment and the band's NOW register are
// drawn as ONE SHAPE (the bond), which means both modules have to agree, on the
// same tick, about three things they used to decide alone:
//
//   * WHICH SIDE the NOW register is on. The rail draws the bond's connector
//     toward it; the band puts the register there.
//   * WHETHER the NOW register prints a segment heading. It is the rail's
//     business (the heading is redundant while the rail names segments) and the
//     band's element.
//   * HOW WIDE each segment is rendered. The accordion widens the sounding
//     segment, which moves the bond and re-derives the playhead.
//
// Two modules agreeing by each re-deriving the same answer from the same props
// is only safe if the derivation lives in ONE place. That is this file. Every
// DECISION here is a pure function or a frozen constant — which is what makes
// the accordion's arithmetic unit-testable without rendering anything — and the
// two React bindings at the foot are memory and a clock, not judgement.
//
// THE ACCORDION HAS EXACTLY ONE CLOCK, and it is `useEasedVector`. Segment
// widths, the playhead, the bond and its connector are all derived from the one
// vector it returns, in the same render. Anything animated by CSS *instead*
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
/** Whether the NOW register prints the sounding segment's name. */
export const NOW_HEADINGS = Object.freeze(['auto', 'always', 'never']);
/** Whether the rail itself prints segment names, or is bars only. */
export const RAIL_DENSITIES = Object.freeze(['names', 'bars']);

export const BAND_DEFAULTS = Object.freeze({
  /** Today's behaviour, unchanged: the NOW register on the right. */
  nowSide: 'right',
  /**
   * `auto` — print the heading only where the rail is NOT already naming
   * segments. With the rail in its normal `names` density the segment heading
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
 * Does the NOW register print the sounding segment's heading?
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
/* Which segment is sounding — ONE derivation, for both halves of the band     */
/* -------------------------------------------------------------------------- */

/** Segment numerals, as an engraved score sets them. */
export const ROMAN = Object.freeze([
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
]);

/** The largest index the Roman table can set. */
export const ROMAN_CEILING = ROMAN.length - 1;

/**
 * ONE NOTATION PER RAIL — the numbering decision of task 6c, settled here
 * because it is the rail's decision and not any one segment's.
 *
 * THE `n` FIELD IS AUTHORITATIVE for numbering, against the number an authored
 * name may also carry ("No. 5 in F-sharp major, Op. 15 No. 2"). Three reasons,
 * and none of them is preference:
 *
 *   * IT IS THE ONLY UNIVERSAL ADDRESS. A movement rail's names carry no number
 *     at all ("Allegro con brio"), so a rail that numbered from the name would
 *     have nothing to print on the piece this frame was built for.
 *   * THE CHIP CAN ONLY BE RENDERED FROM A FIELD. A chip's mark is a number,
 *     not a prefix parsed off a title with a regular expression, and the chip
 *     has to agree with what the active segment shows.
 *   * EVERYTHING ELSE ALREADY KEYS OFF IT — `segmentAt`, the rail's logging, the
 *     NOW register's own numeral.
 *
 * So the gutter keeps its mark and the CORPUS is where a name that restates it
 * gets fixed (see the task report). What this function fixes is the defect that
 * made the doubling visible: `ROMAN` runs out at XII, so a rail of twenty-one
 * set `…X. XI. XII. 13. 14. …` — two notations in one gutter, changing partway
 * along. A numeral system is a property of the LIST, not of an entry in it.
 *
 * @param {Array<{n:*}>} segments the rail's segments, in rail order.
 * @returns {'roman'|'arabic'} `roman` only when every mark on this rail can be
 *   set in it; otherwise the whole rail sets figures.
 */
export function numeralStyle(segments) {
  const list = Array.isArray(segments) ? segments : [];
  for (let i = 0; i < list.length; i += 1) {
    const n = list[i]?.n;
    const value = Number.isFinite(n) ? n : i + 1;
    if (!(value >= 1 && value <= ROMAN_CEILING)) return 'arabic';
  }
  return 'roman';
}

/**
 * The index mark's TEXT, with no terminating point: what a chip carries.
 *
 * @param {*} n the authored number, or anything else for "not authored".
 * @param {number} index the entry's position in the rail.
 * @param {'roman'|'arabic'} [style] from `numeralStyle` — one per rail.
 */
export function numeralText(n, index, style = 'roman') {
  const value = Number.isFinite(n) ? n : index + 1;
  if (style === 'roman' && ROMAN[value]) return ROMAN[value];
  return String(value);
}

/**
 * The index mark for a segment, as the gutter sets it: the numeral and its
 * point. `numeralText` is the same mark without the point, for the chip.
 */
export function numeral(n, index, style = 'roman') {
  return `${numeralText(n, index, style)}.`;
}

/**
 * The segments this recording can actually PLACE on a timeline.
 *
 * THE RENDERER MUST NOT DRAW CONFIDENT GARBAGE FROM BAD DATA. The store ships
 * `start: undefined` for any `starts` entry it refused (a quoted timestamp, a
 * null holding a place, a negative) and warns — deliberately keeping the entry
 * so `starts` still pairs positionally with `segments`. Both halves of the band
 * then coerced that with `Number(m?.start) || 0`, which re-anchors a mid-piece
 * segment to the top of the file: a zero-width segment, an out-of-order rail,
 * and a playhead that jumps backwards, all drawn with total confidence.
 *
 * The fix belongs HERE rather than in the store, and the reason is what the two
 * layers each know. The store's `resolvedSegments` is not only a timeline — it
 * carries each segment's name, translation and listen notes, which are
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
 * @param {Array<object>} segments the payload's segment list, in authored order.
 * @returns {Array<{index:number, start:number, segment:object}>} the placeable
 *   subset, in rail order, with `index` naming the entry's position in the
 *   AUTHORED list — so a caller can still reach its listen notes.
 */
export function placedSegments(segments) {
  const list = Array.isArray(segments) ? segments : [];
  const out = [];
  let last = -Infinity;
  list.forEach((segment, index) => {
    const raw = segment?.start;
    // TYPE FIRST, THEN COERCE, and the order is the whole point. `Number(null)`
    // is 0 and `Number([])` is 0 — bare coercion turns "this recording never
    // said when this segment starts" into "it starts at the top of the file",
    // which is exactly the re-anchoring this function exists to stop. A NUMERIC
    // STRING is still accepted: a YAML round-trip can hand a timing back as
    // "976", and that is a start we know (the same reading `musicEndsAt` takes,
    // review finding I4).
    if (typeof raw !== 'number' && !(typeof raw === 'string' && raw.trim())) return;
    const start = Number(raw);
    if (!Number.isFinite(start) || start < 0) return;
    if (start < last) return;
    last = start;
    out.push({ index, start, segment });
  });
  return out;
}

/**
 * The COMPOSED rail's drawable segments.
 *
 * `payload.segments` is a different list from `payload.pieceSegments` and the
 * difference is the whole of this wave: it is every PART's segments
 * concatenated onto one sounding-time rail, each carrying the media item it
 * lives in (`contentId`), its span inside that item (`start`/`end`), and where
 * it sits on the container's own axis (`offset`/`duration`). A single work has
 * one part, so it has one of these too — the shape is the general case, not the
 * container's special case.
 *
 * WHY A DIFFERENT FILTER FROM `placedSegments`. That one asks "did this
 * recording tell us where this segment STARTS", because it has to derive every
 * width from the gaps between starts. Here the backend has already done the
 * arithmetic and published `duration`, so the only question left is whether the
 * segment has any width at all. A zero-duration segment is the store's
 * documented way of saying "this segment's timing was never authored" — it
 * shares its offset with whatever follows and can never be current
 * (`segments.js`) — and drawing it would put an unclickable hairline on the
 * rail claiming a piece of music occupies no time.
 *
 * @param {Array<object>} segments `payload.segments`, in rail order.
 * @returns {Array<{index:number, segment:object}>} the drawable subset, with
 *   `index` naming the entry's position in the FULL rail — which is what
 *   `segmentAt` returns, so a caller can map one onto the other.
 */
export function placedRailSegments(segments) {
  const list = Array.isArray(segments) ? segments : [];
  const out = [];
  list.forEach((segment, index) => {
    if (!segment) return;
    const duration = Number(segment.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    out.push({ index, segment });
  });
  return out;
}

/**
 * WIDTHS IN HIGH DENSITY: TYPOGRAPHY, NOT TIME.
 *
 * The rail has measured width in sounding seconds since it was built, and for
 * a symphony that is right — four segments across a rule, and the long one
 * looks long. It stops being right the moment the rail chips. A 29px segment
 * cannot tell anyone that a movement runs four and a half minutes; the pixel is
 * too small to carry the number. Spending width on proportion there buys
 * nothing, and it costs the one thing the rail still could communicate, which
 * is WHAT each segment is.
 *
 * So in chip mode width is a typographic measurement:
 *
 *   - a CHIP takes the same width as every other chip. They are all setting a
 *     numeral, so they all need the same room, and equal widths make them read
 *     as a countable series rather than as a ragged bar chart.
 *   - the SOUNDING segment takes the width its own title needs, set whole.
 *   - a FOLDED Part takes the width its Part title needs. A fold is a label,
 *     and a label nobody can read is a hatched stub.
 *
 * The claims are measured in px and then normalised to the rule, so the RATIOS
 * are text-driven even where the absolute pixels get scaled.
 *
 * WHEN THE CLAIMS OVERRUN, THE CHIPS GIVE. The titles are the things that must
 * stay whole — that is the guarantee the whole density ladder exists to keep —
 * so the chips compress first, down to their floor and past it if the rail is
 * genuinely out of room. A rail that cannot seat its chips at the floor has
 * already failed to a lower tier by other means; this never cuts a title to
 * rescue it.
 *
 * COMPOSES WITH THE ACCORDION rather than fighting it. `accordionShares` widens
 * the sounding segment toward `desiredPx` and gives up when the segment is
 * already that wide — which, on this vector, it always is. So the accordion
 * becomes a no-op in chip mode instead of widening a segment that was already
 * sized to its title.
 *
 * @param {object} args
 * @param {Array<{collapsed?:boolean}>} args.segments the drawn rail.
 * @param {number[]} args.needs   each segment's own label width in px, chrome excluded.
 * @param {number} args.chromePx  the segment furniture, measured once.
 * @param {number} args.railPx    the rule's width.
 * @param {number} args.activeIndex the sounding segment, or -1.
 * @param {number} [args.chipPx]  the uniform chip claim.
 * @returns {number[]} shares summing to 1.
 */
export function densityShares({
  segments, needs, chromePx, railPx, activeIndex, chipPx = SEGMENT_CHIP_FLOOR_PX,
}) {
  const list = Array.isArray(segments) ? segments : [];
  const n = list.length;
  if (n === 0) return [];

  const need = (i) => {
    const v = Number(needs?.[i]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const rail = Number(railPx);

  // Unmeasured: nothing to be text-driven ABOUT yet, so an even rail — which is
  // also the honest first paint, since every segment is about to be measured.
  if (!Number.isFinite(rail) || !(rail > 0)) return list.map(() => 1 / n);

  const isTitled = (i) => i === activeIndex || !!list[i]?.collapsed;
  // A titled segment claims chrome + its text; a chip claims the uniform chip.
  const claims = list.map((_, i) => (isTitled(i)
    ? idealWidth({ chromePx, needPx: need(i) })
    : Math.max(1, Number(chipPx) || SEGMENT_CHIP_FLOOR_PX)));

  const total = claims.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return list.map(() => 1 / n);

  // Fits: normalise, which scales every claim by the same factor and so keeps
  // the RATIOS the text asked for while filling the rule. Handing the surplus
  // to the chips instead was tried and is wrong — with few chips it inflates
  // one of them into the widest thing on the rail, which is the ragged bar
  // chart this mode exists to abolish.
  if (total <= rail) return claims.map((c) => c / total);

  // Overrun: the CHIPS give. Titles keep what they asked for as long as they
  // fit at all; if the titles alone overrun, everything scales together —
  // there is no arrangement left and pretending otherwise would cut a title.
  const titled = claims.reduce((a, c, i) => a + (isTitled(i) ? c : 0), 0);
  const chipCount = n - claims.filter((_, i) => isTitled(i)).length;
  if (chipCount > 0 && titled < rail) {
    const perChip = (rail - titled) / chipCount;
    const out = claims.map((c, i) => (isTitled(i) ? c : perChip));
    const s = out.reduce((a, b) => a + b, 0);
    return out.map((c) => c / s);
  }
  return claims.map((c) => c / total);
}

/**
 * WHAT A FOLDED PART IS WORTH ON THE RAIL — a placeholder, not its own time.
 *
 * THIS DELIBERATELY BREAKS PROPORTION, and that is the whole feature. The first
 * cut of the accordion gave each fold exactly the width of everything it
 * replaced, on the reasoning that the rail should stay one honest clock. It
 * solved nothing: Messiah's Part Two is 23 of 53 numbers but only about a third
 * of the running time, so folding the other two Parts still left those 23
 * crammed into a third of the rail — the same cluster, two segments shorter.
 *
 * A fold is a MARKER saying "there is a Part here, and it is not the one
 * sounding". A marker needs to be legible and nothing more, so every fold takes
 * the same small share whatever it stands in for, and the sounding Part takes
 * everything they gave up. A three-minute Part and a fifty-minute Part fold to
 * the same chip, because as markers they carry the same information.
 *
 * THE PLAYHEAD SURVIVES THIS FOR FREE. `playheadFraction` accumulates RENDERED
 * shares and interpolates by time only INSIDE the segment it lands in, so a
 * rail whose widths no longer track the clock still puts the playhead exactly
 * where the clock says — including while a fold is sounding, where it crosses
 * the marker at a constant rate. Nothing had to learn about the discontinuity.
 *
 * @param {Array<{duration:number, collapsed?:boolean}>} segments
 * @returns {number[]} shares summing to 1, index-aligned with `segments`.
 */
export const FOLD_SHARE = 0.035;
/** No matter how many Parts fold, they may not take more of the rail than this. */
export const FOLD_SHARE_CAP = 0.25;

export function foldedShares(segments, { foldShare = FOLD_SHARE, cap = FOLD_SHARE_CAP } = {}) {
  const list = Array.isArray(segments) ? segments : [];
  if (list.length === 0) return [];

  const durationOf = (c) => {
    const d = Number(c?.duration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  };
  const folds = list.filter((c) => c?.collapsed);
  const drawnTotal = list.reduce((n, c) => n + (c?.collapsed ? 0 : durationOf(c)), 0);

  // Nothing folded: plain proportion, exactly as the rail has always drawn it.
  if (folds.length === 0) {
    const total = list.reduce((n, c) => n + durationOf(c), 0);
    if (!(total > 0)) return list.map(() => 0);
    return list.map((c) => durationOf(c) / total);
  }

  // Everything folded (no sounding Part on this rail) — share it out evenly
  // rather than by duration, since as markers they are all worth the same.
  if (!(drawnTotal > 0)) return list.map((c) => (c?.collapsed ? 1 / folds.length : 0));

  // The folds' total is capped so a work with many Parts cannot crowd out the
  // one being sung.
  const each = Math.min(foldShare, cap / folds.length);
  const remainder = 1 - each * folds.length;
  return list.map((c) => (c?.collapsed ? each : (durationOf(c) / drawnTotal) * remainder));
}

/**
 * THE ACCORDION: DRAW THE GROUP THAT IS SOUNDING, FOLD THE REST.
 *
 * Messiah is the piece this exists for. Fifty-three numbers on one rail chip at
 * about fifteen pixels each on the office screen — narrower than a numeral —
 * so the rail degrades to a row of ticks that names nothing and locates
 * nothing. Every remedy that keeps all 53 drawn fails the same way, because the
 * problem is not the label ladder; it is that 53 does not fit.
 *
 * So the rail stops drawing all of them. The Part that is sounding is drawn in
 * full — its numbers get the width they always wanted — and every other Part
 * folds into ONE segment carrying that Part's name. Three Parts become "Part
 * One" + 23 numbers + "Part Three", which is a rail a viewer can read.
 *
 * IT IS THE SAME AXIS, NOT A ZOOM. A folded segment takes exactly the width of
 * everything it replaced (its duration is their sum, its offset is the first
 * one's), so the rule still runs from the work's first note to its last, the
 * playhead still lands where the clock says, and the proportions the accordion,
 * the bond and the numeral gutter all measure against are untouched. Nothing
 * downstream learns a new coordinate system — which is why this is a filter on
 * the placed list rather than a mode every consumer has to understand.
 *
 * A FOLDED SEGMENT CARRIES NO RAIL INDEX (`index: null`). The playhead is
 * resolved by matching a rail index (see `SegmentMap`'s `activeIndex`), and a
 * fold only ever replaces segments that are NOT sounding; a null makes that
 * structural rather than merely true today.
 *
 * @param {Array<{index:number, segment:object}>} placed from `placedRailSegments`.
 * @param {object} opts
 * @param {number|null} opts.activeGroupIndex The `group.index` of the sounding
 *   group at `depth`. Null (nothing sounding, no ancestry) folds nothing.
 * @param {number} [opts.depth] Which level of the ancestry folds. 0 is outermost.
 * @returns {Array<{index:number|null, segment:object}>}
 */
export function collapseInactiveGroups(placed, { activeGroupIndex = null, depth = 0 } = {}) {
  const list = Array.isArray(placed) ? placed : [];
  if (list.length === 0 || activeGroupIndex === null || activeGroupIndex === undefined) return list;

  const groupOf = (segment) => {
    const path = Array.isArray(segment?.groupPath) ? segment.groupPath
      : Array.isArray(segment?.ancestors) ? segment.ancestors : null;
    if (!path?.length) return null;
    return path[Math.min(depth, path.length - 1)] ?? null;
  };
  const indexOf = (segment) => {
    const raw = Number(groupOf(segment)?.index);
    return Number.isFinite(raw) ? raw : null;
  };

  // A rail with no ancestry, or one whose every segment is in the active group,
  // has nothing to fold and must come back IDENTICAL — not a rebuilt copy. Every
  // instrumental work in the corpus takes this path, and a new array identity
  // would churn the memos downstream at the transport's 10 Hz.
  const groups = new Set(list.map((p) => indexOf(p.segment)));
  groups.delete(null);
  if (groups.size <= 1) return list;

  const out = [];
  let open = null;
  for (const entry of list) {
    const gi = indexOf(entry.segment);
    if (gi === activeGroupIndex || gi === null) {
      open = null;
      out.push(entry);
      continue;
    }
    const duration = Number(entry.segment?.duration) || 0;
    if (open && open.groupIndex === gi) {
      open.segment.duration += duration;
      open.segment.count += 1;
      continue;
    }
    const group = groupOf(entry.segment);
    const title = typeof group?.title === 'string' && group.title.trim() ? group.title.trim() : null;
    open = {
      groupIndex: gi,
      index: null,
      segment: {
        contentId: entry.segment?.contentId ?? null,
        // The fold's NAME is the group's title, because that is the only thing
        // it can honestly claim to be: it stands in for the whole Part, not for
        // any number inside it.
        name: title,
        group,
        groupPath: entry.segment?.groupPath ?? null,
        ancestors: entry.segment?.ancestors ?? null,
        offset: Number(entry.segment?.offset) || 0,
        duration,
        // No numeral. A fold is not the nth number of anything, and a gutter
        // mark under it would be a number the corpus never wrote.
        n: null,
        collapsed: true,
        count: 1,
      },
    };
    out.push(open);
  }
  return out.map(({ index, segment }) => ({ index, segment }));
}

/**
 * Consecutive runs of rail segments sharing one group — the labels above the rule.
 *
 * A RUN IS DETECTED BY `group.index`, AND THAT IS THE SERIALISED FORM OF
 * IDENTITY. The backend detects its own runs by object identity and stamps each
 * one with a distinct `group.index` for exactly this purpose
 * (`YamlSurroundStore#renumberGroups`) — including the case that makes the work
 * slug useless, a container naming the same work twice, which must print two
 * headings because a set played twice is two appearances. Identity itself cannot
 * be read here: the payload crosses the wire as JSON, and `JSON.parse` gives
 * every segment its own group object however many shared one on the server. The
 * index survives the crossing; the pointer does not.
 *
 * Consecutive UNGROUPED segments are one run with a null group, so the ordinary
 * single-work rail produces exactly one null run and the caller renders no label
 * row at all.
 *
 * @param {Array<{segment:object}>} placed from `placedRailSegments`.
 * @param {(segment:object) => object|null} [selectGroup] selects the hierarchy
 *   level to run. The default is the established scene/work grouping.
 * @returns {Array<{title:string|null, index:number|null, from:number, count:number, span:number}>}
 *   one entry per run, in rail order. `from` is the run's first position in
 *   `placed`; `span` is the run's sounding seconds, which is what its label is
 *   sized by.
 */
export function railGroups(placed, selectGroup = (segment) => segment?.group ?? null) {
  const list = Array.isArray(placed) ? placed : [];
  const runs = [];
  list.forEach(({ segment }) => {
    const group = selectGroup(segment) ?? null;
    // A group with no number is malformed — the store stamps every one of them
    // — and is degraded to "ungrouped" rather than guessed at: an unlabelled
    // stretch of rail is the honest rendering of a heading we cannot place.
    const raw = Number(group?.index);
    const index = group && Number.isFinite(raw) ? raw : null;
    const duration = Number(segment?.duration) || 0;
    const last = runs[runs.length - 1];
    // Two ungrouped segments in a row are one run (both null); two runs of the
    // same work are two runs (different indexes); an ungrouped segment between
    // two runs of one work closes the first — the same rule the store numbers by.
    if (last && last.index === index) {
      last.count += 1;
      last.span += duration;
      return;
    }
    runs.push({
      title: index === null ? null
        : (typeof group.title === 'string' && group.title.trim() ? group.title.trim() : null),
      index,
      from: last ? last.from + last.count : 0,
      count: 1,
      span: duration,
    });
  });
  return runs;
}

/**
 * IS THIS RAIL ONE TIER OR TWO?
 *
 * A heading is a heading when it names a RUN. Where every run is a single
 * segment the heading and the segment are the same thing said twice — the
 * polonaise season prints `Polonaise No. 1 in C-sharp minor, Op. 26 No. 1`
 * above the rule and `Polonaise in C-sharp minor, Op. 26 No. 1` below it, both
 * ellipsized, and the viewer reads one work's name twice and neither of them
 * whole. That rail is FLAT: a list of works, one segment each.
 *
 * Two consequences, and they are the same decision taken once. A flat rail
 * prints no heading row, and it numbers its gutter by POSITION ON THE RAIL —
 * because every part authored `n: 1` for its own single movement, so the
 * authored numerals say `I.` seven times where the viewer wants 1 … 7. A
 * grouped rail keeps both: `Études, Op. 10` genuinely spans twelve segments,
 * and those twelve are numbered 1 … 12 by the corpus to match the names printed
 * under them.
 *
 * @param {Array<{count:number}>} groups from `railGroups`.
 * @returns {boolean} true when no run covers more than one segment.
 */
export function railIsFlat(groups) {
  const list = Array.isArray(groups) ? groups : [];
  return list.every((run) => (Number(run?.count) || 0) <= 1);
}

/**
 * THE AIR EITHER SIDE OF A FOLD'S COUNT (design wave 10).
 *
 * A fold that is exactly as wide as its badge is a badge with a hatched border,
 * not an elision — the hatch has to be visible as ground for the mark to read as
 * sitting IN something. Twelve pixels a side is the least that reads as ground
 * at the office screen's root; below it the diagonals become a fringe on the
 * pill.
 */
export const FOLD_PILL_AIR_PX = 12;

/**
 * How wide a fold is drawn — MEASURED, and it is not a share of anything.
 *
 * THIS IS THE WHOLE POINT OF FOLDING. Before design wave 10 a folded part still
 * carried its duration's share of the rule: Messiah's Part One took 231px and
 * Part Three 246px of a 1714px rail — 28% of the rail spent on two blocks that
 * say "twenty-one numbers are hidden here" and "nine are". A fold has no
 * duration to represent, because it is an ELISION: the thing it stands for is
 * not on the axis any more. So it is sized to the only two things it actually
 * has to hold — the part's own label, which sits above it, and the count badge
 * inside it — and every pixel that frees goes back to the part that is sounding.
 *
 * @param {object} args
 * @param {number} args.labelPx the rendered width of the part label, INCLUDING
 *   its own inline padding (measured off the probe, not derived from the `em`s).
 * @param {number} args.pillPx the rendered width of the count badge.
 * @returns {number} px, or 0 when neither has been measured — and 0 is the
 *   signal not to fold at all, never a fold drawn at nothing.
 */
export function foldWidthPx({ labelPx, pillPx }) {
  const label = Number(labelPx);
  const pill = Number(pillPx);
  const wide = Math.max(
    Number.isFinite(label) && label > 0 ? label : 0,
    Number.isFinite(pill) && pill > 0 ? pill + FOLD_PILL_AIR_PX * 2 : 0,
  );
  return wide > 0 ? wide : 0;
}

/**
 * Which runs of the rail are FOLDED into one elided block.
 *
 * THE RULE IS THE SOUNDING PART, and nothing else. Every run of the top
 * hierarchy level except the one holding the sounding segment collapses; the
 * sounding part stays open, with every one of its segments drawn. That is what
 * makes the rail answer the question it is on screen to answer — where are we,
 * inside the stretch of music that is playing — instead of spending three
 * quarters of its width numbering movements nobody is listening to.
 *
 * WHAT IS NOT FOLDED, AND WHY:
 *   - A run of ONE. Folding it hides a single number behind a badge that says
 *     "1", which is more ink for less information.
 *   - An UNLABELLED run. The fold's width is its label's width and its meaning
 *     is "the rest of <part>"; with no title there is nothing to size it by and
 *     nothing for the viewer to name what was hidden.
 *   - EVERYTHING, when nothing is sounding. Before the first note and after the
 *     last chord there is no sounding part, so there is no part to fold
 *     everything else AROUND, and the honest rail is the whole rail.
 *
 * @param {object} args
 * @param {Array<{title:string|null, index:number|null, from:number, count:number}>}
 *   args.groups the runs from `railGroups`, in rail order.
 * @param {number} args.activeIndex the sounding segment, or -1 for none.
 * @returns {Array<{title:string, index:number|null, from:number, count:number}>}
 *   the runs to collapse, in rail order.
 */
export function railFolds({ groups, activeIndex }) {
  const runs = Array.isArray(groups) ? groups : [];
  const active = Number(activeIndex);
  if (!runs.length || !Number.isFinite(active) || active < 0) return [];
  const holds = (run) => active >= run.from && active < run.from + run.count;
  // No run holds the playhead — a rail whose groups do not cover it. Folding
  // every run would leave a rail of nothing but badges with the sounding
  // segment inside one of them.
  if (!runs.some(holds)) return [];
  return runs.filter((run) => run.title && run.count > 1 && !holds(run));
}

/**
 * Which placed segment is sounding, or -1 when none is.
 *
 * ONE derivation, called by the rail and by the listening band, because the two
 * used to hold two near-copies that disagreed at the edges. The rail's loop fell
 * through to `return 0` for a position BEFORE the first segment's start, while
 * the band's fell through to -1 — invisible only because both shipped recordings
 * start at 0. The store explicitly permits `starts: [45, …]` (a transfer with
 * tuning or an announcement at the head), and that recording got a lit "active"
 * segment on the rule above a header saying nothing was playing.
 *
 * -1 IS THE CORRECT ANSWER THERE, and it is the same answer for the same reason
 * the band already gives -1 after `musicEndsAt`: a segment is sounding between
 * its own start and the next one's, and the head of the file is outside every
 * segment's span. Lighting segment I before it begins is a claim about the
 * music that the recording contradicts.
 *
 * @param {object} args
 * @param {Array<{start:number}>} args.placed from `placedSegments`.
 * @param {number} args.position the transport's position, in seconds.
 * @param {number|null} args.end where the music stops, or null for "unbounded".
 * @returns {number} an index into `placed`, or -1.
 */
export function activeSegmentIndex({ placed, position, end }) {
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
 * the band measured `position / end`, which agree only while the first segment
 * starts at 0. Both shipped sidecars do — and a sidecar whose first segment
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
 * accordion is neither: it is a layout move, and it happens on a segment
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
 * segment rather than as a stripe, so the floor is 72.
 *
 * IT IS THE FALLBACK NOW, NOT THE ANSWER — see `nameFloorPx`. 72 is that
 * derivation evaluated on a rail whose widest mark is `III.`; the chrome term in
 * it grows with the numeral gutter, so a rail running to `VIII.` or `21.` earns
 * a wider floor than this and a rail of `I./II.` a narrower one. This constant
 * is what a caller gets when the rail has not been measured.
 */
export const SEGMENT_FLOOR_PX = 72;

/**
 * The TEXT a floored segment has to be able to show, in px — the second term of
 * `nameFloorPx`, and the whole of what the 72px sweep above actually measured
 * once its chrome is taken back out.
 *
 * DERIVED IN `band.measure.test.jsx` ("the rail's name floor, derived"), against
 * the real compiled sheet and the real vendored faces, as the widest
 * three-glyphs-plus-ellipsis any shipped segment name sets in the heading's own
 * face at the row's own 1.05rem. Three glyphs and the ellipsis is the criterion
 * the original sweep landed on and it is unchanged; what has changed is that it
 * is now measured across the whole corpus rather than against one string, so a
 * name whose first three glyphs are wide (`Mar…`) cannot be floored on the
 * measurement of one whose first three are narrow (`No.…`).
 *
 * IT IS A FIXED PX, ON EVERY ROOT, and that is not an oversight. The row is set
 * at 1.05rem and the frame's rem is 16px on every screen in the fleet, so this
 * run of type is the same length everywhere — exactly as the chrome it is added
 * to is (`desiredWidth`).
 *
 * IT IS ALSO WIDER THAN THE 72px SWEEP IMPLIED, and that is the re-derivation
 * doing its job rather than a disagreement. 72 minus the Eroica's furniture
 * leaves ~30px of run, which is enough for `Sch…` and not enough for `Mar…`
 * — the widest three-glyph opening in the corpus, measured at 37px. The old
 * sweep read one string; a floor derived from one string floors every other
 * name in the set on that string's letterforms. The Eroica's named floor
 * therefore moves from 72px to ~79px, in the direction that shows MORE of a
 * compressed name.
 */
export const SEGMENT_NAME_RUN_PX = 37;

/**
 * The narrowest an inactive segment may be drawn and still be a NAMED segment,
 * on THIS rail.
 *
 * `chromePx` is the segment's furniture — the numeral's gutter and the text
 * insets — which is constant across a rail and across the fleet, and different
 * between rails: `--numeral-chars` sizes the gutter from the widest mark the
 * piece has, so twenty-one nocturnes carry a wider one than four movements do.
 * A floor that ignored it would give a rail of `VIII.` the same room for its
 * names as a rail of `I.`, which is the same defect the gutter itself was
 * introduced to fix, one level down.
 *
 * @param {number} chromePx measured `segW - cellW`, px.
 * @returns {number} the floor for this rail, or `SEGMENT_FLOOR_PX` when the
 *   rail has not been measured — "no measurement yet" is not "no chrome".
 */
export function nameFloorPx(chromePx) {
  const chrome = Number(chromePx);
  if (!Number.isFinite(chrome) || !(chrome > 0)) return SEGMENT_FLOOR_PX;
  return Math.ceil(chrome + SEGMENT_NAME_RUN_PX);
}

/**
 * THIS RAIL'S FLOOR — and which question it is allowed to ask.
 *
 * `nameFloorPx` tolerates a cut, and that tolerance is its whole derivation:
 * three glyphs and an ellipsis, which is the best a crowded rail can do with a
 * long authored NAME. `Marcia funebre. Adagio assai` will never fit a floored
 * segment on any screen in the fleet, so a floor that demanded it would chip
 * every symphony in the corpus.
 *
 * A `short:` IS THE OTHER CASE, and it is the corpus saying so. It is the
 * compressed form — the shortest thing the author is willing to have stand for
 * this segment — so a rail that cuts it has nothing left to try. `C-sh…` is not
 * a degraded label, it is a label that failed, and the design already has the
 * honest rendering for a rule with no room for type: the chip. So when every
 * drawn segment carries one, the floor becomes what the widest of them needs to
 * set WHOLE, and `railWearsChips` — which compares the room against this — flips
 * the rail to chips exactly when that cannot be afforded.
 *
 * It never floors a rail BELOW `nameFloorPx`: a very short label does not buy
 * permission to draw segments narrower than a named rail already allows.
 *
 * @param {number} args.chromePx measured `segW - cellW`, px.
 * @param {number|null} [args.labelPx] the widest LABEL this rail must set whole
 *   — max of the authored `short` widths — or null/0 for "not every segment has
 *   one", which is the ordinary named rail.
 */
export function railFloorPx({ chromePx, labelPx = null }) {
  const named = nameFloorPx(chromePx);
  const label = Number(labelPx);
  if (!Number.isFinite(label) || !(label > 0)) return named;
  const chrome = Number(chromePx);
  // An unmeasured rail has no furniture to add the label to, so it has no
  // opinion beyond the fallback — the same reading `nameFloorPx` takes.
  if (!Number.isFinite(chrome) || !(chrome > 0)) return named;
  return Math.max(named, idealWidth({ chromePx: chrome, needPx: label }));
}

/**
 * The narrowest a CHIPPED segment may be drawn — the compressed floor the rail
 * falls to once it has stopped trying to set names.
 *
 * The chip is 1.25rem across (`SegmentMap.scss`) and this is that plus 4px of
 * air, so two neighbouring chips never touch. Fixed px on every root for the
 * same reason `SEGMENT_NAME_RUN_PX` is: the chip is the numeral gutter's mark
 * rendered as a mark, and the gutter is rem-fixed, not root-scaled.
 *
 * IT IS THE POINT OF CHIP MODE, and the arithmetic is the whole argument.
 * Twenty-one segments cannot each hold `nameFloorPx` on the office rule — 21 x
 * 76px is 1596px against the 822px the footer actually measures there — so with
 * names the accordion has nothing to donate and the sounding segment can never
 * have its name whole. At this floor the same rail spends 20 x 24 = 480px on its
 * chips and has ~342px left to give, against the ~250px the longest nocturne
 * asks for. Measured, at all three roots, in `band.measure.test.jsx`.
 *
 * IT IS NOT A GUARANTEE ON EVERY ROOT, and the spec says which. The living
 * room's footer measures ~608px of rule: 480px of chips leaves 128px, and no
 * nocturne name is that short. That rail degrades and REPORTS it
 * (`surround.accordion.degraded`, a warn) — which is the designed outcome for a
 * corpus that has outrun its screen, and the signal the corpus is fixed from.
 */
export const SEGMENT_CHIP_FLOOR_PX = 24;

/**
 * How much width each INACTIVE segment can be given once the sounding one has
 * been opened to the widest name ON THIS RAIL.
 *
 * THE WIDEST NAME, NOT THE SOUNDING ONE, and that is what makes the answer a
 * constant of the piece rather than of this instant. The rail wears chips or
 * names all-or-nothing (a mix reads as a bug), so the decision may not change at
 * a segment boundary — which it would if it were taken against whichever name
 * happened to be sounding.
 *
 * @returns {number} px per inactive segment, or NaN for "not measured" — a
 *   rail with no width, or one with nothing to compress.
 */
export function inactiveRoomPx({ railPx, count, widestPx }) {
  const rail = Number(railPx);
  const n = Number(count);
  const widest = Number(widestPx);
  if (!(rail > 0) || !(n > 1) || !Number.isFinite(widest)) return NaN;
  const taken = Math.min(Math.max(widest, 0), rail);
  return (rail - taken) / (n - 1);
}

/**
 * Does this rail wear chips?
 *
 * THE THRESHOLD IS A MEASURED WIDTH PER INACTIVE SEGMENT, NEVER A COUNT. Six
 * long titles starve at a count where six short ones do not, because the long
 * ones open the sounding segment wider and leave less behind: `widestPx` is the
 * width the widest name on this rail asks for, so the content is in the answer.
 *
 * @param {object} args
 * @param {number} args.railPx the rule's measured width.
 * @param {number} args.count how many segments the rail draws.
 * @param {number} args.widestPx the width the widest-named segment would need.
 * @param {number} args.floorPx this rail's `nameFloorPx`.
 * @returns {boolean} false whenever the rail has not been measured — the
 *   unmeasured rail draws names, which is what it drew before this existed.
 */
export function railWearsChips({ railPx, count, widestPx, floorPx }) {
  const room = inactiveRoomPx({ railPx, count, widestPx });
  const floor = Number(floorPx);
  if (!Number.isFinite(room) || !Number.isFinite(floor)) return false;
  return room < floor;
}

const EPS = 1e-6;

/**
 * How much wider than its own text column a box has to overflow before the
 * accordion is allowed to open for it.
 *
 * Review finding (minor 3): on a `nowrap` + `overflow: hidden` box that is NOT
 * overflowing, `scrollWidth === clientWidth`, so a bare `need > cellW` was true
 * by a rounding hair and the rail quietly took a pixel off every neighbour for a
 * name that already fitted. Half a pixel is below anything a viewer can see and
 * above anything sub-pixel layout produces.
 */
export const ACCORDION_OVERFLOW_EPS_PX = 0.5;

/**
 * The width the SOUNDING segment would have to be drawn at for neither its
 * heading nor its gloss to be cut.
 *
 * PURE, AND SHARED WITH THE SPEC THAT MEASURES IT. The DOM reads stay in
 * `SegmentMap` (only a rendered rail knows how wide a string is in this face at
 * this size), but the arithmetic on top of them lives here, once. It used to
 * live in the component and be transcribed into the measurement harness —
 * which is precisely the class of copy that harness exists to abolish: drop the
 * half-pixel threshold or the rounding margin in the component and a spec
 * carrying its own copy would keep measuring the old way and stay green.
 *
 * The chrome around the text column — the numeral's gutter and the text insets —
 * is `segW - cellW`, a CONSTANT at every screen because it is built entirely
 * from `em`/`ch` of one rem-fixed size. That is what keeps `desired` independent
 * of the width the accordion is about to set, so it cannot feed back into itself.
 *
 * @param {object} args
 * @param {number} args.segW the segment's current rendered width, px.
 * @param {number} args.cellW its text column's current width, px.
 * @param {number} args.need the widest of the heading's and the gloss's full
 *   single-line width (`scrollWidth` on a `nowrap` box), px.
 * @returns {number} the ideal width in px, or 0 for "nothing to open for" —
 *   an unmeasured rail, a text column too small to subtract from, or a segment
 *   whose text already fits.
 */
export function desiredWidth({ segW, cellW, need }) {
  if (!Number.isFinite(segW) || !Number.isFinite(cellW) || !Number.isFinite(need)) return 0;
  // Below ~1px of cell there is nothing to subtract from and the reading would
  // be garbage.
  if (!(cellW > 1) || !(segW > cellW)) return 0;
  if (!(need > cellW + ACCORDION_OVERFLOW_EPS_PX)) return 0;
  return idealWidth({ chromePx: segW - cellW, needPx: need });
}

/**
 * The same arithmetic with the "does it already fit" question taken out: the
 * width a segment would have to be for a string of `needPx` to set whole in it.
 *
 * `desiredWidth` answers "how wide should the accordion open THIS segment", and
 * declines for a segment whose text already fits. The rail's chip threshold asks
 * a different question — "how wide would the widest name on this rail have to
 * be" — about a segment that is not sounding and is nowhere near that width, so
 * the fit test would refuse every time and the threshold would never see the
 * content it is supposed to be driven by.
 *
 * The `+1` is the rounding margin: `scrollWidth` is an integer taken from a
 * fractional layout, so a box sized to exactly it can still clip a hair.
 */
export function idealWidth({ chromePx, needPx }) {
  const chrome = Number(chromePx);
  const need = Number(needPx);
  if (!Number.isFinite(chrome) || !Number.isFinite(need)) return 0;
  return Math.ceil(Math.max(0, chrome) + Math.max(0, need)) + 1;
}

/**
 * What the SOUNDING segment asks the accordion for — the one number the solve
 * is driven by.
 *
 * IT ASKS ABOUT THE SEGMENT'S NATURAL WIDTH, not its rendered one. The rendered
 * width is the previous solve's output, so measuring the overflow against it is
 * a decision feeding on itself; the natural width is what the rail would give
 * this segment anyway, which is the question the accordion is actually
 * deciding. Everything here is therefore derived from numbers that do not move
 * when the answer is applied.
 *
 * AND THE "IT ALREADY FITS" TEST ONLY APPLIES WHERE THERE IS A CELL TO TEST.
 * `desiredWidth` declines to judge a text column under a pixel wide, because a
 * DOM read of one is garbage — but a NATURAL width narrower than the segment's
 * own furniture is not a bad reading, it is a real and common state on a
 * crowded rail (a nocturne's 36px share against 50px of numeral gutter and
 * insets). Declining there returned 0, the accordion never opened, and the
 * sounding segment kept its ellipsis on precisely the rail this whole mode
 * exists for.
 *
 * @param {object} args
 * @param {number} args.naturalPx the segment's duration-derived width.
 * @param {number} args.chromePx the rail's segment furniture.
 * @param {number} args.needPx the widest of its heading and its gloss.
 * @returns {number} the width to open to, or 0 for "nothing to open for".
 */
export function soundingWidth({ naturalPx, chromePx, needPx }) {
  const natural = Number(naturalPx);
  const chrome = Number(chromePx);
  const need = Number(needPx);
  if (!Number.isFinite(natural) || !Number.isFinite(chrome) || !Number.isFinite(need)) return 0;
  if (!(need > 0)) return 0;
  const cell = natural - chrome;
  // Wide enough to ask: `desiredWidth` owns the half-pixel threshold that stops
  // the rail opening for a rounding hair.
  if (cell > 1) return desiredWidth({ segW: natural, cellW: cell, need });
  return idealWidth({ chromePx: chrome, needPx: need });
}

/**
 * Solve the rail's rendered segment widths.
 *
 * THE RULE THE USER SET. Everything is one line with an ellipsis when inactive;
 * the sounding segment widens until its heading and its translation each fit on
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
 * @param {number[]} args.natural each segment's share of the piece, 0..1,
 *   summing to 1 (the duration-derived widths).
 * @param {number} args.activeIndex the sounding segment, or -1 for none.
 * @param {number} args.railPx the rule's measured width in pixels.
 * @param {number} args.desiredPx the active segment's ideal rendered width — the
 *   width at which neither its heading nor its translation is cut.
 * @param {number} [args.floorPx] the compressed-neighbour floor.
 * @param {Array<number|null>} [args.pinnedPx] per-segment FIXED widths — the
 *   fold. A finite entry pins that segment to exactly that many pixels, takes
 *   it out of the donor pool, and hands the width it gave up to everything
 *   unpinned in proportion to the time each of them is worth. `null` (or any
 *   non-finite entry) is "solve me normally", which is every segment on a rail
 *   with nothing folded.
 * @returns {number[]} rendered shares, 0..1, summing to 1. Identical to
 *   `natural` whenever no widening and no pinning applies.
 */
export function accordionShares({
  natural, activeIndex, railPx, desiredPx, floorPx = SEGMENT_FLOOR_PX, pinnedPx = null,
}) {
  const shares = Array.isArray(natural) ? natural.map((n) => (Number.isFinite(n) ? n : 0)) : [];
  const n = shares.length;
  if (n === 0) return shares;
  // A rail we have not measured yet is its own timeline — and it is measured in
  // pixels, so nothing below this line can be asked without a width.
  if (!(railPx > 0)) return shares;

  const px = shares.map((s) => s * railPx);

  // ---- THE PINS ARE APPLIED FIRST (design wave 10) -------------------------
  // A fold is settled before the accordion opens anything, because the width it
  // releases is width the accordion is then free to spend. Doing it the other
  // way round would have the sounding segment bargaining with neighbours whose
  // widths are about to be thrown away.
  //
  // WHO OWNS "A FOLD ONLY EVER SHRINKS": the CALLER, not this function. A fold
  // is pinned as one width on its first member with its other members pinned to
  // zero, so the only place the elision's total can be weighed against the time
  // it stands for is where the run is still a run. Here a pin is a width, and
  // the one thing refused is a set of pins that would fill the rule outright —
  // there would be nothing left to solve and every unpinned segment would go to
  // zero or negative.
  const pins = new Array(n).fill(null);
  let pinned = false;
  let pinnedTotal = 0;
  if (Array.isArray(pinnedPx)) {
    for (let i = 0; i < n; i += 1) {
      // `Number(null)` IS 0, and 0 is a legal pin (the members of a fold behind
      // its head are pinned to nothing). Coercing first would therefore read
      // every UNPINNED slot as a pin at zero width — which is not a subtle
      // wrong answer: every segment on the rail ends up pinned, there is nobody
      // left to hand the freed width to, and the whole solve bails out to the
      // unfolded shares. The absent cases are rejected before the coercion.
      const raw = pinnedPx[i];
      if (raw === null || raw === undefined || raw === '') continue;
      const want = Number(raw);
      if (!Number.isFinite(want) || want < 0) continue;
      pins[i] = want;
      pinnedTotal += want;
      pinned = true;
    }
  }
  if (pinned && pinnedTotal >= railPx - EPS) {
    pins.fill(null);
    pinned = false;
  }
  if (pinned) {
    // The basis is SNAPSHOT before anything moves: spreading the freed width in
    // proportion to widths that are themselves being rewritten in the same loop
    // gives the first unpinned segment more than its time is worth.
    const basis = px.slice();
    let freed = 0;
    let open = 0;
    for (let i = 0; i < n; i += 1) {
      if (pins[i] === null) { open += basis[i]; continue; }
      freed += basis[i] - pins[i];
      px[i] = pins[i];
    }
    if (open > EPS) {
      for (let i = 0; i < n; i += 1) {
        if (pins[i] !== null) continue;
        px[i] = basis[i] + freed * (basis[i] / open);
      }
    } else {
      // Everything pinned: there is nobody to hand the freed width to, and a
      // shares vector that does not sum to the rule is a rail with a hole in
      // it. Nothing is folded rather than something drawn wrong.
      for (let i = 0; i < n; i += 1) px[i] = basis[i];
      pins.fill(null);
      pinned = false;
    }
  }
  /** The pinned solve, for every path below that returns before widening. */
  const pinnedShares = () => px.map((w) => w / railPx);

  // Nothing sounding (the applause), a single segment with no neighbour to
  // compress, or nothing measured to widen for.
  if (n < 2 || activeIndex < 0 || activeIndex >= n) return pinned ? pinnedShares() : shares;
  if (!Number.isFinite(desiredPx)) return pinned ? pinnedShares() : shares;

  const extra = desiredPx - px[activeIndex];
  // The active segment is never made NARROWER than its duration earns it. A
  // short name in a long segment keeps the long segment's width; the
  // accordion only ever opens.
  if (!(extra > EPS)) return pinned ? pinnedShares() : shares;

  const floor = Math.max(0, floorPx);
  const donors = [];
  let available = 0;
  for (let i = 0; i < n; i += 1) {
    if (i === activeIndex) continue;
    // A FOLD IS NEVER A DONOR. Its width is its label's width; compressing it
    // below that would ellipsize the one word that says what was hidden.
    if (pins[i] !== null) continue;
    const slack = px[i] - floor;
    if (slack > EPS) { donors.push(i); available += slack; }
  }
  if (!(available > EPS)) return pinned ? pinnedShares() : shares;

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
 * How close two share-edges have to be before they count as the same edge.
 * A rule is ~600-1250px wide across the fleet, so this is a fifth of a pixel at
 * the narrowest screen — below any radius decision a viewer could see, and above
 * the float noise a sum of interpolated shares carries.
 */
const EDGE_EPS = 3e-4;

/**
 * The connector — the WAIST of the bond: the horizontal interval, in shares of
 * the rule, that runs along the band's seam and welds the sounding segment above
 * it to the NOW panel below it.
 *
 * IT SPANS THE HULL, AND THAT IS THE FIX (design wave 9). It used to run from
 * the segment's near edge only as far as the panel's near edge, so the two lit
 * areas met at a POINT: the waist's bottom corner against the panel's top corner,
 * diagonal neighbours touching at nothing. The user's word for it was "kitty
 * corner", and it is not a shape — a region joined at a single point is two
 * regions in every sense a viewer has. The waist now spans from the leftmost of
 * (segment, panel) to the rightmost of them, which makes two things true at once
 * and by construction:
 *
 *   * THE PANEL'S WHOLE TOP EDGE IS WELDED. The waist contains the panel's span
 *     entirely, so the join below it is an interval half the band wide, never a
 *     corner.
 *   * THE SEGMENT'S WHOLE BOTTOM EDGE IS WELDED, for the same reason. The waist
 *     contains the segment's span too, so the join above it is the segment's own
 *     full width.
 *
 * It also means the waist's two ends always land ON an edge one of the other two
 * parts already has, which is what keeps the silhouette free of new corners: at
 * each end, either the segment continues upward from it or the panel continues
 * downward from it. `corners` says which of the waist's own four corners are
 * therefore on the OUTSIDE of the shape and take the radius — see the stylesheet.
 *
 * DEGENERATE CASES, all handled by the same two `min`/`max`: the segment sitting
 * directly over the panel (the hull is the panel; the waist collapses into it and
 * the two simply merge, with no pinch anywhere), the segment at the far end of
 * the rule (the waist is nearly the whole band — a long thin middle, which is the
 * shape the user asked for), and the first and last segments (nothing special:
 * their spans are just the extreme ones).
 *
 * THE PANEL'S POSITION IS A NUMBER, NOT A SIDE (review finding I-6). `side` is
 * discrete, and taking it discretely is what left the waist jumping to the new
 * hull in the frame the side flipped while the panel below it travelled there
 * over 420ms on the CSS clock — §7's defect one state over, and the one
 * degenerate case §1 named (`nowSide: dynamic` at the moment of the swap) left
 * unheld. Callers that animate the swap pass the INTERPOLATED `panelStart` and
 * the waist travels with the panel; `side` remains as the convenience for
 * everything that does not move.
 *
 * @param {object} args
 * @param {number} args.segStart the active segment's left edge, 0..1 of the rule.
 * @param {number} args.segEnd its right edge, 0..1.
 * @param {'left'|'right'} [args.side] which side the NOW panel is on.
 * @param {number} [args.panelStart] the panel's left edge, 0..1 — overrides
 *   `side`, and may be anywhere between the two while a swap is in flight.
 * @returns {{start:number, width:number, corners:{tl:boolean,tr:boolean,bl:boolean,br:boolean}}}
 *   in shares of the rule; `corners` are the waist corners that are exterior.
 */
export function bondConnector({ segStart, segEnd, side, panelStart: panelAt }) {
  const bounded = Number.isFinite(panelAt)
    ? Math.min(Math.max(panelAt, 0), 1 - NOW_PANEL_SHARE) : null;
  const panelStart = bounded !== null ? bounded : (side === 'left' ? 0 : 1 - NOW_PANEL_SHARE);
  const panelEnd = panelStart + NOW_PANEL_SHARE;
  const a = Number.isFinite(segStart) ? segStart : 0;
  const b = Number.isFinite(segEnd) ? segEnd : 0;
  const lo = Math.min(a, panelStart);
  const hi = Math.max(b, panelEnd);
  return {
    start: lo,
    width: hi - lo,
    corners: {
      // The TOP corners are exterior where the segment does not continue upward.
      tl: lo < a - EDGE_EPS,
      tr: hi > b + EDGE_EPS,
      // The BOTTOM corners are exterior where the panel does not continue down.
      bl: lo < panelStart - EDGE_EPS,
      br: hi > panelEnd + EDGE_EPS,
    },
  };
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
 * It exists because the accordion's geometry is no longer animated by CSS (see
 * `useEasedVector`), and the rest of the frame's motion still is: the band's
 * panel slide on a `nowSide` swap rides the same curve. One easing, two engines,
 * so nothing in the band moves on a different feel.
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
 * Animate a vector of the rail's geometry in JS, and hand back what is on screen.
 *
 * REVIEW FINDING I2 — THE REASON THIS EXISTS. The widths used to be animated by
 * a CSS `transition: width` over `ACCORDION_MS` while the playhead ran on its
 * own 120 ms ramp against the TARGET shares. At a segment boundary the head
 * therefore reached the widened solution in ~120 ms while the painted boundary
 * was still ~300 ms away from it — measured on the Eroica at 1280x720, the
 * cursor sat ~70 px inside the elapsed fill's still-painted right edge for that
 * window. The brief's instruction was explicit ("Do not let the accordion
 * desynchronise the head from the boundaries"), and two clocks cannot satisfy
 * it however either one is tuned.
 *
 * IT CARRIES THE BOND TOO NOW (design wave 9), and that is why it is a VECTOR
 * rather than an array of shares. Wave 7 left the bond's `left`/`width` on a CSS
 * transition, reasoning that the bond travels BETWEEN segments rather than
 * tracking one, so only its endpoints have to be right. The endpoints were right
 * and the journey was not: the segment widths eased in JS from the first frame
 * while the bond's own box did not begin moving until React had committed the
 * new `left`, so the eye saw the rail right-size itself and THEN the highlight
 * slide into it — one move read as two. The user saw it immediately. The bond's
 * start and width are appended to the same vector the shares ride in, so the
 * whole shape is published from one interpolation in one render, and there is
 * nothing left for any part of it to drift against.
 *
 * The loop runs only while a move is in flight — a segment boundary is minutes
 * apart, so this is idle for all but ~420 ms of a symphony.
 *
 * @param {number[]} target the geometry vector: the solved shares, then any
 *   other numbers that must move on the same clock.
 * @param {number} durationMs
 * @returns {{shares:number[], moving:boolean}} `shares` is the whole vector, in
 *   the order it was given.
 */
export function useEasedVector(target, durationMs) {
  const [, tick] = useState(0);
  const from = useRef(target);
  const current = useRef(target);
  const startedAt = useRef(0);
  const frame = useRef(0);
  const moving = useRef(false);

  // A different piece, or a piece with a different number of segments, is not
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
