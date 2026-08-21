// frontend/src/modules/Surround/modules/SegmentMap.jsx
//
// The signature element of the concert-hall surround, and the only place the
// design spends any boldness.
//
// This is NOT a progress bar. It is set as the barline grammar of engraved music:
// one hairline staff rule, one quiet separator between segments, each segment
// proportional to that segment's real duration, names above the rule with the
// tempo term in italic.
//
// WHERE THE RULE SITS (design wave 4)
// -----------------------------------
// At the TOP of the band, tight against the video's bottom edge — inside the
// footer's own overlap, so the timeline reads as the picture's own baseline
// rather than as a bar floating in a strip of black below it. The segment
// names hang BELOW the rule. That inverts wave 2's arrangement, and the
// clearance law it was written for still binds, only mirrored: the playhead
// lane is ABOVE, the names are below, and the two boxes must not meet.
//
// WHERE PROGRESS IS READ (design wave 2)
// --------------------------------------
// From the FILL, not from the cursor. The sounding segment's rule thickens and
// sweeps left to right as it elapses; finished segments read as filled; segments
// still to come are a faint hairline. The playhead survives as a plain brass
// HAIRLINE — no lit tip, no glow: the glowing tip read as a worm crawling the
// band, and once the fill carries the progress the cursor has nothing left to
// prove. Both the fill and the playhead glide on the same 120ms linear ramp —
// as TRANSFORMS (design wave 5): a painted box's position and size are
// pixel-snapped by the engine, so `left`/`width` made a cursor that advances
// half a pixel a second stand still and then jump. The stylesheet carries the
// measurement.
//
// THE NUMERAL HAS ITS OWN GUTTER (design wave 7)
// ----------------------------------------------
// `III.` used to be the first word of the heading, so when the gloss sat under a
// heading the two lines started on different left edges — the translation began
// under the numeral. The numeral is now an INDEX MARK in a fixed-width track to
// the left of the segment's text column, sized once per rail from the widest
// numeral the piece has. Heading and gloss share one text edge.
//
// THE ACCORDION (design wave 7)
// -----------------------------
// Everything on the rail is one line with an ellipsis when it is not sounding.
// When a segment becomes active its segment WIDENS until its heading and its
// gloss each fit whole on one line; its neighbours compress in proportion to
// their own durations, down to a measured floor, and keep their ellipses. The
// time scale therefore stops being uniform, which the user accepted explicitly —
// but the playhead stays truthful inside whatever segment it is in, because it
// is derived from the RENDERED widths (`band.js`, `playheadFraction`) rather
// than from the piece's overall elapsed fraction.
//
// THE BOND (design wave 7)
// ------------------------
// The active segment carries a lifted panel ground, and the listening band's NOW
// register carries the SAME ground, joined by a connector along the band's seam.
// The two read as one shape, which is what lets the NOW register stop reprinting
// a segment heading the rail has already set six inches above it.
//
// Module contract: { position, duration, playing, seeking, data, region }.
// `logger` is threaded alongside as infrastructure, not as content.

import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { smartQuotes } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import { segmentAt } from '../segments.js';
import {
  resolveBandConfig, useNowSide, useEasedVector, accordionShares, playheadFraction,
  bondConnector, elapsedFraction, activeSegmentIndex, placedSegments,
  numeral, numeralText, numeralStyle, ROMAN,
  placedRailSegments, railGroups, railFolds, foldWidthPx,
  railIsFlat, collapseInactiveGroups, foldedShares, densityShares,
  soundingWidth, idealWidth, nameFloorPx, railFloorPx, railWearsChips,
  ACCORDION_MS, SEGMENT_CHIP_FLOOR_PX, NOW_PANEL_SHARE,
} from '../band.js';
import './SegmentMap.scss';

const EMPTY_GROUPS = Object.freeze([]);

/**
 * A tempo marking is WORDS. Figures in a heading mean it is a title — a
 * catalogue number, an opus, a key — and a title is set roman.
 *
 * The rule exists because the divider below is a heuristic and a heuristic needs
 * a guard. On a movement rail the last period genuinely divides a character
 * title from its tempo term; on a rail of WORKS it lands inside the catalogue
 * number, and "No. 5 in F-sharp major, Op. 15 No. 2" was being set as the title
 * "No. 5 in F-sharp major, Op. 15 No." followed by an italic "2" — visible on
 * the office screen as a stray leaning figure at the end of every nocturne.
 */
const tempoLike = (s) => /^[^0-9]+$/.test(s);

/**
 * Split an engraved segment heading into its title and its tempo marking.
 * "Marcia funebre. Adagio assai" -> { title: 'Marcia funebre.', tempo: 'Adagio assai' }
 * "Allegro con brio"            -> { title: null,               tempo: 'Allegro con brio' }
 * "No. 5 in F-sharp major, Op. 15 No. 2" -> { title: <the whole name>, tempo: null }
 * Scores set the tempo term in italic and any character title in roman; the last
 * period is the divider that convention uses, and `tempoLike` is what stops that
 * convention being applied to a string it was never about.
 */
function splitHeading(name) {
  const text = String(name ?? '').trim();
  if (!text) return { title: null, tempo: '' };
  const cut = text.lastIndexOf('.');
  if (cut > 0 && cut < text.length - 1) {
    const head = text.slice(0, cut + 1).trim();
    const tail = text.slice(cut + 1).trim();
    if (tempoLike(tail)) return { title: head, tempo: tail };
  }
  // No divider the convention covers: the whole heading is one thing, and which
  // thing it is decides the face it is set in.
  return tempoLike(text) ? { title: null, tempo: text } : { title: text, tempo: null };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

const partDesignation = (title) => (title ?? '').split(/\s*[—–]\s*/)[0];

/**
 * THE FOUR FIELDS A SEGMENT AUTHORS, and what each one is FOR.
 *
 * `name:` and `heading:` were the corpus's first two words for this and they
 * were both wrong in the same way — either one could plausibly have meant "what
 * this movement is called", so an author had to read the renderer to find out
 * which. The vocabulary is now named by WHERE IT GOES and WHAT IT SAYS:
 *
 *   label:      what the rail prints. The short name of the number — for
 *               Messiah, the incipit ("He trusted in God that He would deliver
 *               Him"). Redundant with the first line of `text:` and deliberately
 *               so: the rail is a contents page and a contents page names things.
 *   heading:    where the words come from. "Psalm 22:8".
 *   subheading: how it is performed. "Chorus", "Air (Tenor)".
 *   text:       the words themselves. NEVER rendered on the rail.
 *
 * `name` IS STILL READ, as a fallback and only as a fallback. 194 work files in
 * the corpus author `name:`, they migrate as a batch rather than atomically with
 * this build, and a rail that renders blank titles for the un-migrated half is a
 * worse outcome than one line of compatibility.
 *
 * A label is set in Garamond on stock; a straight apostrophe in it is the only
 * unset mark on the screen. The annotation line is OPTIONAL: a segment that
 * authors none of its three parts renders no element at all, never an empty line
 * holding space.
 */
const engrave = (m) => ({
  n: m?.n,
  label: smartQuotes(m?.label ?? m?.name ?? ''),
  short: typeof m?.short === 'string' && m.short.trim()
    ? smartQuotes(m.short.trim()) : null,
  // Performance first, source second — "Chorus · Psalm 22:8" reads as a
  // billing, which is what a programme book prints under a number's title. The
  // translation joins the same line because it is the same register (an
  // editor's note about the number, not the number's own words) and the rail
  // has exactly one line for that register.
  annotation: ['subheading', 'heading', 'translation']
    .map((key) => (typeof m?.[key] === 'string' && m[key].trim() ? smartQuotes(m[key].trim()) : null))
    .filter(Boolean)
    .join(' · ') || null,
});

/**
 * The rule has not been measured. Zero is not a width — it is the absence of
 * one, and `accordionShares` treats it as such (the rail renders its
 * duration-derived widths and the accordion stays inert). Named rather than
 * inlined because "no measurement yet" is a state this module reasons about in
 * three places, not a magic zero.
 */
const RAIL_UNMEASURED = 0;

/**
 * The probe has not run — and every consumer of it reads that as "solve the
 * rail the way it was solved before any of this existed". `needs` empty holds
 * the accordion inert; `labels` empty holds every fold unmeasured, and an
 * unmeasured fold is not folded (`foldWidthPx` answers 0, which is the signal).
 * Frozen because it is shared by three call sites and a shared literal that can
 * be written to is a bug waiting for one of them.
 */
const UNMEASURED_RAIL = Object.freeze({
  chromePx: 0, needs: [], shortNeeds: [], labels: Object.freeze({}),
  pillPx: 0, foldMinPx: 0, sceneTiers: Object.freeze({}),
});

export default function SegmentMap({
  position = 0,
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  region = null,
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'segment-map'), [logger]);
  const ruleClickRef = useRef(null);
  const seekTo = useCallback((seconds) => {
    if (!Number.isFinite(seconds)) return;
    const root = ruleClickRef.current ?? document.querySelector('[data-testid="surround-segment-map"]');
    if (root) root.dispatchEvent(new CustomEvent('surround-seek', { bubbles: true, detail: { seconds } }));
  }, []);
  const contentId = data?.contentId ?? null;
  const config = useMemo(() => resolveBandConfig(data), [data]);
  // THE COMPACT RAIL (`band.railDensity: 'bars'`). The rule, its barlines and
  // the playhead, with no names under them — for a band too short to carry
  // type, or a screen where the segment titles belong somewhere else. It is
  // what makes `nowHeading: 'auto'` a real decision rather than a constant:
  // with no names on the rule, the listening band is the only surface left
  // that can say what is sounding, so the NOW heading comes back on.
  const named = config.railDensity !== 'bars';

  // Memoized: the `[]` fallback would otherwise be a fresh array every render and
  // recompute `segments` on every 10 Hz tick.
  const pieceSegments = useMemo(
    () => (Array.isArray(data?.pieceSegments) ? data.pieceSegments : []), [data],
  );

  // ---- WHICH LIST IS THE RAIL ------------------------------------------------
  // TWO LISTS, AND THE DIFFERENCE IS THIS WHOLE WAVE. `payload.pieceSegments` is
  // what the WORK ITSELF authored — for a single polonaise that is one entry or
  // none, and for a container it is a list of `work:` references that name no
  // media and can be placed nowhere. `payload.segments` is the COMPOSED RAIL:
  // every part's segments concatenated onto one sounding-time axis, each
  // carrying the media item it lives in, its span inside that item, and its
  // `offset`/`duration` along the container. Drawing pieceSegments is why a
  // seven-part recital rendered as one segment.
  //
  // The composed rail is present for a single work too (one part, part 0), so
  // this is not a container branch — it is the general case, with the
  // pieceSegments derivation kept as the fallback for a payload built before
  // the store published a rail at all.
  const rail = useMemo(
    () => (Array.isArray(data?.segments) ? data.segments : []), [data],
  );
  const totalSounding = Number(data?.timeline?.totalSounding);
  const composed = rail.length > 0 && Number.isFinite(totalSounding) && totalSounding > 0;

  // The rule ends where the MUSIC ends, not where the file does. The Eroica has
  // ~4½ minutes of applause after the final chord; a bar running to `duration`
  // would tell the viewer the piece is still playing.
  //
  // Fix round 1 (review finding I4): COERCED, not read raw. YAML round-trips
  // can hand this back as a string ("613"), and `Number.isFinite` on a string
  // is always false — silently falling through to `duration` and drawing the
  // rule over the applause. `CueTicker` already reads the same field coerced
  // (`Number(data?.piece?.musicEndsAt)`); this is that same reading, so the
  // two halves of the band cannot disagree about where the music stops.
  const musicEndsAt = Number(data?.piece?.musicEndsAt);
  const pieceEnd = Number.isFinite(musicEndsAt) && musicEndsAt > 0 ? musicEndsAt : duration;

  // THE RAIL'S OWN AXIS ENDS HERE. On a composed rail that is the container's
  // total sounding time, and `musicEndsAt` — a fact about ONE file's applause —
  // has nothing to say about it. On a single work the two axes are the same
  // axis, so this is `pieceEnd` and every derivation below is unchanged.
  const end = composed ? totalSounding : pieceEnd;

  // ONLY THE SEGMENTS THIS RECORDING CAN PLACE. `placedSegments` drops any
  // whose start the store refused (it ships `start: undefined` and warns) or
  // whose start runs backwards — the alternative, the `Number(m?.start) || 0`
  // this used to do, re-anchors a mid-piece segment to the top of the file and
  // draws a zero-width, out-of-order segment with complete confidence. The band
  // asks the same function, so both halves place the same segments.
  const placed = useMemo(() => placedSegments(pieceSegments), [pieceSegments]);

  // The composed rail's own filter: the backend published every width, so the
  // only entry this cannot draw is one with no width at all — the store's
  // documented "this segment's timing was never authored". See
  // `placedRailSegments` for why that is a different question from `placed`'s.
  const placedRail = useMemo(() => placedRailSegments(rail), [rail]);

  // A segment the rail cannot place is a real event on a real screen, not a
  // silent filter: the store already warned that the START was wrong, and this
  // says what the renderer did about it.
  useEffect(() => {
    if (composed) return;
    if (placed.length === pieceSegments.length) return;
    log.warn('surround.segments.unplaceable', {
      contentId,
      authored: pieceSegments.length,
      placed: placed.length,
      dropped: pieceSegments
        .map((m, i) => (placed.some((p) => p.index === i) ? null : (m?.n ?? i + 1)))
        .filter((n) => n !== null),
    });
  }, [composed, placed, pieceSegments, contentId, log]);

  // ---- ONE TIER OR TWO ------------------------------------------------------
  // The labels above the rule: one per consecutive run sharing a group. A
  // single work's rail is one ungrouped run, and renders no row at all — the
  // band keeps exactly the height and the geometry it has today.
  //
  // AND A FLAT RAIL RENDERS NO ROW EITHER (`railIsFlat`). Seven polonaises are
  // seven works of one segment each, so every heading names exactly what the
  // segment under it names, and the row was printing the same title a second
  // time in a second face — both copies ellipsized, neither of them whole. The
  // same decision then re-numbers the gutter below: see `segments`.
  // WHICH LEVEL THE HEADING ROW PRINTS. A work nested Part > Scene > Number
  // ships an ancestry on every segment, and the rail can only print one row: at
  // the office's ~822px Messiah's 53 numbers chip at ~15px each, where sixteen
  // scene titles is a row of ellipses and three Part names is a heading a viewer
  // can read. So an ancestry two deep or more prints its OUTERMOST level, and
  // everything shallower is unchanged — one level, its own group, as before.
  const nested = composed && placedRail.some(({ segment }) =>
    (segment?.groupPath?.length ?? segment?.ancestors?.length ?? 0) > 1);

  /**
   * WHERE THE TRANSPORT IS ON THE RAIL — hoisted above the accordion, because
   * which Part is drawn in full depends on which Part is sounding. It is the
   * same `segmentAt` call the playhead uses further down; hoisting it means one
   * answer, not two that could disagree at a boundary.
   */
  const mapped = useMemo(
    () => (composed ? segmentAt({ segments: rail, contentId, position }) : null),
    [composed, rail, contentId, position],
  );

  /**
   * THE SOUNDING GROUP, at the level the headings print.
   *
   * In a gap — a Part break, the applause before the first number — nothing is
   * sounding and `segmentAt` answers -1. The rail does NOT unfold there: it
   * stays with the Part it last heard, because a rail that expanded to all 53
   * for the ninety seconds between Parts and folded again on the downbeat would
   * be doing its most violent redraw at the exact moment nobody asked for one.
   */
  // HOISTED, because the fold now needs it. `railPx` is the RULE's measured
  // width — the rule is `width: 100%`, so it is a fact about the screen and not
  // about what the fold decided, which is what makes it safe to read here.
  const [railPx, setRailPx] = useState(RAIL_UNMEASURED);

  const activeGroupIndex = useMemo(() => {
    if (!nested) return null;
    const indexOf = (p) => {
      const path = p?.segment?.groupPath ?? p?.segment?.ancestors;
      const raw = Number(path?.[0]?.index);
      return Number.isFinite(raw) ? raw : null;
    };
    if (mapped && mapped.index >= 0) {
      const here = placedRail.find((p) => p.index === mapped.index);
      if (here) return indexOf(here);
    }
    let last = null;
    for (const p of placedRail) {
      if (p.segment.offset + p.segment.duration <= (mapped?.globalSeconds ?? 0)) last = p;
      else break;
    }
    return last ? indexOf(last) : indexOf(placedRail[0]);
  }, [nested, mapped, placedRail]);

  /**
   * DOES THIS RAIL NEED THE ROOM? A FOLD IS A CONCESSION, NOT A HOUSE STYLE.
   *
   * Folding used to be unconditional: any work with more than one outermost
   * group folded every group but the sounding one, on every screen, at every
   * width. Chopin's twenty-four Etudes is what showed that up — two opus runs
   * on a 1714px rule is ~71px a segment, three times a chip's width, and the
   * band still hatched Op. 10 away and printed "12" where twelve etudes had
   * room to be twelve marks. The owner's word for it was "we have plenty of
   * room", and the rail had no way to know that because nobody had asked it.
   *
   * THE TEST IS THE UNFOLDED RAIL'S OWN SHARE, against twice the chip floor.
   * `SEGMENT_CHIP_FLOOR_PX` is what one mark needs; a rail where every segment
   * is exactly one chip wide is a solid run of marks with no air between them —
   * the ragged bar chart `densityShares` already argues against — so the room a
   * segment actually needs is the mark AND its air. Measured against the rule
   * widths `band.measure` already records (608px at 960, 822px at 1280, 1251px
   * at 1920): Chopin's 24 etudes get 52px at 1920 and stay open, get 34px at
   * 1280 and fold, and a 53-movement Messiah gets 23.6px and folds on every
   * screen in the fleet — which is the case the fold was built for.
   *
   * IT IS MEASURED ON `placedRail`, THE AUTHORED COUNT, and on the rule's own
   * width — neither of which is downstream of the fold. A test that read the
   * DRAWN rail would decide to fold, and then measure the folded rail as roomy,
   * and unfold: a rail that flickered at its own threshold.
   *
   * UNMEASURED MEANS OPEN. Before the first measurement `railPx` is the
   * sentinel, and the honest first paint of a rail nobody has measured is the
   * whole rail — a fold that had to be undone a frame later is the flap this
   * whole module is built to avoid.
   */
  const foldsForRoom = useMemo(() => {
    if (!(railPx > 0) || placedRail.length === 0) return false;
    return railPx / placedRail.length < SEGMENT_CHIP_FLOOR_PX * 2;
  }, [railPx, placedRail.length]);

  /**
   * THE DRAWN RAIL. On everything shipped today this IS `placedRail` — the same
   * array, not a copy — so no instrumental work changes by a pixel. A Part >
   * Scene > Number work folds its silent Parts to one segment each; see
   * `collapseInactiveGroups` for why that keeps the axis intact.
   *
   * THE ROOM TEST IS NOT APPLIED HERE, deliberately — see `foldsForRoom`, which
   * gates the OTHER fold. A two-level work is Messiah-shaped by construction
   * (parts holding scenes holding numbers), and on every root in the fleet its
   * rail is past the threshold anyway; putting the gate on both paths would
   * change a behaviour nobody has reported against for no measured gain.
   */
  const drawnRail = useMemo(
    () => (nested ? collapseInactiveGroups(placedRail, { activeGroupIndex, depth: 0 }) : placedRail),
    [nested, placedRail, activeGroupIndex],
  );

  const groups = useMemo(
    () => (composed ? railGroups(drawnRail) : []),
    [composed, drawnRail],
  );
  const flat = composed && railIsFlat(groups);

  // ONE COORDINATE SYSTEM FOR EVERYTHING BELOW, whichever list produced it.
  // A composed rail is measured in the container's SOUNDING seconds (`offset`);
  // a single work's rail is measured in that file's media seconds. Both are
  // flattened here to `{ start, stop, natural }` on one axis that runs to `end`,
  // which is what lets the accordion, the bond, the numeral gutter and the
  // reduced-motion paths stay exactly as they were: they consume shares and an
  // active index, and none of them knows or cares which axis produced them.
  //
  // WIDTHS COME FROM `duration`, NOT FROM START DELTAS. On a composed rail the
  // gap between one part's last segment and the next part's first is a change of
  // FILE, not a stretch of music; measuring it would hand the dead time at a
  // part boundary to whichever segment happened to precede it.
  const segments = useMemo(() => {
    if (composed) {
      // WIDTHS, once the accordion is in play, are NOT duration/total. A folded
      // Part is a marker and takes a placeholder share; the sounding Part takes
      // everything the markers gave up. See `foldedShares` for why proportion
      // is broken here on purpose. With nothing folded this returns exactly
      // `duration / totalSounding`, which is what every other work still gets.
      const shares = foldedShares(drawnRail.map(({ segment: m }) => m));
      return drawnRail.map(({ segment: m }, i) => ({
        ...engrave(m),
        // THE NUMBER THE GUTTER SETS. On a grouped rail it is the corpus's own:
        // étude 5 is `No. 5` under its opus heading, and the mark has to match
        // the name beside it. On a FLAT rail — a list of works, each
        // contributing the one movement it has — every part authored `n: 1`
        // about itself, so the authored numbers say `I.` all the way along and
        // number nothing. There the mark counts along the rail.
        // A FOLD IS NOT THE nth OF ANYTHING. On a flat rail the gutter counts
        // along the rail (`i + 1`), which handed a folded Part the mark "1" and
        // made it read as a Part containing one number. It carries its COUNT
        // instead, below.
        n: m.collapsed ? null : (flat ? i + 1 : m.n),
        collapsed: !!m.collapsed,
        count: Number(m.count) || 0,
        start: m.offset,
        stop: m.offset + m.duration,
        mediaStart: Number(m.start) || 0,
        natural: shares[i] ?? (m.duration / totalSounding),
      }));
    }
    if (!placed.length) return [];
    const first = placed[0].start;
    const span = end - first;
    if (!(span > 0)) return [];
    return placed.map(({ segment: m, start }, i) => {
      const next = i + 1 < placed.length ? placed[i + 1].start : end;
      const stop = Math.max(start, Math.min(next, end));
      return {
        ...engrave(m),
        start,
        stop,
        mediaStart: start,
        natural: (stop - start) / span,
      };
    });
  }, [composed, drawnRail, totalSounding, flat, placed, end]);

  const first = segments.length ? segments[0].start : 0;

  // ---- WHERE THE TRANSPORT IS, ON THE RAIL'S AXIS ---------------------------
  // `position` belongs to ONE media item. On a single work that item is the
  // rail, so the two are the same number. On a container it is a position
  // inside part 3 of seven, and the mapping onto the container's axis — with
  // its tie-break at a shared offset, and its -1 for dead time — was settled in
  // `../segments.js` and is NOT re-decided here. `contentId` is the PLAYING
  // item's id: `SurroundFrame` stamps the seam's id onto the payload before any
  // module sees it, which is what makes this resolvable without widening the
  // module contract.
  const railPosition = composed ? mapped.globalSeconds : position;

  // -1 = NO SEGMENT IS SOUNDING — the applause after the final chord, and
  // equally the tuning or the announcement before the first one. This loop used
  // to fall through to `return 0` for a position before the first start, which
  // lit segment I over music that had not begun while the band six inches below
  // printed its "nothing is playing" header. One derivation now answers for
  // both (`../band.js`), and it answers -1.
  //
  // The composed rail gets the same answer from `segmentAt`, translated from a
  // position in the FULL rail to one in the drawn subset — the two differ by
  // exactly the zero-width segments, which `segmentAt` can never return.
  const activeIndex = useMemo(() => {
    if (composed) {
      if (!mapped || mapped.index < 0) return -1;
      return drawnRail.findIndex((p) => p.index === mapped.index);
    }
    return activeSegmentIndex({ placed: segments, position, end });
  }, [composed, mapped, drawnRail, segments, position, end]);
  /**
   * THE RAIL HAS NO SEGMENT FOR THE ITEM ON SCREEN.
   *
   * Not a state the music can be in — a wiring fault. The office played the
   * étude season with the CONTAINER's id on the item while part three sounded,
   * and since every segment is stamped with a part's id the match found nothing:
   * `segmentAt` reported nothing sounding at second zero and the rule painted
   * twenty-seven segments as a finished recital, with no playhead and no bond.
   *
   * It is a warn because it is invisible on the screen it ruins — a full rule
   * looks exactly like a full rule — and because nothing about the corpus can
   * cause it. `railContentId` (`../segments.js`) is the fix for the known route;
   * this is how the next one announces itself.
   */
  const unmapped = composed && contentId != null && rail.length > 0
    && !rail.some((c) => String(c.contentId) === String(contentId));
  const lastUnmapped = useRef(null);
  useEffect(() => {
    const key = unmapped ? String(contentId) : null;
    if (lastUnmapped.current === key) return;
    lastUnmapped.current = key;
    if (!unmapped) return;
    log.warn('surround.rail.unmapped', {
      contentId,
      segments: rail.length,
      parts: [...new Set(rail.map((c) => c.contentId))].slice(0, 12),
    });
  }, [unmapped, contentId, rail, log]);

  /**
   * Nothing has sounded YET — as against nothing sounding any more.
   *
   * THE COMPARISON IS `<=`, NOT `<`, and on a composed rail that is the whole
   * difference. There the axis is sounding seconds, the first segment starts at
   * 0, and `segmentAt` reports the lead-in as second zero — so `< 0` was
   * unsatisfiable and every recording that opens on applause or a walk-on
   * painted its whole rule as already played, which says the programme is over
   * before it has begun. An unmappable item reads the same way for the same
   * reason, and reads as not-yet rather than as finished.
   */
  const unsounded = activeIndex < 0 && segments.length > 0
    && (unmapped || railPosition <= segments[0].start);

  // A corpus group path is generic and recursive. Each existing depth becomes
  // one labelled row, outermost first; a work with no groups has no extra row.
  // The legacy composed-work `group` remains the one-level fallback.
  const groupLevels = useMemo(() => {
    if (!composed) return [];
    const depth = Math.max(0, ...placedRail.map(({ segment }) => (
      Array.isArray(segment?.ancestors) ? segment.ancestors.length : 0
    )));
    if (depth) return Array.from({ length: depth }, (_, level) => railGroups(
      placedRail, (segment) => segment?.ancestors?.[level] ?? null,
    )).filter((runs) => runs.some((run) => run.title));
    // Existing payloads can still carry the fixed two-level transport shape.
    // Read it until all cached clients have crossed the generic-groups seam.
    const legacyParts = railGroups(placedRail, (segment) => segment?.hierarchy?.part);
    const legacyScenes = railGroups(placedRail);
    if (legacyParts.some((run) => run.title)) return [legacyParts, legacyScenes];
    return legacyScenes.some((run) => run.title) ? [legacyScenes] : [];
  }, [composed, placedRail]);
  const grouped = groupLevels.length > 0;

  // ---- THE FOLD (design wave 10) --------------------------------------------
  // Every part except the sounding one collapses to one elided block. The rail
  // stopped being readable at Messiah's scale for a reason arithmetic can state:
  // 53 numbered movements across a 1714px rule is 32px each, so the rail spent
  // three quarters of its width numbering music nobody is listening to, and the
  // part that IS sounding got the same 32px a segment as the two that are not.
  //
  // It is the outermost visible authored level that folds. A recursive group
  // tree therefore folds by Act/Part/Book (or whatever its first level is).
  //
  // TWO DIFFERENT NUMBERS SHARE THE NAME "COUNT" HERE, AND THEY DIVERGE ON A
  // NESTED RAIL. `collapseInactiveGroups` has already merged every inactive
  // Part's segments into exactly ONE `drawnRail` entry (band.js:484) — so
  // `count`, what the BADGE shows and what decides whether folding is even
  // worth it, is the TRUE pre-collapse segment count carried on that merged
  // entry; `slots`, what `groupBasis` and the accordion's own width math index
  // `drawnRail`/`segments`/`shares` with, is how many ARRAY POSITIONS the run
  // actually occupies — always 1 for an already-collapsed Part, never more.
  // Feeding the true count where an array bound is expected walks off the
  // fold's own position into whichever segments happen to sit after it.
  const drawnPartGroups = useMemo(() => {
    if (!composed || groupLevels.length === 0) return EMPTY_GROUPS;
    if (!nested) return groupLevels[0];
    const runs = [];
    drawnRail.forEach(({ segment }, i) => {
      const group = segment?.ancestors?.[0] ?? null;
      const raw = Number(group?.index);
      const index = group && Number.isFinite(raw) ? raw : null;
      const title = index === null ? null
        : (typeof group.title === 'string' && group.title.trim() ? group.title.trim() : null);
      const mini = typeof group?.mini === 'string' && group.mini.trim() ? group.mini.trim() : null;
      const segCount = Number(segment?.count) || 1;
      const duration = Number(segment?.duration) || 0;
      const last = runs[runs.length - 1];
      if (last && last.index === index) {
        last.count += segCount;
        last.slots += 1;
        last.span += duration;
        return;
      }
      runs.push({
        title, mini, index, from: i, count: segCount, slots: 1, span: duration,
      });
    });
    return runs;
  }, [composed, nested, drawnRail, groupLevels]);
  // WHICH RUNS ARE ACTUALLY FOLDED. On a nested rail the question is already
  // answered — a run whose one array position is a `collapsed` marker WAS the
  // fold, and asking `railFolds` to rediscover that from `slots` (always 1)
  // would immediately fail its own `count > 1` eligibility check, and worse,
  // feeding it the TRUE count in place of `slots` would make its `activeIndex`
  // boundary check claim positions that belong to whatever run comes after —
  // exactly the coordinate confusion this file was already broken by once. Off
  // a nested rail this is the ordinary accordion (`railFolds` on `slots`,
  // stamped back onto `count` for `folded`, below).
  const folds = useMemo(() => {
    if (nested) {
      return drawnPartGroups.filter((run) => run.title && run.count > 1
        && drawnRail[run.from]?.segment?.collapsed);
    }
    if (!foldsForRoom) return EMPTY_GROUPS;
    return railFolds({ groups: drawnPartGroups, activeIndex })
      .map((f) => ({ ...f, slots: f.count }));
  }, [nested, drawnPartGroups, drawnRail, activeIndex, foldsForRoom]);

  // ---- WHICH SCENE IS SOUNDING (for the inner heading row) ------------------
  // The scene level is groupLevels[1] when there are two+ levels. The active
  // scene is the run whose segment range contains the active segment index —
  // within the DRAWN rail, not the full rail, because collapsed parts have been
  // replaced by one-segment folds.
  const drawnSceneGroups = useMemo(() => {
    if (groupLevels.length < 2 || !nested) return EMPTY_GROUPS;
    return railGroups(drawnRail, (segment) => segment?.ancestors?.[1] ?? null);
  }, [groupLevels.length, nested, drawnRail]);
  const activeSceneIndex = useMemo(() => {
    if (!drawnSceneGroups.length || activeIndex < 0) return -1;
    for (const run of drawnSceneGroups) {
      if (activeIndex >= run.from && activeIndex < run.from + run.count) {
        return run.index ?? -1;
      }
    }
    return -1;
  }, [drawnSceneGroups, activeIndex]);

  // HOW MANY SCENES EACH FOLD COVERS. On a flat (non-nested) rail this walks
  // the drawn rail across the fold's own slots, because every scene is still
  // individually present there. On a NESTED rail it cannot: a fold is now one
  // `drawnRail` position, carrying only the FIRST folded segment's ancestry —
  // `collapseInactiveGroups` kept just that one and dropped the rest, so the
  // scene detail for everything after it is gone from `drawnRail` by the time
  // it gets here. It is recovered instead from the full pre-collapse
  // `groupLevels`, which are both anchored to `placedRail`'s OWN coordinate
  // space and so never mismatch each other — matched to this fold by its
  // stable semantic `index`, not by any position.
  const foldSceneCounts = useMemo(() => {
    if (!folds.length || groupLevels.length < 2) return new Map();
    const counts = new Map();
    if (nested) {
      const fullParts = groupLevels[0];
      const fullScenes = groupLevels[1];
      folds.forEach((fold) => {
        const part = fullParts.find((p) => p.index === fold.index);
        if (!part) { counts.set(fold.index, 0); return; }
        let n = 0;
        for (const scene of fullScenes) {
          if (scene.from >= part.from && scene.from < part.from + part.count) n += 1;
        }
        counts.set(fold.index, n);
      });
      return counts;
    }
    folds.forEach((fold) => {
      const scenes = new Set();
      for (let i = fold.from; i < fold.from + fold.slots; i += 1) {
        const sceneIdx = drawnRail[i]?.segment?.ancestors?.[1]?.index;
        if (sceneIdx != null) scenes.add(sceneIdx);
      }
      counts.set(fold.index, scenes.size);
    });
    return counts;
  }, [folds, groupLevels, nested, drawnRail]);

  // ---- the accordion's two measurements -------------------------------------
  // The rule's own width, and how wide the SOUNDING segment would have to be for
  // neither its heading nor its gloss to be cut. Both are read off the DOM
  // because both are typographic facts (how wide is this rail, how wide is this
  // string in this face at this size) that no amount of arithmetic can supply.
  const ruleRef = useRef(null);
  const probeRef = useRef(null);
  /**
   * What the RAIL is, typographically — read once per rail off the probe below,
   * never off the segments the accordion has already sized.
   *
   * `chromePx` is a segment's furniture (the numeral's gutter and the text
   * insets) and `needs[i]` is how wide segment i's widest line sets on one line.
   * Both are independent of the widths the accordion applies, which is what
   * makes the solve non-circular: measuring `need` off a live segment would read
   * a box the last solve had already resized, and the chip decision taken from
   * it would flip on its own output.
   */
  const [metrics, setMetrics] = useState(UNMEASURED_RAIL);
  const [fontsTick, setFontsTick] = useState(0);

  useEffect(() => {
    const rule = ruleRef.current;
    if (!rule || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const w = Number(entry.contentRect?.width) || 0;
        setRailPx(w > 0 ? w : RAIL_UNMEASURED);
      });
    });
    observer.observe(rule);
    return () => observer.disconnect();
  }, [segments.length]);

  // Web fonts land after the first layout, and Cormorant is much wider than the
  // fallback serif — a width measured before it arrives would open the accordion
  // to the wrong number and never correct itself.
  useEffect(() => {
    let live = true;
    document?.fonts?.ready?.then?.(() => { if (live) setFontsTick((t) => t + 1); });
    return () => { live = false; };
  }, []);

  /**
   * THE RAIL, MEASURED ON ITS PROBE — the one measurement pass, run once per
   * rail (and again when the faces land) rather than once per segment boundary.
   *
   * IT MEASURES THE PROBE, NOT THE SEGMENTS, and that is the whole reason the
   * probe exists. Two of the numbers below are needed for segments that are NOT
   * rendering their names at all — that is what chip mode is — so there is no
   * segment to read them off; and the numbers that could be read off a live
   * segment would be read off a box the previous solve had already resized,
   * which is a decision feeding on its own output.
   */
  const measureRail = useCallback(() => {
    const probe = probeRef.current;
    // A bars-only rail has no type to right-size for.
    if (!probe || !named || !segments.length) { setMetrics(UNMEASURED_RAIL); return; }
    const row = probe.querySelector('.surround-segment-map__text-row');
    const cell = probe.querySelector('.surround-segment-map__text');
    const heading = probe.querySelector('.surround-segment-map__heading');
    const gloss = probe.querySelector('.surround-segment-map__translation');
    if (!row || !cell || !heading || !gloss) { setMetrics(UNMEASURED_RAIL); return; }
    // The probe row is `width: max-content`, so its numeral track is this rail's
    // own gutter at its own size and its text track is exactly the text — which
    // makes the difference the segment furniture, measured rather than derived
    // from the `em`/`ch` arithmetic in the stylesheet.
    const chromePx = row.getBoundingClientRect().width - cell.getBoundingClientRect().width;
    // THE LABEL A SILENT SEGMENT WOULD SET, measured in the same face at the
    // same size — `.__short` and `.__heading` are typographically identical, so
    // the heading element is the ruler for both. This is what decides the rail's
    // FLOOR (`railFloorPx`): a `short:` is the corpus's compressed form, so a
    // rail that cannot set it whole has nothing left to compress and wears chips
    // instead of cutting the string that existed to avoid being cut.
    const shortNeeds = segments.map((seg) => {
      if (!seg.short) return 0;
      heading.innerHTML = '';
      heading.textContent = seg.short;
      return heading.getBoundingClientRect().width;
    });
    const needs = segments.map((seg) => {
      const { title, tempo } = splitHeading(seg.label);
      // The heading is two spans with a margin between them, exactly as the
      // segment sets it — a probe holding one concatenated string would measure
      // a narrower line than the rail paints.
      heading.innerHTML = '';
      if (title) {
        const t = document.createElement('span');
        t.className = 'surround-segment-map__title';
        t.textContent = title;
        heading.appendChild(t);
      }
      if (tempo) {
        const t = document.createElement('span');
        t.className = 'surround-segment-map__tempo';
        t.textContent = tempo;
        heading.appendChild(t);
      }
      gloss.textContent = seg.annotation ?? '';
      return Math.max(
        heading.getBoundingClientRect().width,
        seg.annotation ? gloss.getBoundingClientRect().width : 0,
      );
    });
    heading.innerHTML = '';
    gloss.textContent = '';

    // ---- WHAT A FOLD IS SIZED BY (design wave 10) --------------------------
    // Both are constants of the PIECE, measured on the same pass and never on
    // `activeIndex`: the widest part label this rail has, and the badge holding
    // its longest count. Measuring the folds that are folded RIGHT NOW would
    // make the width a function of where the playhead is, and the width feeds
    // the solve that decides where everything is drawn — a measurement reading
    // its own output, which is the one thing this probe exists to prevent.
    const labelProbe = probe.querySelector('.surround-segment-map__group');
    const pillProbe = probe.querySelector('.surround-segment-map__fold-count');
    // The most scenes any one Part of this work holds — the second number the
    // badge can ever set. Same pre-collapse source `foldSceneCounts` reads.
    const widestSceneCount = (nested && groupLevels.length > 1)
      ? groupLevels[0].reduce((max, part) => {
        let n = 0;
        for (const scene of groupLevels[1]) {
          if (scene.from >= part.from && scene.from < part.from + part.count) n += 1;
        }
        return Math.max(max, n);
      }, 0)
      : 0;
    const labels = {};
    let pillPx = 0;
    let foldMinPx = 0;
    if (labelProbe && pillProbe) {
      drawnPartGroups.forEach((run) => {
        const short = partDesignation(run.title);
        if (short && labels[short] === undefined) {
          labelProbe.textContent = short;
          labels[short] = labelProbe.getBoundingClientRect().width;
        }
        if (run.title && labels[run.title] === undefined) {
          labelProbe.textContent = run.title;
          labels[run.title] = labelProbe.getBoundingClientRect().width;
        }
      });
      labelProbe.textContent = '';
      const widest = drawnPartGroups.reduce((max, run) => Math.max(max, run.count), 0);
      // THE BADGE IS MEASURED AS THE RAIL PAINTS IT — BOTH numbers and the rule
      // between them. The probe used to set only the segment count, so every
      // fold on a nested work was sized for a badge narrower than its own, and
      // the pair had to go somewhere: inside the grid chip it went to a second
      // line. The scene count is read off `groupLevels`, which is pre-collapse
      // and therefore a constant of the PIECE — measuring the folds that are
      // folded right now would make the width a function of the playhead, which
      // is the feedback loop this whole probe exists to prevent.
      pillProbe.innerHTML = '';
      const segs = document.createElement('span');
      segs.className = 'surround-segment-map__fold-segments';
      segs.textContent = String(widest || 0);
      pillProbe.appendChild(segs);
      if (widestSceneCount > 0) {
        const scenes = document.createElement('span');
        scenes.className = 'surround-segment-map__fold-scenes';
        scenes.textContent = String(widestSceneCount);
        pillProbe.appendChild(scenes);
      }
      pillPx = pillProbe.getBoundingClientRect().width;
      pillProbe.innerHTML = '';
      // The fold needs enough width for whichever is wider: its Part label
      // or its badge pill. This is the measured minimum — no fold may be
      // narrower than this, and no fold needs to be wider.
      const designationWidths = drawnPartGroups
        .map((run) => labels[run.mini ?? partDesignation(run.title)] ?? 0);
      const widestDesignation = Math.max(0, ...designationWidths);
      const groupPad = labelProbe ? parseFloat(getComputedStyle(labelProbe).paddingLeft) + parseFloat(getComputedStyle(labelProbe).paddingRight) : 16;
      foldMinPx = foldWidthPx({ labelPx: widestDesignation + groupPad, pillPx });
    }

    // SCENE LABEL WIDTHS — measured so the render can decide full-title vs
    // numeral-only without ever showing an ellipsis.
    const sceneTiers = {};
    if (labelProbe) {
      drawnSceneGroups.forEach((run) => {
        if (sceneTiers[run.index] !== undefined) return;
        const measure = (text) => {
          labelProbe.textContent = text;
          return labelProbe.getBoundingClientRect().width;
        };
        const markText = ROMAN[run.index + 1] ?? String(run.index + 1);
        const markW = measure(markText);
        const miniW = run.mini ? measure(`${markText} ${run.mini}`) : 0;
        const fullW = run.title ? measure(`${markText} ${run.title}`) : 0;
        sceneTiers[run.index] = { markW, miniW, fullW };
      });
      labelProbe.textContent = '';
    }

    setMetrics({ chromePx, needs, shortNeeds, labels, pillPx, foldMinPx, sceneTiers });
  }, [named, segments, drawnPartGroups, drawnSceneGroups, nested, groupLevels]);

  useLayoutEffect(() => { measureRail(); }, [measureRail, fontsTick]);

  // THE RAIL'S OWN FLOOR, and the decision it drives. Both are constants of the
  // PIECE — the widest name it has, against the width of its rule — never of
  // this instant, because a rail that swapped between chips and names at a
  // segment boundary would read as a bug rather than as a density.
  // THE FLOOR THIS RAIL IS JUDGED AGAINST. Where every drawn segment carries a
  // `short:`, the corpus has said what the compressed form is, and the floor
  // becomes what the widest of them needs to set WHOLE — so a rule that cannot
  // afford that chips rather than cutting the string that existed to avoid
  // being cut. A rail with no short labels (or only some) is judged exactly as
  // it always was: three glyphs and an ellipsis.
  const everyShort = segments.length > 0 && segments.every((s) => s.short);
  const labelPx = everyShort && metrics.shortNeeds.length
    ? Math.max(...metrics.shortNeeds) : null;
  const floorPx = railFloorPx({ chromePx: metrics.chromePx, labelPx });
  const widestPx = useMemo(() => (metrics.needs.length
    ? idealWidth({ chromePx: metrics.chromePx, needPx: Math.max(...metrics.needs) })
    : 0), [metrics]);
  const chips = named && railWearsChips({
    railPx, count: segments.length, widestPx, floorPx,
  });

  // ---- THE FOLD, SOLVED (design wave 10) -----------------------------------
  // One pass turns the runs `railFolds` chose into the two things the rest of
  // the module needs: the pin vector the accordion solves against, and the map
  // the renderer draws from. They are built together so they cannot disagree
  // about which runs are actually folded — a fold drawn without a pin is a block
  // sitting at a duration's width, and a pin without a block is a hole.
  const folded = useMemo(() => {
    const none = { pins: null, blocks: new Map(), hidden: new Set() };
    if (!folds.length || !(railPx > 0) || !segments.length) return none;
    const pins = new Array(segments.length).fill(null);
    const blocks = new Map();
    const hidden = new Set();
    folds.forEach((fold) => {
      const width = foldWidthPx({
        labelPx: metrics.labels?.[partDesignation(fold.title)] ?? 0,
        pillPx: metrics.pillPx ?? 0,
      });
      // NOT MEASURED IS NOT FOLDED. Before the faces land there is no honest
      // width for the label, and a fold guessed at is a block that resizes
      // under the viewer when Cormorant arrives.
      if (!(width > 0)) return;
      // A FOLD ONLY EVER SHRINKS — the run's whole natural width against the
      // one width that replaces it, which is the only place that comparison can
      // be made (`accordionShares` sees the run as one pin and n-1 zeroes).
      // A part so short that its label is wider than its music stays open: an
      // elision drawn bigger than the thing elided is a worse rail, not a
      // denser one.
      //
      // ON A NESTED RAIL THIS NEVER TAKES — and that is correct, not a gap.
      // `foldedShares` has already given the run's one collapsed marker a
      // fixed, tiny placeholder width (`FOLD_SHARE`, band.js) as its natural
      // share; that is ALWAYS narrower than a Part label, so this box (with
      // its hatched lane and its own badge face) never wins the comparison —
      // the marker draws through the ordinary per-segment branch instead,
      // where `seg.collapsed`/`seg.count` carry the same count. This pass
      // still runs for a nested fold (harmlessly a no-op) rather than being
      // skipped, so the one accounting — pins, blocks, hidden — never has to
      // agree with a second, parallel decision about which rails qualify.
      let naturalPx = 0;
      for (let i = fold.from; i < fold.from + fold.slots; i += 1) {
        naturalPx += (segments[i]?.natural ?? 0) * railPx;
      }
      if (width >= naturalPx) return;
      pins[fold.from] = width;
      for (let i = fold.from + 1; i < fold.from + fold.slots; i += 1) {
        pins[i] = 0;
        hidden.add(i);
      }
      blocks.set(fold.from, fold);
    });
    return blocks.size ? { pins, blocks, hidden } : none;
  }, [folds, segments, railPx, metrics]);

  useEffect(() => {
    if (!folds.length) return;
    log.debug('surround.rail.fold', {
      contentId,
      runs: folds.length,
      folded: folded.blocks.size,
      hiddenSegments: folded.hidden.size,
      of: segments.length,
      // What the folds were sized by. A fold that came out at the pill's floor
      // rather than at its label's width is a rail whose part names are shorter
      // than their badges, which is worth seeing in the store.
      pillPx: Math.round(metrics.pillPx ?? 0),
      widths: [...folded.blocks.values()].map((f) => ({
        title: f.title,
        count: f.count,
        labelPx: Math.round(metrics.labels?.[partDesignation(f.title)] ?? 0),
      })),
    });
  }, [folds, folded, segments.length, metrics, contentId, log]);

  useEffect(() => {
    if (!segments.length || !(railPx > 0) || !metrics.needs.length) return;
    // INFO, NOT DEBUG. The shipper drops debug, so a rail state logged there is
    // invisible unless somebody is holding devtools open on the screen itself —
    // which is precisely when it cannot be observed. One event per rail; the
    // volume is nothing and the answer to "what did it draw" is total.
    log.info('surround.rail.density', {
      contentId,
      density: chips ? 'chips' : 'names',
      segments: segments.length,
      railPx: Math.round(railPx),
      widestPx,
      chromePx: Math.round(metrics.chromePx),
      nameFloorPx: floorPx,
      // The threshold itself: what each inactive segment would have if the
      // widest name on this rail were open. Below the floor, the rail chips.
      roomPx: Math.round((railPx - Math.min(widestPx, railPx)) / Math.max(1, segments.length - 1)),
    });
  }, [chips, segments.length, railPx, widestPx, floorPx, metrics, contentId, log]);

  // THE SOUNDING SEGMENT'S IDEAL WIDTH, from the same measurements. `segW`/
  // `cellW` are this segment's NATURAL (duration-derived) geometry rather than
  // its rendered geometry, so `desiredWidth`'s "does it already fit" test is
  // asked about the width the rail would give it anyway — the question the
  // accordion is actually deciding — and cannot be answered by the width the
  // accordion has already granted.
  const desiredPx = useMemo(() => {
    if (activeIndex < 0 || !named || !(railPx > 0) || !metrics.needs.length) return 0;
    return soundingWidth({
      naturalPx: (segments[activeIndex]?.natural ?? 0) * railPx,
      chromePx: metrics.chromePx,
      needPx: metrics.needs[activeIndex] ?? 0,
    });
  }, [activeIndex, named, railPx, metrics, segments]);

  // Review finding I5: the accordion's one measured input. It decides every
  // width on the rail and it is read off the DOM in a face that arrives
  // asynchronously, so it is the number to look at first when a rail on a real
  // screen is not the shape it should be.
  useEffect(() => {
    if (!(desiredPx > 0)) return;
    log.debug('surround.accordion.measured', {
      contentId, index: activeIndex, desired: desiredPx,
      need: Math.round(metrics.needs[activeIndex] ?? 0),
      chrome: Math.round(metrics.chromePx), railPx: Math.round(railPx),
    });
  }, [desiredPx, activeIndex, metrics, railPx, contentId, log]);

  /**
   * THE WIDTH SOURCE. In name mode it is the clock, as it always was. In CHIP
   * mode it is the type: uniform chips, the sounding segment at its title's
   * width, a folded Part at its Part title's width — see `densityShares`, and
   * `metrics.needs` is already the measurement it wants, because a fold's
   * `name` IS its parent Part's title (`collapseInactiveGroups`), so the same
   * probe pass that measures every other label measures the folds too.
   */
  const widthBasis = useMemo(() => (chips
    ? densityShares({
      segments,
      needs: metrics.needs,
      chromePx: metrics.chromePx,
      railPx,
      activeIndex,
      foldMinPx: metrics.foldMinPx,
    })
    : segments.map((s) => s.natural)), [chips, segments, metrics, railPx, activeIndex]);

  const targetShares = useMemo(() => accordionShares({
    // In chip mode the sounding segment is ALREADY its title's width here, so
    // `accordionShares` finds no extra to ask for and returns this untouched —
    // the two mechanisms compose rather than each widening the same segment.
    natural: widthBasis,
    activeIndex,
    railPx,
    desiredPx,
    // A CHIPPED neighbour needs room for a chip, not for a name. Holding it at
    // the name floor is exactly what makes a twenty-one segment rail insoluble:
    // 21 x 77px is more rule than any screen in the fleet has, so the accordion
    // could donate nothing and the sounding segment could never have its name
    // whole — the guarantee this mode exists to keep.
    floorPx: chips ? SEGMENT_CHIP_FLOOR_PX : floorPx,
    // The folds, settled before anything opens — see `accordionShares`. Null on
    // a rail with nothing folded, which is every rail this module drew before
    // design wave 10 and every solve it produces is unchanged there.
    pinnedPx: folded.pins ?? (segments.some((s) => s.collapsed) && metrics.foldMinPx > 0
      ? segments.map((s) => (s.collapsed ? metrics.foldMinPx : null))
      : null),
  }), [widthBasis, activeIndex, railPx, desiredPx, chips, floorPx, folded, segments, metrics.foldMinPx]);

  // ---- the bond -------------------------------------------------------------
  // ONE definition of "how far through the piece" (review finding I3) — see
  // `elapsedFraction`. The band computes its own side from the same function
  // with the same inputs, so the two halves of the bond cannot point at
  // opposite sides of the screen.
  const side = useNowSide(config, elapsedFraction({ position: railPosition, first, end }), log);

  // ---- the bond's target, on the SAME vector as the widths ------------------
  // Design wave 9. The bond used to be derived from the interpolated shares and
  // then animated AGAIN by a CSS transition on its own `left`/`width`, because
  // `activeIndex` jumps at a boundary and its derived left edge jumps with it.
  // Two clocks: the rail right-sized itself under a highlight that had not
  // started moving, and the user saw a resize followed by a slide where the
  // design promises one move. So the bond's own start and width are appended to
  // the vector the shares ride in and interpolated with them — one clock, one
  // array, one render, exactly as the playhead already is.
  const lastBond = useRef([0, 0]);
  const bondTarget = useMemo(() => {
    // NOTHING SOUNDING holds the bond's geometry where it was rather than
    // collapsing it to zero. The bond is faded out in that state (see the
    // stylesheet), and a fade is a fade — sliding an invisible box back to the
    // origin only means it has to slide out again when the music resumes.
    if (activeIndex < 0 || !targetShares.length) return lastBond.current;
    let start = 0;
    for (let i = 0; i < activeIndex; i += 1) start += targetShares[i] ?? 0;
    return [start, targetShares[activeIndex] ?? 0];
  }, [activeIndex, targetShares]);
  useEffect(() => {
    if (activeIndex >= 0) lastBond.current = bondTarget;
  }, [bondTarget, activeIndex]);

  // THE NOW PANEL'S OWN POSITION rides in the vector too (review finding I-6).
  // `bondConnector` used to take the side DISCRETELY, so on a `nowSide: dynamic`
  // swap the waist jumped to the new hull in one frame while the panel below it
  // travelled there over 420ms on the CSS clock — the two halves of one shape
  // unwelded for the length of the move, which is the degenerate case the brief
  // named and the defect §7 was written to abolish, one event over. The panel's
  // left edge is a number in shares of the rule (0 or 0.5), so it interpolates
  // like everything else here, and `CueTicker` interpolates the same number with
  // the same hook, the same duration and the same easing, started in the same
  // React commit — so the two halves arrive together frame by frame.
  const panelLeft = side === 'left' ? 0 : 1 - NOW_PANEL_SHARE;

  const geometry = useMemo(
    () => [...targetShares, bondTarget[0], bondTarget[1], panelLeft],
    [targetShares, bondTarget, panelLeft],
  );

  // ONE CLOCK (review finding I2; extended to the bond in design wave 9). The
  // whole geometry is interpolated HERE, in JS, and everything positional below
  // — the segment widths, the playhead, the bond and its waist — is read out of
  // the vector this returns in the same render. The stylesheet animates none of
  // it. Two clocks (a CSS `transition: width` and the playhead's own ramp) is
  // what let the cursor reach the widened solution while the painted boundary
  // was still 300ms away from it.
  const { shares: vector, moving } = useEasedVector(geometry, ACCORDION_MS);
  const shares = useMemo(() => vector.slice(0, targetShares.length), [vector, targetShares.length]);

  /**
   * A HEADING'S WIDTH IS ITS SEGMENTS' RENDERED WIDTHS, summed.
   *
   * `railGroups` reports each run's `from` and `count`, which index straight
   * into the drawn rail and therefore into the share vector the rule is
   * actually painted with. Those were the same number as the run's duration
   * share until the accordion: a folded Part now takes a marker's width rather
   * than its own time, so a heading placed by duration sat over the wrong
   * stretch of rule entirely. "Part Two" belongs above the first number of Part
   * Two, wherever the fold moved it.
   *
   * Falls back to the duration share only before the vector exists, where the
   * two agree anyway.
   */
  const groupBasis = useCallback((group) => {
    const from = Number(group?.from) || 0;
    // `slots` — the run's span in DRAWN-RAIL positions — not `count`, which on
    // a nested rail's folded Part is the true pre-collapse segment count and
    // would walk `shares` straight past this one-position run into whatever
    // sits after it. A group with no `slots` (every non-nested run) has no
    // divergence to guard against, so `count` is exactly the same number.
    const slots = Number(group?.slots ?? group?.count) || 0;
    if (!(slots > 0)) return 0;
    let sum = 0;
    let sawShare = false;
    for (let i = from; i < from + slots; i += 1) {
      const v = Number(shares?.[i]);
      if (Number.isFinite(v)) { sum += v; sawShare = true; }
    }
    if (sawShare) return sum;
    const span = Number(group?.span) || 0;
    return end > 0 ? span / end : 0;
  }, [shares, end]);

  // THE ONE GUARANTEE THIS MODE MAKES, AND WHAT HAPPENS WHEN IT CANNOT BE KEPT.
  // The sounding segment always shows its name whole; chip mode is what buys the
  // room for that on a crowded rail. When even a fully chipped rail cannot spare
  // the width — a rail so long that its chips alone fill the rule, or a name
  // longer than the whole screen — the segment takes what is free and keeps its
  // ellipsis, and THAT IS REPORTED. It is a warn rather than a debug because it
  // is invisible on screen (a trimmed name looks like a trimmed name whatever
  // the reason) and because it is the corpus telling us something: this is the
  // only signal that distinguishes "the rail is crowded" from "somebody authored
  // a name no screen can hold". Debug never reaches the log store.
  const starved = desiredPx > 0 && railPx > 0
    && (targetShares[activeIndex] ?? 0) * railPx < desiredPx - 1;
  const lastStarved = useRef(null);
  useEffect(() => {
    const key = starved ? `${activeIndex}` : null;
    if (lastStarved.current === key) return;
    lastStarved.current = key;
    if (!starved) return;
    log.warn('surround.accordion.degraded', {
      contentId,
      index: activeIndex,
      label: segments[activeIndex]?.label ?? null,
      name: segments[activeIndex]?.label ?? null,
      desired: desiredPx,
      granted: Math.round((targetShares[activeIndex] ?? 0) * railPx),
      floor: chips ? SEGMENT_CHIP_FLOOR_PX : floorPx,
      density: chips ? 'chips' : 'names',
      railPx: Math.round(railPx),
      segments: segments.length,
    });
  }, [starved, activeIndex, desiredPx, targetShares, railPx, segments,
    chips, floorPx, contentId, log]);

  // READ OUT OF THE INTERPOLATED VECTOR, not recomputed from the shares. The two
  // agree at rest and only the vector is right mid-flight, which is the whole
  // point of putting the bond in it.
  //
  // IT IS PUBLISHED WHETHER OR NOT ANYTHING IS SOUNDING (review finding I-2).
  // This used to return `null` when `activeIndex < 0` and the elements then
  // published `--bond-width: 0%` — untransitioned — in the same commit that
  // flipped `data-bonded` to false. So at the final chord the rail's panel and
  // the waist collapsed to nothing in ONE FRAME while the band's panel below
  // them faded over 420ms: half of "one shape" leaving on one clock and half on
  // another, which is §7's defect in the state §8 added. The geometry is held
  // (see `lastBond` above, which is what the vector carries in this state), the
  // fade is the only thing that changes, and both halves now fade together.
  const bonded = activeIndex >= 0;
  const bond = useMemo(() => {
    if (vector.length < targetShares.length + 3) return null;
    const start = vector[targetShares.length] ?? 0;
    const width = vector[targetShares.length + 1] ?? 0;
    const panelAt = vector[targetShares.length + 2];
    return {
      start,
      width,
      connector: bondConnector({ segStart: start, segEnd: start + width, panelStart: panelAt }),
    };
  }, [vector, targetShares.length]);

  const lastLogged = useRef(null);
  useEffect(() => {
    if (!segments.length) return;
    if (lastLogged.current === activeIndex) return;
    lastLogged.current = activeIndex;
    const active = activeIndex >= 0 ? segments[activeIndex] : null;
    // INFO for the same reason as the density above: at most one per movement,
    // and it is the only record of what the rail lit and when.
    log.info('surround.segment.change', {
      contentId,
      index: activeIndex,
      n: active?.n ?? null,
      label: active?.label ?? null,
      name: active?.label ?? null,
      position: Math.round(position),
      railPosition: Math.round(railPosition),
    });
    // `position` is read for the log payload only; the event fires on the change.
  }, [activeIndex, segments, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!segments.length) return null;

  // ONE NOTATION PER RAIL (`numeralStyle`). `ROMAN` runs to XII, so a rail of
  // twenty-one used to set `… XI. XII. 13. 14. …` — the notation changing
  // partway along one gutter. The style is a property of the list.
  const style = numeralStyle(segments);

  // THE GUTTER IS SIZED ONCE PER RAIL, not per segment — that is the whole point
  // of it. A piece running to IX. gives every one of its segments a IX.-wide
  // track, so all of them share one text edge; a piece of three segments gets a
  // narrower one and wastes nothing.
  const numeralChars = segments.reduce(
    (max, seg, i) => Math.max(max, numeral(seg.n, i, style).length), 1,
  );

  const headPct = playheadFraction({ segments, shares, position: railPosition, end }) * 100;

  return (
    <div
      ref={ruleClickRef}
      className={`surround-segment-map${named ? '' : ' surround-segment-map--bars'}${grouped ? ' surround-segment-map--grouped' : ''}${chips ? ' surround-segment-map--chips' : ''}`}
      data-testid="surround-segment-map"
      data-now-side={side}
      data-density={named ? (chips ? 'chips' : 'names') : 'bars'}
      data-grouped={grouped ? 'true' : 'false'}
      style={{
        '--numeral-chars': String(numeralChars),
        ...(grouped ? { '--group-rows': `calc(var(--group-row) * ${(drawnPartGroups.length > 0 ? 1 : 0) + (drawnSceneGroups.length > 0 ? 1 : 0)})` } : {}),
        '--accordion-ms': `${ACCORDION_MS}ms`,
        // The cursor's own smoothing. 120ms of linear ramp is one transport
        // tick and is what turns the 10 Hz position steps into a glide — but
        // while the ACCORDION is running the head is already being recomputed
        // every animation frame from the same interpolated widths the segments
        // use, and a second ramp on top of that would make it lag the boundary
        // it is supposed to be sitting on. Zero during the move, 120ms at rest.
        '--head-ms': moving ? '0ms' : '120ms',
      }}
    >
      {/* THE GROUP HEADINGS (the composed rail). A programme's grammar, not a
          new invention: the set is named once above the works it contains, and
          the works are named individually under the rule. Seven polonaises get
          seven headings because they are seven works; twenty-seven études get
          three, one per opus, each spanning its run.
          IT IS RENDERED ONLY WHEN THERE IS SOMETHING TO NAME. A single work's
          rail is one ungrouped run, `grouped` is false, and the row is absent —
          not hidden, absent — so the band keeps precisely the height and the
          geometry it has today. When it IS present its height is RESERVED (see
          the stylesheet): one line, ellipsized, so a long set title cannot make
          the band taller mid-programme.
          The labels are `aria-hidden` for the same reason the rest of the rail's
          chrome is: this is a decorative restatement of the placard above, and a
          screen reader walking it would read every set title twice. */}
      {/* LEVEL 0: Part headings — designation only ("Part One"). */}
      {drawnPartGroups.length > 0 && (
        <div
          className="surround-segment-map__groups"
          data-testid={groupLevels.length > 1 ? 'surround-part-groups' : 'surround-segment-groups'}
          data-level={0}
          aria-hidden="true"
        >
          {drawnPartGroups.map((group) => {
            let partLabel = group.title ?? '';
            if (groupLevels.length > 1) {
              const availPx = groupBasis(group) * railPx;
              const fullText = group.title ?? '';
              const miniText = group.mini ?? partDesignation(group.title);
              const fullLabelPx = metrics.labels?.[fullText] ?? Infinity;
              const miniLabelPx = metrics.labels?.[miniText] ?? 0;
              const pad = 8;
              partLabel = fullLabelPx + pad <= availPx ? fullText
                : miniLabelPx + pad <= availPx ? miniText : '';
            }
            return (
            <span
              key={`${group.index ?? 'none'}:${group.from}`}
              className={`surround-segment-map__group surround-segment-map__group--clickable${groupLevels.length > 1 ? ' surround-segment-map__group--part' : ''}`}
              data-testid={groupLevels.length > 1 ? 'surround-part-group-label' : 'surround-group-label'}
              data-span={group.count}
              onClick={() => seekTo(segments[group.from]?.mediaStart ?? segments[group.from]?.start ?? 0)}
              style={{ flexBasis: `${groupBasis(group) * 100}%` }}
            >
              {partLabel}
            </span>
            );
          })}
        </div>
      )}
      {/* LEVEL 1+: Scene headings on the DRAWN rail. The active scene shows
          its full title; other scenes in the active part show a Roman numeral;
          scenes inside collapsed parts are empty (the fold badge carries the
          scene count instead). */}
      {drawnSceneGroups.length > 0 && (
        <div
          className="surround-segment-map__groups"
          data-testid="surround-segment-groups"
          data-level={1}
          aria-hidden="true"
        >
          {drawnSceneGroups.map((group) => {
            const isActive = group.index === activeSceneIndex;
            const isCollapsed = segments[group.from]?.collapsed;
            // The ordinal is the scene's position within its Part, not its
            // position in the drawn run array (which shifts when Parts fold).
            // Find the scene's Part, then count which scene within that Part.
            const partIdx = drawnRail[group.from]?.segment?.ancestors?.[0]?.index;
            const partScenes = groupLevels.length > 1
              ? groupLevels[1].filter((s) => {
                  const si = placedRail[s.from]?.segment?.ancestors?.[0]?.index;
                  return si === partIdx;
                })
              : [];
            const ordinal = partScenes.findIndex((s) => s.index === group.index) + 1;
            const mark = ROMAN[ordinal] ?? String(ordinal);
            let label = '';
            if (!isCollapsed) {
              const availPx = groupBasis(group) * railPx;
              const tier = metrics.sceneTiers?.[group.index];
              const pad = 8;
              if (group.title && tier?.fullW && tier.fullW + pad <= availPx) {
                label = `${mark} ${group.title}`;
              } else if (group.mini && tier?.miniW && tier.miniW + pad <= availPx) {
                label = `${mark} ${group.mini}`;
              } else if (tier?.markW && tier.markW + pad <= availPx) {
                label = mark;
              }
            }
            return (
              <span
                key={`${group.index ?? 'none'}:${group.from}`}
                className={`surround-segment-map__group surround-segment-map__group--clickable${isActive ? ' surround-segment-map__group--active' : ''}${isCollapsed ? ' surround-segment-map__group--collapsed' : ''}`}
                data-testid="surround-group-label"
                data-span={group.count}
                style={{ flexBasis: `${groupBasis(group) * 100}%` }}
                onClick={() => seekTo(segments[group.from]?.mediaStart ?? segments[group.from]?.start ?? 0)}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
      <div className="surround-segment-map__rule" ref={ruleRef}>
        {/* THE RULER (the same idiom `CueTicker` measures its prose with). One
            element per rail, out of flow and invisible, carrying the segment
            row's real structure — the numeral's gutter, the text column, the
            heading with its title/tempo spans, the gloss in the annotation face
            — so what it reports is what the rail paints and not an arithmetic
            model of it.
            IT IS A RULER, NOT HIDDEN TEXT. It holds one segment's strings at a
            time and is emptied when the pass ends; nothing it ever contained is
            on screen, at any opacity, in any state. That distinction is the
            whole of chip mode: a chipped segment renders NO name, rather than a
            name nobody can see. `aria-hidden` because a ruler is not content. */}
        {named && (
          <span className="surround-segment-map__probe" ref={probeRef} aria-hidden="true">
            <span className="surround-segment-map__text-row">
              {/* The gutter's cell, empty and unclassed. Empty because the
                  gutter is an explicitly sized grid track, so the chrome it
                  contributes is the same whatever mark sits in it; UNCLASSED
                  because the ruler must not answer a query for the rail's
                  numerals — a query that found this one would count a mark
                  nobody is looking at. */}
              <span />
              <span className="surround-segment-map__text">
                <span className="surround-segment-map__heading" />
                <span className="surround-segment-map__translation" />
              </span>
            </span>
            {/* THE FOLD'S TWO RULERS (design wave 10). A part label as the
                groups row actually sets it — its own face, size and inline
                padding — and the count badge as the fold actually sets it. A
                fold is exactly as wide as the wider of them, so both have to be
                measured in the shipped rules rather than computed from the
                stylesheet's `em`s. They are emptied at the end of every pass,
                like the heading above. */}
            <span className="surround-segment-map__group" />
            <span className="surround-segment-map__fold-count" />
          </span>
        )}
        <span className="surround-segment-map__barline surround-segment-map__barline--terminal surround-segment-map__barline--start" aria-hidden="true" />

        {/* THE BOND (design wave 7). ONE element that MOVES, rather than a
            per-segment background that lights and unlights: the point the user
            asked for is that the eye FOLLOWS the highlight from the rail down
            into the listening band, and a thing that travels is followed where
            a thing that blinks is not. It is written before the segments so it
            paints beneath them (both are positioned, so DOM order is paint
            order), and it hangs below the rule's box by the band's own bottom
            padding so its ground reaches the seam the NOW panel starts at. */}
        <span
          className="surround-segment-map__bond"
          data-testid="surround-bond"
          data-bonded={bonded ? 'true' : 'false'}
          style={bond
            ? { '--bond-left': `${bond.start * 100}%`, '--bond-width': `${bond.width * 100}%` }
            : { '--bond-left': '0%', '--bond-width': '0%' }}
          aria-hidden="true"
        />
        {/* THE WAIST (design wave 9). The same ground, running along the band's
            seam, spanning the HULL of the sounding segment and the NOW panel —
            so the panel's whole top edge is welded to it and the segment's whole
            bottom edge is too. It used to stop at the panel's near edge, which
            left the two lit areas meeting at one point ("kitty corner"); a
            region joined at a point is two regions.
            The four radius flags say which of the waist's own corners are on the
            OUTSIDE of the silhouette — at every other corner one of the other
            two parts continues, and a radius there would cut a notch in the
            middle of one shape. `bondConnector` decides; the stylesheet draws. */}
        <span
          className="surround-segment-map__bond-connector"
          data-testid="surround-bond-connector"
          data-bonded={bonded ? 'true' : 'false'}
          data-corners={bond
            ? Object.entries(bond.connector.corners)
              .filter(([, on]) => on).map(([k]) => k).join(' ') || 'none'
            : 'none'}
          style={bond
            ? {
              '--connector-left': `${bond.connector.start * 100}%`,
              '--connector-width': `${bond.connector.width * 100}%`,
              '--connector-tl': bond.connector.corners.tl ? 'var(--bond-radius)' : '0',
              '--connector-tr': bond.connector.corners.tr ? 'var(--bond-radius)' : '0',
              '--connector-bl': bond.connector.corners.bl ? 'var(--bond-radius)' : '0',
              '--connector-br': bond.connector.corners.br ? 'var(--bond-radius)' : '0',
            }
            : { '--connector-left': '0%', '--connector-width': '0%' }}
          aria-hidden="true"
        />

        {segments.map((seg, i) => {
          // INSIDE A FOLD, AND NOT ITS HEAD: the segment is not drawn at all.
          // Its pin is zero, so it owns no width; rendering it anyway would put
          // a zero-width box carrying a separator barline inside the block,
          // which is a hairline of ink saying a boundary is here when the whole
          // point of the block is that the boundaries in it are elided.
          if (folded.hidden.has(i)) return null;
          // NOTHING SOUNDING HAS TWO OPPOSITE MEANINGS, and the rail must not
          // confuse them. After the last chord every segment HAS sounded and
          // the rule reads full; before the first one — a recording that opens
          // on tuning or an announcement, which the corpus explicitly permits —
          // none of them has, and a rule drawn full would say the piece was over
          // before it began.
          const state = activeIndex === i ? 'active'
            : unsounded ? 'future'
              : (activeIndex === -1 || i < activeIndex) ? 'elapsed' : 'future';

          // ---- THE FOLD'S BLOCK (design wave 10) ---------------------------
          // One elided run, drawn as one box: the rule and its fill above (a
          // folded part is wholly elapsed or wholly future, never split — it is
          // by definition not the part the playhead is in), a hatched lane on
          // the numerals' own line, and the count as a BADGE.
          //
          // THE BADGE IS NOT A NUMERAL, and the two signals that say so are
          // independent: it is enclosed, and it is set in the annotation sans
          // rather than the numeral's Garamond small caps. Design wave 10's
          // predecessor set the count as a bare figure in the numeral lane, so
          // Messiah's rail read "21 22 23 24 25 26 27" across a fold boundary
          // and "44 9" across the next — a count and a sequence position in one
          // face saying two different things.
          const fold = folded.blocks.get(i);
          if (fold) {
            return (
              <div
                key={`fold:${fold.index ?? 'none'}:${i}`}
                className={`surround-segment-map__segment surround-segment-map__segment--${state} surround-segment-map__segment--fold`}
                data-testid="surround-segment-fold"
                data-state={state}
                data-index={i}
                data-count={fold.count}
                data-title={fold.title}
                style={{ width: `${(shares[i] ?? seg.natural) * 100}%` }}
              >
                {i > 0 && (
                  <span
                    className="surround-segment-map__barline surround-segment-map__barline--separator"
                    aria-hidden="true"
                  />
                )}
                <span className="surround-segment-map__bar" aria-hidden="true">
                  <span
                    className="surround-segment-map__bar-fill"
                    data-testid="surround-segment-fill"
                    data-fill={state === 'elapsed' ? '1.0000' : '0.0000'}
                    style={{ '--fill': state === 'elapsed' ? '1' : '0' }}
                  />
                </span>
                <span className="surround-segment-map__fold-lane" aria-hidden="true">
                  <span
                    className="surround-segment-map__fold-count"
                    data-testid="surround-fold-count"
                  >
                    <span className="surround-segment-map__fold-segments">{fold.count}</span>
                    {foldSceneCounts.get(fold.index) > 0 && (
                      <span className="surround-segment-map__fold-scenes">
                        {foldSceneCounts.get(fold.index)}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            );
          }

          const { title, tempo } = splitHeading(seg.label);
          // How much of THIS segment has sounded. Elapsed segments read full,
          // future ones empty, and the sounding one sweeps — that sweep is where
          // the viewer reads progress now. It is a fraction of the SEGMENT, so
          // the accordion cannot desynchronise it: whatever width the segment is
          // drawn at, the fill is that fraction of it.
          const length = seg.stop - seg.start;
          const fill = state === 'elapsed' ? 1
            : state === 'future' ? 0
              : (length > 0 ? clamp01((railPosition - seg.start) / length) : 0);
          return (
            <div
              key={`${seg.n ?? i}:${seg.start}`}
              className={`surround-segment-map__segment surround-segment-map__segment--${state}${seg.collapsed ? ' surround-segment-map__segment--fold' : ''} surround-segment-map__segment--clickable`}
              data-fold={seg.collapsed ? seg.count : undefined}
              data-testid="surround-segment"
              data-state={state}
              data-index={i}
              data-natural={seg.natural.toFixed(6)}
              style={{ width: `${(shares[i] ?? widthBasis[i] ?? seg.natural) * 100}%` }}
              onClick={() => seekTo(seg.mediaStart ?? seg.start)}
            >
              {/* ONE quiet separator between segments. The double barline was
                  correct notation and too much ink at this size — it read as
                  clutter across four segments, so the grammar keeps the mark
                  and drops the doubling. */}
              {i > 0 && (
                <span
                  className="surround-segment-map__barline surround-segment-map__barline--separator"
                  aria-hidden="true"
                />
              )}
              {/* THE RULE COMES FIRST (design wave 4). The rule row rides at
                  the TOP of the band, in the overlap zone under the video's
                  bottom edge; the segment names hang BELOW it. Source order
                  is the layout order — no `column-reverse`, so the DOM a
                  screen reader walks is the order a viewer sees. */}
              <span className="surround-segment-map__bar" aria-hidden="true">
                {/* The fill is a full-width bar SCALED to its fraction, not a
                    bar whose width is set — see the stylesheet: a painted box's
                    position/size is pixel-snapped and a transform's is not, and
                    at this scale (a segment is minutes long across a few
                    hundred pixels) snapping is the difference between a glide
                    and a crawl. `--fill` is 0..1. */}
                <span
                  className="surround-segment-map__bar-fill"
                  data-testid="surround-segment-fill"
                  data-fill={fill.toFixed(4)}
                  style={{ '--fill': String(fill) }}
                />
              </span>
              {/* THE NUMERAL'S GUTTER (design wave 7). Two grid tracks: a
                  fixed one for the index mark, and the text column. The
                  heading and the gloss are both inside the text column, so
                  they share one left edge and the gloss can never start under
                  the numeral.
                  A BARS-ONLY rail (`band.railDensity`) omits the row entirely
                  rather than hiding it: the band's height is its content, so a
                  hidden-but-rendered row would leave the rail as tall as a
                  named one and buy nothing.
                  A CHIPPED rail omits it for every segment but the sounding one,
                  for the same reason and one step further — see the chip. */}
              {/* A FOLD IS NOT A CHIP. It was given its Part title's width
                  (`densityShares`), so it sets that title — the whole reason a
                  fold is wider than its neighbours. A numeral here was the old
                  bug in a new place: a chip reading "1" over twenty-one
                  numbers. The count rides alongside as a multiplier, which is
                  the one thing the title alone cannot say.

                  TWO NUMBERS, ONE PILL, A DRAWN DIVIDER. The pair used to be a
                  count, a slash glyph and a scene count inside a `display: grid`
                  chip — and a grid puts each of its children in its OWN ROW, so
                  what the band actually painted was "23" stacked over "/17" in a
                  fold two lines tall. Each number is its own element now, in an
                  inline row, separated by a rule the stylesheet draws rather
                  than by a character that has to be laid out. */}
              {named && chips && state !== 'active' && seg.collapsed && (() => {
                const sc = foldSceneCounts.get(drawnRail[i]?.segment?.ancestors?.[0]?.index);
                return (
                  <span
                    className="surround-segment-map__chip surround-segment-map__chip--fold"
                    data-testid="surround-segment-fold"
                    aria-hidden="true"
                  >
                    <span className="surround-segment-map__fold-segments">{seg.count > 0 ? seg.count : ''}</span>
                    {sc > 0 && <span className="surround-segment-map__fold-scenes">{sc}</span>}
                  </span>
                );
              })()}
              {named && chips && state !== 'active' && !seg.collapsed && (
                <span
                  className="surround-segment-map__chip"
                  data-testid="surround-segment-chip"
                  data-n={numeralText(seg.n, i, style)}
                  aria-hidden="true"
                >
                  {numeralText(seg.n, i, style)}
                </span>
              )}
              {named && (!chips || state === 'active') && (
              <span className="surround-segment-map__text-row">
                <span className="surround-segment-map__numeral">{numeral(seg.n, i, style)}</span>
                <span className="surround-segment-map__text">
                  <span className="surround-segment-map__heading">
                    {title && <span className="surround-segment-map__title">{title}</span>}
                    {tempo && <span className="surround-segment-map__tempo">{tempo}</span>}
                  </span>
                  {/* THE ANNOTATION (design wave 6). A recessive sub-line under
                      the heading, in the annotation face — sans, not Garamond —
                      so it reads as a gloss on the Italian rather than as more
                      programme. One line, ellipsized, exactly like the heading
                      above it: design wave 7 made the whole rail single-line and
                      widens the SOUNDING segment instead of wrapping anything. */}
                  {seg.annotation && (
                    <span
                      className="surround-segment-map__translation"
                      data-testid="surround-segment-translation"
                    >
                      {seg.annotation}
                    </span>
                  )}
                </span>
              </span>
              )}
            </div>
          );
        })}
        <span className="surround-segment-map__barline surround-segment-map__barline--terminal surround-segment-map__barline--end" aria-hidden="true" />

        {/* A barline in motion: one brass hairline, unlit. The ELEMENT is the
            width of the rule and carries the hairline on its right edge (see
            the stylesheet); `--head` is how far along, 0..1. That is what lets
            the cursor move on a compositor transform with sub-pixel precision
            instead of snapping a whole pixel at a time.
            Since design wave 7 the fraction is read off the RENDERED widths, not
            off the piece's elapsed time — see `band.js`, `playheadFraction`. */}
        <span
          className="surround-segment-map__playhead"
          data-testid="surround-playhead"
          data-head={(headPct / 100).toFixed(4)}
          style={{ '--head': String(headPct / 100) }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

SegmentMap.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
