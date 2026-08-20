// frontend/src/modules/Surround/modules/CueTicker.jsx
//
// The band's text zone. Since design wave 6 it is TWO REGISTERS side by side,
// and the division is editorial rather than decorative:
//
//   LEFT — THE PIECE. Untimed `data.facts` about the work itself, rotating on a
//     slow timer. This is the programme note: it is true at 0:00 and at 53:00,
//     and it does not care where the playhead is.
//
//   RIGHT — NOW. A small header naming the segment that is actually sounding
//     (numeral, name, and the translation of its tempo term), and beneath it
//     the `segments[].listen` notes for THAT segment — "the violas bark twice
//     a bar, all the way through". This is the half of the band that teaches:
//     it tells a viewer what to listen for in the next three minutes, not what
//     happened in 1804. A segment change swaps the whole pool and resets the
//     rotation; a TIMED CUE (`data.cues`) interrupts this zone for its dwell,
//     because a cue is the same kind of claim — one line tied to what is
//     sounding right now — only pinned to a second rather than to a segment.
//
// A segment with no authored `listen` notes borrows the piece pool beneath its
// header rather than showing empty paper. A piece with NO SEGMENTS AT ALL does
// not split: there is no "now" to have a register for, so the band is one zone
// and cues preempt it, exactly as it behaved before this wave.
//
// THE NOW REGISTER STOPPED PRINTING THE SEGMENT HEADING (design wave 7)
// ---------------------------------------------------------------------
// It used to name the sounding segment — directly beneath a rail that had just
// named it. The user's word for that was "wasteful", and the replacement is
// VISUAL: this register carries the same lifted panel ground as the sounding
// segment on the rail, joined to it by a connector along the band's seam (the
// BOND — see `SegmentMap.jsx`). The eye follows the shape from the rule down
// into the register and the name never needs setting twice. The heading code is
// still here and still correct, because a rail in a bars-only density has no
// name for the bond to point at: `band.nowHeading` (auto | always | never)
// decides, and `auto` — the default — shows it exactly when the rail does not.
//
// THE PIECE REGISTER GAINED ONE (design wave 7)
// ---------------------------------------------
// The left zone read as orphan prose: a paragraph about a symphony with nothing
// saying which symphony. `piece.short_title` is the work's own alternate name
// ("Beethoven's Third Symphony"), set as a standing label rather than a
// headline. It is fixed: it never takes the bond's ground, never moves with
// progress, and where the corpus has not authored one the zone renders with no
// header at all rather than an ellipsized long title pretending to be short.
//
// WHICH SIDE IS WHICH IS CONFIGURABLE (design wave 7)
// ---------------------------------------------------
// `band.nowSide` is right (today's behaviour), left, or dynamic — dynamic puts
// the NOW register on the same side of the band as the sounding segment, which
// keeps the bond short. The swap is a considered move, not a jump: the panel
// slides across the band while the two registers' text cross-fades through the
// house dissolve. See `../band.js` for the threshold and its hysteresis.
//
// `render: overlay` cues are ignored here; the pop-up-video overlay is phase two
// and has its own region. An unknown or absent `render` is docked.
//
// THE TWO ZONES NEVER SWAP TOGETHER. Both play the house dissolve — out to the
// band's near-black ground, a held beat of nothing, then in — and two of those
// firing in the same instant reads as the whole band blinking. The right zone's
// rotation is therefore phase-offset by half a period from the left's, which is
// the maximum separation two equal periods admit. The offset is measured
// against the PIECE register's own last swap (`phaseDelay`), not against the
// moment the right zone happens to re-arm, so a segment boundary or a cue puts
// it back at its maximum rather than at whatever that beat's timing produced.
// Under prefers-reduced-motion both collapse to an instant swap.
//
// THAT LAW HAS EXACTLY ONE EXCEPTION, and it is deliberate: the `nowSide` swap
// (design wave 7) dissolves BOTH registers at once, because the thing changing
// is not either register's content — it is the band's layout, and hiding half
// of it while the other half reorders underneath would read as a glitch rather
// than as a move. One blink, once, for a change the viewer is meant to notice.
//
// THE NOTE IS NEVER CUT (design wave 9)
// --------------------------------------
// There is no ellipsis in this band. The note's box is whatever vertical run its
// zone has left over — a constant, because it does not depend on the note — and
// the TYPE is sized to the text by measurement (`../fit.js`): leading tightened
// first, then size, never below either floor. A note that cannot be set whole at
// the floors is an authoring failure; it is dropped from the rotation and warned
// about with its character budget rather than cut. The fit is solved once per
// piece, against every string either register can ever show, so it cannot change
// at a segment boundary — which is the reserved-height law, kept.

import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import {
  DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS, DISSOLVE_SWAP_MS, useDissolve,
} from '../dissolve.js';
import { smartQuotes, smartQuotesAll, trimmed } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import {
  resolveBandConfig, showsNowHeading, useNowSide, elapsedFraction, activeSegmentIndex,
  placedSegments, numeral, numeralStyle, useEasedVector, ACCORDION_MS, NOW_PANEL_SHARE,
} from '../band.js';
import {
  bandPools, fitBand, fitStyle, withhold, withheldSets,
} from '../fit.js';
import { segmentAt, factPool, factPools, isComposedContainer } from '../segments.js';
import './CueTicker.scss';

/** Each half of the dissolve: the old line out, then the new line in.
 *  ALIASES of the house dissolve (`../dissolve.js`) — the number lives there, so
 *  the ticker, the rail fact and the place carousel cannot drift apart. */
export const CUE_FADE_MS = DISSOLVE_FADE_MS;
/** The beat of empty ground between them — the "through black" of the dissolve. */
export const CUE_HOLD_MS = DISSOLVE_HOLD_MS;
/** Out + held ground + in. The CSS duration is set inline from CUE_FADE_MS, so
 *  the stylesheet and this timer cannot drift apart. */
export const CUE_SWAP_MS = DISSOLVE_SWAP_MS;
/** How long a timed cue holds the panel when it names no dwell of its own. */
export const CUE_DWELL_S = 12;
/** Fact rotation. Slow: this plays behind music. */
export const FACT_INTERVAL_MS = 20000;
/**
 * The NOW register's rotation. Deliberately the SAME period as the piece
 * register's, not a coprime one: the two zones are read together and a viewer
 * should not be able to feel one running faster than the other. What keeps them
 * from swapping in the same instant is the phase below, which at equal periods
 * is an exact and permanent half-period gap.
 */
export const LISTEN_INTERVAL_MS = FACT_INTERVAL_MS;
/**
 * How long to wait so that the next NOW swap lands exactly half a period after a
 * PIECE swap.
 *
 * THE OFFSET IS MEASURED FROM THE PIECE REGISTER'S OWN CLOCK, not from the
 * moment the NOW register re-arms, and that distinction is the whole of the
 * invariant's honesty. The NOW register re-arms at every segment boundary and
 * at the end of every timed cue; the piece register's beat runs on through both
 * (it must — tearing it down on a cue edge in the OTHER zone was itself a
 * defect). A flat "wait half a period from HERE" therefore gave an exact
 * half-period gap once, at mount, and an arbitrary one after the first
 * boundary — the two zones could land in lockstep and blink together, which is
 * the single effect the phase exists to prevent. There is no `LISTEN_PHASE_MS`
 * constant any more: a fixed delay was the bug, and a constant nothing computes
 * from is surface to trip on.
 *
 * Pure and exported so the phase relation can be tested as a relation, rather
 * than by asserting the delay values — which is precisely how the false
 * invariant survived six waves of review.
 *
 * @param {number} sinceLastPieceSwap ms elapsed since the piece register last
 *   swapped (or since its interval was armed).
 * @param {number} [periodMs] the shared rotation period.
 * @returns {number} 0..periodMs.
 */
export function phaseDelay(sinceLastPieceSwap, periodMs = FACT_INTERVAL_MS) {
  const period = Number(periodMs) > 0 ? Number(periodMs) : FACT_INTERVAL_MS;
  const half = period / 2;
  const elapsed = Number.isFinite(sinceLastPieceSwap) ? sinceLastPieceSwap : 0;
  const wait = (half - (elapsed % period)) % period;
  return wait < 0 ? wait + period : wait;
}

const EMPTY = Object.freeze({ key: 'empty', kind: null, at: null, text: '' });

/**
 * A line of nothing that still occupies a line.
 *
 * The NOW header is blank when nothing is sounding (design wave 9), and blank
 * has to mean BLANK rather than absent: an element that disappears gives its
 * height back to the note's box, which changes the room the fit was solved
 * against, which resizes the type of both registers on a segment boundary. The
 * reserved-height law is the same law it has always been; this is what keeps it
 * true through a state the band did not use to have.
 */
const BLANK_LINE = ' ';

/** A dissolving line is only worth fading out of when it has words in it. */
const hasLine = (value) => Boolean(value?.text);

/**
 * The NOW zone's two urgent edges — commit instantly rather than softening.
 *
 * Fix round 1 (review finding I2), scoped to the NOW ZONE ONLY: `seg` is carried
 * solely on the now-zone's payload (see `nowNext`), so both conditions are false
 * whenever `next`/`shown` are the piece register's. The piece register's cue
 * interrupt (the unsplit band, wave 2) keeps its original gentle dissolve on
 * purpose — it has no header to disagree with.
 *   - an ACTIVATING CUE (`shown` was not a cue, `next` is): a cue is a claim
 *     about what is sounding RIGHT NOW, and a stale rotation note lingering
 *     through even one fade-out is a wrong answer, however briefly.
 *   - a SEGMENT BOUNDARY (`next.seg` names a different segment than
 *     `shown.seg`): the header above this text is NOT dissolved, so a softened
 *     note would show the NEW segment's header over the OLD segment's note for
 *     up to a full fade — the two halves of the band naming different segments
 *     at the same instant.
 * Without this, a second edge arriving before the first dissolve's commit fires
 * re-queues a full `DISSOLVE_COMMIT_MS` wait on top of whatever was left of the
 * first.
 */
export function urgentNowEdge(next, shown) {
  const isNowZone = next?.seg !== undefined || shown?.seg !== undefined;
  const activating = isNowZone && next?.kind === 'cue' && shown?.kind !== 'cue';
  const boundary = next?.seg !== undefined && shown?.seg !== undefined && next.seg !== shown.seg;
  // A RE-FIT (design wave 9), in BOTH registers. The band has just decided what
  // it can and cannot set whole, and a note it has withdrawn must leave at once:
  // softening the change plays a 320ms fade of the exact note the fit refused,
  // which is the ellipsis defect wearing a cross-fade.
  const refit = next?.pool !== undefined && shown?.pool !== undefined && next.pool !== shown.pool;
  return activating || boundary || refit;
}

/** The house dissolve, configured for a band line. One object, never re-made. */
const LINE_DISSOLVE = Object.freeze({ hasContent: hasLine, instant: urgentNowEdge });

export default function CueTicker({
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
  const log = useMemo(() => surroundLogger(logger, 'cue-ticker'), [logger]);
  const contentId = data?.contentId ?? null;
  const config = useMemo(() => resolveBandConfig(data), [data]);

  const cues = useMemo(() => (Array.isArray(data?.cues) ? data.cues : [])
    .filter((c) => c && typeof c === 'object' && c.text)
    // Only an explicit `overlay` opts out; anything else — including an unknown
    // value — is docked, so an authoring typo still shows the note.
    .filter((c) => (c.render ?? 'docked') !== 'overlay')
    .filter((c) => Number.isFinite(Number(c.at))), [data]);

  /* ---- THE PIECE REGISTER'S SUBJECT ---------------------------------------
   * ON A CONTAINER IT FOLLOWS THE MUSIC. Seven polonaises are seven works, and
   * the left register talking about "the set" for fifty-nine minutes while one
   * of them plays is the same defect as a plate that headlines the box. The
   * precedence — this segment's note, then ITS work's facts, then the
   * container's — lives in `../segments.js` as a pure function, because it is
   * the part worth asserting on its own and both this module and the plate ask
   * the same question of the same payload.
   *
   * ON A SINGLE WORK NOTHING MOVES, and the gate is not defensive tidying: the
   * Eroica's four movements each carry an authored `note` (the store already
   * docks each as a timed cue at its own second), so a register that followed
   * the segment on ANY payload would replace that symphony's fourteen facts
   * with one line about the funeral march. `isComposedContainer` counts PARTS.
   */
  const container = isComposedContainer(data);
  const rail = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);
  /** Where the transport is on the CONTAINER's rail — -1 on a single work. */
  const railIndex = useMemo(
    () => (container ? segmentAt({ segments: rail, contentId, position }).index : -1),
    [container, rail, contentId, position],
  );

  // Every authored string this band prints is curled at its render seam — one
  // helper, `../typography.js`, called here rather than a regex scattered
  // through the JSX. A programme note is set in Garamond on stock; a straight
  // apostrophe is the one mark on the screen that was never cut for the face.
  const facts = useMemo(
    () => smartQuotesAll(factPool(data, railIndex)),
    [data, railIndex],
  );

  /**
   * EVERY POOL THIS REGISTER CAN EVER REACH — what the FIT is solved against.
   *
   * The fit has to be a constant of the piece or the band's type would resize
   * whenever the pool swapped, which is the reserved-height law broken by the
   * mechanism that replaced the reserve. On a single work this is the same list
   * as `facts`; on a container it is the union over every segment.
   */
  const allFacts = useMemo(
    () => smartQuotesAll(container ? factPools(data) : factPool(data, -1)),
    [container, data],
  );

  const pieceSegments = useMemo(
    () => (Array.isArray(data?.pieceSegments) ? data.pieceSegments : []), [data],
  );

  // The rule ends where the MUSIC ends, not where the file does — the same
  // reading SegmentMap takes, so the two halves of the band agree about when
  // the last segment stops sounding and the applause begins.
  const musicEndsAt = Number(data?.piece?.musicEndsAt);
  const end = Number.isFinite(musicEndsAt) && musicEndsAt > 0 ? musicEndsAt : null;

  // ONE DERIVATION OF WHAT IS SOUNDING, shared with the rail (`../band.js`).
  // This module and `SegmentMap` used to hold two near-copies of the same loop
  // whose fall-through cases disagreed — the rail lit segment I before the
  // first start, this register said nothing was playing. Both now ask the same
  // function, which also declines to place a segment whose start the store
  // refused, instead of coercing it to 0.
  const placed = useMemo(() => placedSegments(pieceSegments), [pieceSegments]);
  const placedIndex = useMemo(
    () => activeSegmentIndex({ placed, position, end }), [placed, position, end],
  );

  /**
   * THE BAND SPLITS ONLY WHERE THERE IS A "NOW" TO SPLIT OFF.
   *
   * Without segments there is no current-segment header, no per-segment
   * listen pool, and the right zone would be a second copy of the left one —
   * two registers saying the same thing is worse than one saying it properly.
   * So a segment-less piece keeps the single, full-width band this module
   * shipped with, cues and all.
   *
   * IT IS THE PLACED SEGMENTS THAT DECIDE, not the authored ones. A recording
   * whose timings are all unusable — every `starts` entry refused, or a work
   * authored ahead of any timing at all — has segments on paper and none on the
   * clock, so there is no "now" for a second register to be about: the rail
   * beside it draws nothing, and a NOW zone under an empty rail would print
   * `Listen for` over borrowed facts for the length of the piece. Two registers
   * saying the same thing from the same pool is the case this split exists to
   * avoid, and an untimed recording is that case exactly.
   */
  /**
   * THE SEGMENTS THIS REGISTER IS ABOUT — and on a container they are not the
   * ones above.
   *
   * `pieceSegments` is the piece's OWN authored list, and for a container that
   * is the SET's list: seven `work:` references, or seven names the container
   * never timed, so `placedSegments` refuses every one of them. The band then
   * did not split at all — a full-width piece register under a rail that was
   * lighting a segment and running a bond down to a NOW panel that did not
   * exist. Half a shape, pointing at nothing.
   *
   * The rail reads `data.segments`, the composed list, and so does this. The two
   * halves of the band now derive what is sounding from ONE list through ONE
   * function (`segmentAt`), which is what makes "the bond always lands"
   * structural rather than a thing to keep in step by hand.
   */
  const nowSegments = useMemo(
    () => (container ? rail : placed.map((p) => p.segment)),
    [container, rail, placed],
  );
  const split = nowSegments.length > 0;
  const segment = container
    ? (railIndex >= 0 ? (rail[railIndex] ?? null) : null)
    : (placedIndex >= 0 ? placed[placedIndex].segment : null);
  /** The AUTHORED index of the sounding segment — what the log and the bond name. */
  const segmentIndex = container
    ? railIndex
    : (placedIndex >= 0 ? placed[placedIndex].index : -1);

  const listen = useMemo(
    () => smartQuotesAll(
      (Array.isArray(segment?.listen) ? segment.listen : [])
        .filter((n) => typeof n === 'string' && n.trim()),
    ),
    [segment],
  );

  /**
   * NEVER EMPTY PAPER — WHILE SOMETHING IS SOUNDING. A segment nobody has
   * written listening notes for still gets its header, and the piece pool is
   * borrowed beneath it. Two zones showing from the same pool, half a period
   * apart, is a weaker band than two pools; it is a far better band than a blank
   * half.
   *
   * WITH NOTHING SOUNDING THE REGISTER IS BLANK, and that is the opposite rule
   * for the opposite reason (design wave 9). This register is about what is
   * playing NOW. Before the first segment — the conductor's walk-on, the
   * applause, the settling — and after the last chord, nothing is, and there is
   * no note about the sounding segment to show because there is no sounding
   * segment. Borrowing a piece fact there would put a claim about 1804 under a
   * lit panel that says "this is what you are hearing", and duplicate the left
   * register while it did so. Blank is the honest answer, and blank does not
   * move the band: the box is still there and still exactly as tall.
   */
  const borrowed = split && segment !== null && listen.length === 0;
  const nowPool = useMemo(() => {
    if (!segment) return [];
    return listen.length ? listen : facts;
  }, [segment, listen, facts]);

  /* ---- THE FIT (design wave 9) --------------------------------------------
   * The band's type is sized so that no note is ever cut. `../fit.js` holds the
   * ladder and the floors and does the measuring; this is the wiring.
   *
   * THE POOLS ARE THE WHOLE PIECE'S, not this instant's. The fit has to be a
   * constant of the piece, or the type would resize at a segment boundary and
   * the reserved-height law would be broken by the mechanism that replaced it —
   * so what is measured is EVERY string either register can ever show: all the
   * facts, every placed segment's listening notes, every docked cue, and the
   * facts again in the NOW register if any segment will borrow them.
   */
  const fitPools = useMemo(() => {
    // CURLED, because that is what is painted. Every authored string this band
    // prints goes through one curl at its render seam, and a measurement of the
    // straight-quoted original would be measuring a string the screen never
    // shows. `facts` is already curled where it was derived.
    const raw = bandPools({
      facts: allFacts, segments: nowSegments, cues,
    });
    return { piece: smartQuotesAll(raw.piece), now: smartQuotesAll(raw.now) };
  }, [allFacts, nowSegments, cues]);

  const rootRef = useRef(null);
  const [fit, setFit] = useState(null);
  /** Re-measure ticks: the band resized, or the display faces finally landed. */
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    // COALESCED ONTO ONE FRAME (review finding M-10). A fit is ~250 write-then-
    // read round trips of forced synchronous layout and a ResizeObserver fires
    // per resize step, so a continuous drag would run the whole search on every
    // one of them, inside a layout effect. Kiosks do not resize, which makes
    // this a latent cost rather than a live one — and two lines to remove.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      if (typeof requestAnimationFrame !== 'function') { setLayoutTick((n) => n + 1); return; }
      frame = requestAnimationFrame(() => { frame = 0; setLayoutTick((n) => n + 1); });
    });
    observer.observe(root);
    // ...AND THE BOXES THE FIT IS ACTUALLY SOLVED AGAINST, not only the ticker
    // around them. The note's room is what the standing label and the header
    // leave over, so it can change while the ticker's own box does not — and
    // then the type would stay solved against room that no longer exists. It is
    // not hypothetical: the frame publishes `--label-floor` from a measurement
    // (design wave 9b), so on the very first mount the labels resize one commit
    // AFTER this fit has run, giving the note more room than it was fitted for.
    // Anything else that moves the header — the faces landing, the `@container`
    // query printing a translation — lands here too, for free.
    //
    // It cannot feed itself: the fit sets only `--note-size`/`--note-leading` on
    // the ticker root, and these boxes are `flex: 1 1 0%` of their zone, so their
    // height is independent of the note inside them. That is the same property
    // the reserved-height law rests on.
    root.querySelectorAll('.surround-cue-ticker__text').forEach((box) => observer.observe(box));
    return () => {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // The vendored faces land after the first layout, and a note measured in the
  // fallback serif is measured against the wrong metrics — the same reason the
  // rail waits for them before solving the accordion.
  //
  // `ready` ALONE IS NOT THE CLAIM WE NEED (review finding M-11). It resolves
  // when the document's font loading settles, which is not "the body face is
  // usable", and the degradation if the two ever come apart is the single
  // outcome this wave forbids: a fit solved against the fallback serif's
  // metrics, too big for the box, clipped in silence with no ellipsis and no
  // warn. So the face is CHECKED, and the check is retried across the window in
  // which `ready` has resolved and this face has not (a cold cache under
  // `font-display: swap`). The measure spec asserts the same thing for the same
  // reason. After two seconds we fit against whatever is actually there — a
  // slightly conservative fit beats no fit at all.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return undefined;
    let live = true;
    let tries = 0;
    let timer = null;
    const check = () => {
      if (!live) return;
      const ready = typeof document.fonts.check === 'function'
        ? document.fonts.check('500 16px "EB Garamond"') : true;
      if (ready || tries >= 20) { setLayoutTick((n) => n + 1); return; }
      tries += 1;
      timer = setTimeout(check, 100);
    };
    document.fonts.ready?.then?.(check);
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);

  // LAYOUT EFFECT, so the fit is committed before the browser paints: the first
  // frame is already the fitted one and there is no flash of the fallback size.
  useLayoutEffect(() => {
    const next = fitBand(rootRef.current, fitPools);
    if (!next) return;
    setFit((prev) => (
      prev
      && prev.fontPx === next.fontPx
      && prev.leading === next.leading
      // The floor moved even though the settled size did not: a different root,
      // so a different set of notes was judged fittable and a different budget
      // was warned about. Two fits that agree on the size are not the same fit.
      && prev.floorPx === next.floorPx
      && prev.rejected.length === next.rejected.length
      && prev.rejected.every((r, i) => r.text === next.rejected[i].text)
        ? prev : next
    ));
  }, [fitPools, layoutTick]);

  /**
   * A note that cannot be set whole at the floors is an AUTHORING failure, and
   * this is where it is reported. It is a `warn` rather than a `debug` because
   * it is actionable by a person and by nobody else: the fix is in the corpus.
   * The payload carries what the author needs — which register, how long the
   * note is, how long it may be, and by how much it overflowed — so the budget
   * can be read straight out of the log store.
   *
   * AND WHICH SCREEN SAID SO. The floor is a function of the root width, so the
   * same note has a different budget on the office screen and on the living
   * room; a budget in the log store without the root it was measured on is a
   * re-authoring target nobody can act on. Both ride along.
   */
  const rejected = fit?.rejected ?? null;
  const floorPx = fit?.floorPx ?? null;
  const rootWidthPx = fit?.rootWidthPx ?? null;
  useEffect(() => {
    if (!rejected?.length) return;
    rejected.forEach((r) => {
      log.warn('surround.note.unfittable', {
        contentId,
        zone: r.zone,
        chars: r.chars,
        budget: r.budget,
        cut: r.chars - r.budget,
        overflowPx: r.overflowPx,
        floorPx,
        rootWidthPx,
        text: r.text,
      });
    });
  }, [rejected, floorPx, rootWidthPx, contentId, log]);

  /**
   * WHAT THE SCREEN DOES WITH ONE. It does not show it. The two alternatives
   * are to cut it (an ellipsis — the defect this wave exists to remove) or to
   * set it below the floors (unreadable at ten feet, which is the same defect in
   * smaller type). Omitting it is the only option that never puts a false or
   * unreadable claim on the screen: the band shows the notes it can show whole
   * and says nothing about the one it cannot, while the warn above says it
   * loudly to the only party who can fix it. If a whole pool is unfittable the
   * register simply carries no note — its standing label stays, the box stays
   * exactly as tall, and nothing on the band moves.
   */
  const withheld = useMemo(() => withheldSets(fit), [fit]);
  /**
   * THE FIT'S IDENTITY, carried on every rotating payload the dissolve sees.
   *
   * A re-fit changes what each register may show, and that is not a content
   * ROTATION — it is the band correcting itself. Softening it plays a 320ms
   * fade of the very note the fit has just refused, which is the ellipsis defect
   * wearing a cross-fade. `urgentNowEdge` reads this and commits instantly. It
   * changes only when the fit does: once, a frame after mount, and again on a
   * real resize.
   */
  const fitGen = fit
    ? `${fit.fontPx}:${fit.leading}:${fit.floorPx}:${fit.rejected.length}`
    : 'unfitted';

  const pieceFacts = useMemo(() => withhold(facts, withheld?.piece), [facts, withheld]);
  const nowNotes = useMemo(() => withhold(nowPool, withheld?.now), [nowPool, withheld]);
  /**
   * AND THE CUES (review finding C-1). This was the hole in the law: `bandPools`
   * measures every cue, so an over-long one IS rejected and the surviving type
   * size is solved EXCLUDING it — and then the unfiltered cue preempted the
   * panel at that size and was clipped by `overflow: hidden`, with no ellipsis
   * to admit it. The one string the fit had certified as unsettable was the one
   * string that could still reach the screen, and it reached it by preempting
   * everything else.
   *
   * A withheld cue simply does not fire: the register keeps rotating and the
   * warn names the cue, its budget and its overflow. WHICH register decides is
   * the same rule `bandPools` measures by — a split band's cues belong to the
   * NOW register, an unsplit band's to the only register it has — and the string
   * compared is the CURLED one, because that is the string that would be
   * painted.
   */
  const fittableCues = useMemo(
    () => withhold(cues, withheld?.[split ? 'now' : 'piece'], (c) => smartQuotes(String(c.text))),
    [cues, withheld, split],
  );

  // Latest cue whose dwell window contains the playhead. Derived from `position`,
  // so a seek — forwards or backwards — re-evaluates with no extra machinery.
  const activeCue = useMemo(() => {
    let found = null;
    fittableCues.forEach((c) => {
      const at = Number(c.at);
      const dwell = Number.isFinite(Number(c.dwell)) && Number(c.dwell) > 0 ? Number(c.dwell) : CUE_DWELL_S;
      if (position >= at && position < at + dwell) {
        if (!found || at >= Number(found.at)) found = c;
      }
    });
    return found;
  }, [fittableCues, position]);

  // ---- the PIECE register (left) -------------------------------------------
  const [factIndex, setFactIndex] = useState(0);

  // A NEW POOL OPENS AT ITS FIRST FACT. On a container the rail moving from one
  // work to the next replaces this register's whole pool, and leaving the
  // rotation where the previous work left it would open the Heroic's four facts
  // at whichever of them the index happened to have reached. (It also covers a
  // seek backwards into an earlier work.) A single work never reaches this: its
  // `railIndex` is a constant -1, so the effect runs once, at mount, on a state
  // that is already 0. The swap itself plays the house dissolve like any other
  // content change — the payload's key is its TEXT, so a new pool is new content.
  useEffect(() => { setFactIndex(0); }, [railIndex, contentId]);

  /**
   * WHEN THE PIECE REGISTER LAST SWAPPED — the clock the NOW register phases
   * against. A ref, not state: nothing renders from it, and re-rendering the
   * band twenty times a symphony to store a timestamp would be absurd.
   * `Date.now()` rather than `performance.now()` because the only thing computed
   * from it is a difference of two readings taken by this same component, and
   * `Date.now` is what a fake-timer suite can move.
   */
  const pieceSwappedAt = useRef(Date.now());
  /**
   * How many times the piece register's interval has been (re)armed.
   *
   * THE INVARIANT HAS TO HOLD WHICHEVER REGISTER MOVES. The NOW register
   * re-phases whenever IT re-arms, which covers every segment boundary and
   * every cue; but the piece register re-arms too — its effect depends on
   * `facts.length`, and a corpus edit picked up by the mtime watcher can grow a
   * work's fact pool without touching its segments. That re-seeds
   * `pieceSwappedAt` and, without this, leaves the NOW register running on an
   * offset measured against a clock that has since moved: the original defect
   * with the roles swapped. Bumping a generation here and reading it in the NOW
   * effect's dependencies makes the re-phase symmetric.
   *
   * State, not a ref, precisely because it has to retrigger an effect.
   */
  const [pieceArm, setPieceArm] = useState(0);

  // Fix round 1 (review finding I1). TWO separate effects, not one reading
  // `activeCue` for both branches: a single effect with `activeCue` in its
  // deps tore the SPLIT rotation's interval down and rebuilt it on every cue
  // edge, even though split mode never consumes `activeCue` here at all —
  // resetting the piece register's clean 20s beat every time a cue anywhere
  // in the now-zone started or ended. Splitting the effect means the split
  // branch's dependency list can no longer even mention `activeCue`, so its
  // identity churning cannot retrigger it.
  useEffect(() => {
    // Split, the piece register is never interrupted — cues belong to the NOW
    // zone — so its timer is the one clean, unbroken beat in the band, and
    // must survive a cue landing or lifting in the OTHER zone untouched.
    if (!split) return undefined;
    if (pieceFacts.length < 2) return undefined;
    pieceSwappedAt.current = Date.now();
    // The NOW register is phased against this clock, so a fresh arm has to tell
    // it the clock moved. `setState` with an unchanged value bails out, so this
    // costs nothing on the renders where the effect does not re-run.
    setPieceArm((n) => n + 1);
    const id = setInterval(() => {
      pieceSwappedAt.current = Date.now();
      setFactIndex((i) => i + 1);
    }, FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [split, pieceFacts.length]);

  useEffect(() => {
    // Unsplit, this IS the panel a cue preempts, and the rotation holds still
    // behind it so no fact goes unseen (the behaviour since wave 2) — so this
    // branch legitimately depends on `activeCue`.
    if (split) return undefined;
    if (pieceFacts.length < 2) return undefined;
    if (activeCue) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [split, activeCue, pieceFacts.length]);

  const pieceNext = useMemo(() => {
    // Unsplit: this single zone carries the cues too.
    if (!split && activeCue) {
      const at = Number(activeCue.at);
      // `pool` rides on a CUE line too (review finding C-1): a re-fit can
      // WITHDRAW a cue, and a withdrawn cue has to leave at once rather than
      // cross-fading out over 320ms while it is clipped.
      return {
        key: `cue:${at}`, kind: 'cue', at, text: smartQuotes(String(activeCue.text)), pool: fitGen,
      };
    }
    if (pieceFacts.length) {
      const i = ((factIndex % pieceFacts.length) + pieceFacts.length) % pieceFacts.length;
      // KEYED BY THE TEXT, NOT BY THE INDEX (design wave 9). The dissolve treats
      // two payloads with the same key as the same content and does nothing —
      // and the pool is no longer a constant: the fit lands a frame after mount
      // and withdraws any note it cannot set whole. Under an index key, dropping
      // the first fact left the register showing that same fact for ever at
      // `fact:0`, which is the exact note the fit had just refused. Measured on
      // the office screen before this fix: the 224-character Napoleon note, set
      // in 89.8px of a 39px box. The content IS the identity here, so the key is
      // the content — and `pieceFacts`, not `facts`, is what this depends on.
      return {
        key: `fact:${pieceFacts[i]}`, kind: 'fact', at: null, text: pieceFacts[i], pool: fitGen,
      };
    }
    return EMPTY;
  }, [split, activeCue, pieceFacts, factIndex, fitGen]);

  const [pieceShown, pieceHidden] = useDissolve(pieceNext, LINE_DISSOLVE);

  // ---- the NOW register (right) --------------------------------------------
  const [listenIndex, setListenIndex] = useState(0);

  // A segment change swaps the pool; the rotation starts that pool at its
  // first note rather than at wherever the previous segment's index happened
  // to be. (Also covers a seek backwards into an earlier segment.)
  useEffect(() => { setListenIndex(0); }, [segmentIndex, contentId]);

  useEffect(() => {
    if (!split || nowNotes.length < 2) return undefined;
    // A cue owns this zone for its dwell; the rotation holds still behind it so
    // the note it interrupted is not skipped.
    if (activeCue) return undefined;
    // THE HALF-PERIOD GAP, RE-ESTABLISHED RATHER THAN INTENDED. This effect
    // re-arms at every segment boundary and at the end of every cue, and the
    // piece register's beat runs on untouched through both. Waiting a flat
    // `LISTEN_PHASE_MS` from HERE therefore held the offset only until the
    // first boundary, after which it was whatever the boundary's timing made
    // it — including zero, the two zones blinking together, which is the one
    // effect the phase exists to prevent. Waiting until the next instant that
    // is half a period after a PIECE swap puts the gap back at its maximum,
    // every time, without touching the other zone's clock (finding I1).
    let interval = null;
    const phase = setTimeout(() => {
      setListenIndex((i) => i + 1);
      interval = setInterval(() => setListenIndex((i) => i + 1), LISTEN_INTERVAL_MS);
    }, phaseDelay(Date.now() - pieceSwappedAt.current, LISTEN_INTERVAL_MS));
    return () => { clearTimeout(phase); if (interval) clearInterval(interval); };
    // `pieceArm` is in the list for its identity alone: it is how the OTHER
    // register says "my clock restarted, re-measure your offset against it".
  }, [split, activeCue, segmentIndex, nowNotes.length, pieceArm]);

  const nowNext = useMemo(() => {
    // BLANK WHEN NOTHING IS SOUNDING (design wave 9) — including through a cue.
    // A cue is a claim about what is sounding right now, so with nothing
    // sounding it has no subject either.
    if (!split || !segment) return EMPTY;
    if (activeCue) {
      const at = Number(activeCue.at);
      // `seg` rides along even on a cue line: fix round 1 (review finding I2)
      // reads it in `useDissolve` to force an instant commit across a
      // segment boundary, and a cue landing exactly on one is not exempt —
      // the header above it changes either way.
      return {
        key: `cue:${at}`,
        kind: 'cue',
        at,
        text: smartQuotes(String(activeCue.text)),
        seg: segmentIndex,
        // See `pieceNext`: a cue the fit withdraws must leave at once.
        pool: fitGen,
      };
    }
    if (nowNotes.length) {
      const i = ((listenIndex % nowNotes.length) + nowNotes.length) % nowNotes.length;
      return {
        // Keyed by the segment AND the text — see `pieceNext` for why the index
        // will not do. The segment stays in the key because the same borrowed
        // fact under a different header is different content.
        key: `${borrowed ? 'borrowed' : 'listen'}:${segmentIndex}:${nowNotes[i]}`,
        kind: borrowed ? 'fact' : 'listen',
        at: null,
        text: nowNotes[i],
        pool: fitGen,
        // Fix round 1 (review finding I2): which segment this line belongs
        // to. `useDissolve` compares this against the currently-SHOWN line's
        // `seg` to detect a segment boundary and commit instantly instead of
        // softening across it — the header (not part of the dissolve) has
        // already changed by the time this renders, so a dissolved note would
        // disagree with it for up to a full commit.
        seg: segmentIndex,
      };
    }
    return EMPTY;
  }, [split, segment, activeCue, nowNotes, listenIndex, borrowed, segmentIndex, fitGen]);

  const [nowShown, nowHidden] = useDissolve(nowNext, LINE_DISSOLVE);

  // ---- logging --------------------------------------------------------------
  useEffect(() => {
    if (!pieceShown.text) return;
    log.debug('surround.cue.shown', { kind: pieceShown.kind, at: pieceShown.at, contentId });
  }, [pieceShown, contentId, log]);

  useEffect(() => {
    if (!split || !nowShown.text) return;
    log.debug('surround.listen.shown', {
      kind: nowShown.kind, at: nowShown.at, segment: segmentIndex, borrowed, contentId,
    });
    // `segmentIndex` and `borrowed` ride along as payload; the event fires on
    // the line changing, not on the segment changing.
  }, [nowShown, split, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  // The root's kind is whichever register a TIMED CUE is currently in — the
  // whole band reads as "a cue is up" or "it is not", which is the one piece of
  // state anything outside this module (the accent rule, the runtime gate) has
  // ever cared about.
  const rootKind = activeCue ? 'cue' : (pieceShown.kind ?? nowShown.kind ?? 'empty');

  // THE SAME NOTATION THE RAIL USES, from the same derivation (`numeralStyle`).
  // Both registers of the band print this mark and they may not disagree about
  // how it is written: a rail of twenty-one sets figures because `ROMAN` cannot
  // reach XXI, and a NOW header still setting `V.` beside a rail setting `5.`
  // would be two numbering systems for one fact — which is the defect task 6c
  // was asked to settle, reappearing in the other half of the bond.
  const style = numeralStyle(placed.map((p) => p.segment));
  const segmentNumeral = segment ? numeral(Number(segment.n), segmentIndex, style) : null;
  const segmentName = smartQuotes(trimmed(segment?.name));
  const segmentTranslation = smartQuotes(trimmed(segment?.translation));

  // ---- the bond's two shared decisions --------------------------------------
  // Both come from `../band.js` so this module and the rail cannot disagree
  // about the shape they are drawing two halves of.
  const nowHeading = showsNowHeading(config);
  // ONE definition of "how far through the piece" (review finding I3). This
  // used to be `position / pieceEnd` while the rail measured
  // `(position - first) / (end - first)` — equal only while the first segment
  // starts at 0, which both shipped sidecars do and a sidecar with a late first
  // segment would not. When they disagree the register's panel and the rail's
  // connector point at opposite sides of the screen, each held there by its own
  // hysteresis, and nothing anywhere reports it. `elapsedFraction` is now the
  // single source, called with the same inputs in both modules.
  const pieceEnd = end !== null ? end : (duration > 0 ? duration : 0);
  // ...and from the same PLACED segments, for the same reason. Taking this from
  // `segments[0]` with a `|| 0` coercion re-opened finding I3 one edge over:
  // when the FIRST segment is the unplaceable one, the rail measures from the
  // first segment it can place and this measured from second zero, so the two
  // halves resolved opposite sides and each held there by its own hysteresis.
  // The comment above says both modules are called with the same inputs; this is
  // what makes that true rather than nearly true.
  const pieceFirst = placed.length ? placed[0].start : 0;
  const fraction = elapsedFraction({ position, first: pieceFirst, end: pieceEnd });
  // NaN until the transport reports an extent. That is a real state, not zero:
  // seeding the side from a fraction of 0 and then swapping on the first real
  // tick plays a full band-blanking dissolve during the entrance whenever a
  // work with no `musicEndsAt` resumes past half-way.
  const settled = Number.isFinite(fraction);
  const side = useNowSide(config, fraction, log);

  // The swap is a CONSIDERED MOVE, in the house language. The panel slides
  // across the band (the SCSS, `__ground`) while the two registers' text
  // dissolves — out to the ground, a held beat, in on the other side. Reusing
  // `useDissolve` rather than writing a second choreography is what keeps the
  // swap on the same clock as every other content change in the frame, and it
  // brings `prefers-reduced-motion` (an instant commit) with it for free.
  // `text` is EMPTY until the transport has reported. `useDissolve` commits
  // instantly out of an empty panel (there is nothing on screen to fade), so
  // the first real side arrives without a dissolve — and every side change
  // after it plays the full swap.
  const sideNext = useMemo(
    () => ({
      key: settled ? `side:${side}` : 'side:pending',
      kind: 'side',
      at: null,
      text: settled ? side : '',
    }),
    [side, settled],
  );
  const [sideShown, sideSwapping] = useDissolve(sideNext, LINE_DISSOLVE);
  const renderedSide = sideShown.text
    ? (sideShown.text === 'left' ? 'left' : 'right')
    : side;

  /**
   * THE PANEL TRAVELS ON THE RAIL'S CLOCK (review finding I-6).
   *
   * It used to slide on a CSS `transition: left var(--accordion-ms)` while the
   * rail's waist — which has to stay welded to this panel's whole top edge —
   * jumped to the new hull in the frame the side flipped, because
   * `bondConnector` took the side discretely. For the length of the swap the two
   * halves of "one shape" were in different places: exactly the artifact §7
   * abolished for the segment boundary, surviving in the one event §1 named as
   * a degenerate case to hold.
   *
   * So the panel's left edge is interpolated by the SAME hook, over the same
   * duration, on the same easing, and `SegmentMap` feeds the identical number
   * into `bondConnector`. Both modules resolve `side` from `useNowSide` on the
   * same fraction in the same React commit, so their animations begin on the
   * same frame and the two halves cannot separate. Reduced motion snaps both,
   * which is what `useEasedVector` does with no CSS rule left to cancel.
   */
  const panelTarget = useMemo(
    () => [side === 'left' ? 0 : 1 - NOW_PANEL_SHARE], [side],
  );
  const { shares: panelVector } = useEasedVector(panelTarget, ACCORDION_MS);
  const panelLeft = panelVector[0] ?? 0;

  /**
   * THE PIECE REGISTER'S STANDING LABEL (design wave 7).
   * `short_title` only — never a truncated `title`. A long title cut down to
   * fit would be a different, wronger claim about the work than saying nothing,
   * and the zone reads perfectly well with no header at all.
   */
  const shortTitle = smartQuotes(trimmed(data?.piece?.short_title));

  /**
   * DOES THE NOW HEADER RESERVE A LINE FOR THE GLOSS?
   *
   * It is a property of the PIECE, not of the sounding segment, and that is
   * what keeps the header's height constant: a work where some segments are
   * glossed and some are not would otherwise give the note's box a different
   * run in different segments, and the fit is solved once for the whole piece.
   * Where no segment is glossed at all, no line is reserved and nothing is
   * spent.
   */
  const glossed = useMemo(
    () => placed.some(({ segment: m }) => Boolean(trimmed(m?.translation))),
    [placed],
  );

  return (
    <div
      ref={rootRef}
      className={`surround-cue-ticker surround-cue-ticker--${rootKind}${split ? ' surround-cue-ticker--split' : ''}${split && renderedSide === 'left' ? ' surround-cue-ticker--now-left' : ''}${split && !nowHeading ? ' surround-cue-ticker--no-now-heading' : ''}`}
      data-testid="surround-cue-ticker"
      data-kind={rootKind}
      data-split={split ? 'true' : 'false'}
      data-now-side={split ? side : null}
      data-sounding={split && segment ? 'true' : 'false'}
      style={{
        '--accordion-ms': `${ACCORDION_MS}ms`,
        '--cue-fade-ms': `${CUE_FADE_MS}ms`,
        ...fitStyle(fit),
      }}
    >
      <div className={`surround-cue-ticker__zones${sideSwapping ? ' surround-cue-ticker__zones--swapping' : ''}`}>
        {/* THE NOW PANEL'S GROUND — the band's half of the bond (design wave 7).
            It is a sibling of the zones rather than a background ON the now
            zone, for one reason: when `nowSide` is dynamic this panel has to
            SLIDE from one half of the band to the other, and a background
            cannot travel. Out of flow, so it is not a flex item; behind the
            zones, which carry `position: relative` for exactly that. */}
        {split && (
          // THE PANEL MOVES FIRST, THE WORDS FOLLOW. Its side is the RAW
          // decision, not the dissolved one: the rail's connector starts
          // travelling the instant the side changes, and a panel that waited
          // for the text's commit would leave the connector pointing at half a
          // shape for the length of a fade. Both slide on `--accordion-ms`, so
          // the two halves of the bond arrive together; the registers' text
          // swaps underneath, on the dissolve's own clock.
          <span
            className="surround-cue-ticker__ground"
            data-testid="surround-ticker-ground"
            data-side={side}
            // NOTHING SOUNDING, NOTHING LIT (design wave 9). The bond is what is
            // sounding; before the first segment and after the last there is
            // nothing for it to be, so this panel fades exactly as the rail's
            // does and the register above it is blank.
            data-bonded={segment ? 'true' : 'false'}
            style={{ '--now-left': `${panelLeft * 100}%` }}
            aria-hidden="true"
          />
        )}
        <div
          className="surround-cue-ticker__zone surround-cue-ticker__zone--piece"
          data-testid="surround-ticker-zone-piece"
        >
          {/* THE WORK, NAMED ONCE (design wave 7). A standing label in the
              quietest register on the band — smaller and greyer than the note
              beneath it, because it is the thing the note is ABOUT rather than
              a heading competing with it. Fixed: it never takes the bond's
              ground and never moves with the playhead. */}
          {split && shortTitle && (
            <p
              className="surround-cue-ticker__piece-head"
              data-testid="surround-ticker-piece-head"
            >
              {shortTitle}
            </p>
          )}
          <p
            className={`surround-cue-ticker__text${pieceHidden ? ' surround-cue-ticker__text--hidden' : ''}`}
            data-testid="surround-ticker-text"
            style={{ transition: `opacity ${CUE_FADE_MS}ms ease` }}
          >
            {/* Two elements, because the box and the thing centred in it cannot
                be the same element: the `<p>` is the grid that centres, this
                span is the line. (It used to be the CLAMP as well — wave 5's
                fix, because `-webkit-line-clamp` needs `display: -webkit-box`,
                which drags `align-content` off with it. There is no clamp any
                more: the type is fitted so nothing is cut.) */}
            <span className="surround-cue-ticker__line">{pieceShown.text}</span>
            {/* THE RULER (design wave 9) — see `../fit.js`. Rendered, never
                conditional, so the tree's depth is constant and the measurement
                inherits every typographic property from the box it measures. */}
            <span className="surround-cue-ticker__probe" aria-hidden="true" />
          </p>
        </div>

        {split && (
          <div
            className={`surround-cue-ticker__zone surround-cue-ticker__zone--now${activeCue ? ' surround-cue-ticker__zone--cue' : ''}`}
            data-testid="surround-ticker-zone-now"
            data-borrowed={borrowed ? 'true' : 'false'}
          >
            {/* THE HEADING IS OFF BY DEFAULT (design wave 7). The rail six
                inches above already names the sounding segment, and the bond
                — this panel's ground, continuous with that segment's — is what
                now says WHICH one without printing it twice. `band.nowHeading`
                brings it back: `always`, or `auto` on a bars-only rail that has
                no name of its own for the bond to point at.
                When it IS shown it is still NOT part of the dissolve. It names
                what is sounding, and that changes on a segment boundary — a
                beat the viewer can already see happening on the rule above.
                Fading it with the note beneath it would make an ordinary
                rotation look like the piece had moved on. */}
            {nowHeading && (
            <p
              className="surround-cue-ticker__now"
              data-testid="surround-ticker-now"
              data-sounding={segment ? 'true' : 'false'}
            >
              {/* NOTHING SOUNDING IS BLANK (design wave 9). It used to print
                  "Listen for" over the applause and over the walk-on, which is
                  a header for a note that is not there — the register has no
                  subject in that state, and inventing one is the frame talking
                  when it has nothing to say. The lines are still RESERVED
                  (blank, not absent): an element that disappeared would hand its
                  height to the note's box below, change the room the fit was
                  solved against, and resize the whole band's type on a segment
                  boundary. */}
              <span className="surround-cue-ticker__now-head">
                {segmentName ? (
                  <>
                    {segmentNumeral && <span className="surround-cue-ticker__now-numeral">{segmentNumeral}</span>}
                    <span className="surround-cue-ticker__now-name">{segmentName}</span>
                  </>
                ) : BLANK_LINE}
              </span>
              {glossed && (
                <span className="surround-cue-ticker__now-translation">
                  {segmentTranslation || BLANK_LINE}
                </span>
              )}
            </p>
            )}
            <p
              className={`surround-cue-ticker__text surround-cue-ticker__text--now${nowHidden ? ' surround-cue-ticker__text--hidden' : ''}`}
              data-testid="surround-ticker-listen"
              style={{ transition: `opacity ${CUE_FADE_MS}ms ease` }}
            >
              <span className="surround-cue-ticker__line">{nowShown.text}</span>
              <span className="surround-cue-ticker__probe" aria-hidden="true" />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

CueTicker.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
