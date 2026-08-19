// frontend/src/modules/Surround/modules/MovementMap.jsx
//
// The signature element of the concert-hall surround, and the only place the
// design spends any boldness.
//
// This is NOT a progress bar. It is set as the barline grammar of engraved music:
// one hairline staff rule, one quiet separator between movements, each segment
// proportional to that movement's real duration, names above the rule with the
// tempo term in italic.
//
// WHERE THE RULE SITS (design wave 4)
// -----------------------------------
// At the TOP of the band, tight against the video's bottom edge — inside the
// footer's own overlap, so the timeline reads as the picture's own baseline
// rather than as a bar floating in a strip of black below it. The movement
// names hang BELOW the rule. That inverts wave 2's arrangement, and the
// clearance law it was written for still binds, only mirrored: the playhead
// lane is ABOVE, the names are below, and the two boxes must not meet.
//
// WHERE PROGRESS IS READ (design wave 2)
// --------------------------------------
// From the FILL, not from the cursor. The sounding movement's rule thickens and
// sweeps left to right as it elapses; finished movements read as filled; movements
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
// When a movement becomes active its segment WIDENS until its heading and its
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
// a movement heading the rail has already set six inches above it.
//
// Module contract: { position, duration, playing, seeking, data, region }.
// `logger` is threaded alongside as infrastructure, not as content.

import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { smartQuotes } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import {
  resolveBandConfig, useNowSide, useEasedShares, accordionShares, playheadFraction,
  bondConnector, elapsedFraction, activeMovementIndex, placedMovements, roman,
  ACCORDION_MS, SEGMENT_FLOOR_PX,
} from '../band.js';
import './MovementMap.scss';

/**
 * Split an engraved movement heading into its title and its tempo marking.
 * "Marcia funebre. Adagio assai" -> { title: 'Marcia funebre.', tempo: 'Adagio assai' }
 * "Allegro con brio"            -> { title: null,               tempo: 'Allegro con brio' }
 * Scores set the tempo term in italic and any character title in roman; the last
 * period is the divider that convention uses.
 */
function splitHeading(name) {
  const text = String(name ?? '').trim();
  if (!text) return { title: null, tempo: '' };
  const cut = text.lastIndexOf('.');
  if (cut <= 0 || cut === text.length - 1) return { title: null, tempo: text };
  return { title: text.slice(0, cut + 1).trim(), tempo: text.slice(cut + 1).trim() };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The rule has not been measured. Zero is not a width — it is the absence of
 * one, and `accordionShares` treats it as such (the rail renders its
 * duration-derived widths and the accordion stays inert). Named rather than
 * inlined because "no measurement yet" is a state this module reasons about in
 * three places, not a magic zero.
 */
const RAIL_UNMEASURED = 0;

export default function MovementMap({
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
  const log = useMemo(() => surroundLogger(logger, 'movement-map'), [logger]);
  const contentId = data?.contentId ?? null;
  const config = useMemo(() => resolveBandConfig(data), [data]);
  // THE COMPACT RAIL (`band.railDensity: 'bars'`). The rule, its barlines and
  // the playhead, with no names under them — for a band too short to carry
  // type, or a screen where the movement titles belong somewhere else. It is
  // what makes `nowHeading: 'auto'` a real decision rather than a constant:
  // with no names on the rule, the listening band is the only surface left
  // that can say what is sounding, so the NOW heading comes back on.
  const named = config.railDensity !== 'bars';

  // Memoized: the `[]` fallback would otherwise be a fresh array every render and
  // recompute `segments` on every 10 Hz tick.
  const movements = useMemo(
    () => (Array.isArray(data?.movements) ? data.movements : []), [data],
  );

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
  const end = Number.isFinite(musicEndsAt) && musicEndsAt > 0 ? musicEndsAt : duration;

  // ONLY THE MOVEMENTS THIS RECORDING CAN PLACE. `placedMovements` drops any
  // whose start the store refused (it ships `start: undefined` and warns) or
  // whose start runs backwards — the alternative, the `Number(m?.start) || 0`
  // this used to do, re-anchors a mid-piece movement to the top of the file and
  // draws a zero-width, out-of-order segment with complete confidence. The band
  // asks the same function, so both halves place the same movements.
  const placed = useMemo(() => placedMovements(movements), [movements]);

  // A movement the rail cannot place is a real event on a real screen, not a
  // silent filter: the store already warned that the START was wrong, and this
  // says what the renderer did about it.
  useEffect(() => {
    if (placed.length === movements.length) return;
    log.warn('surround.movements.unplaceable', {
      contentId,
      authored: movements.length,
      placed: placed.length,
      dropped: movements
        .map((m, i) => (placed.some((p) => p.index === i) ? null : (m?.n ?? i + 1)))
        .filter((n) => n !== null),
    });
  }, [placed, movements, contentId, log]);

  const segments = useMemo(() => {
    if (!placed.length) return [];
    const first = placed[0].start;
    const span = end - first;
    if (!(span > 0)) return [];
    return placed.map(({ movement: m, start }, i) => {
      const next = i + 1 < placed.length ? placed[i + 1].start : end;
      const stop = Math.max(start, Math.min(next, end));
      return {
        n: m?.n,
        // Every authored string the frame prints goes through one curl at its
        // render seam (`../typography.js`). A movement name is set in Garamond
        // on stock; a straight apostrophe in it is the only unset mark on the
        // screen.
        name: smartQuotes(m?.name ?? ''),
        // The editor's gloss on the tempo term — "Allegro con brio" -> "Fast,
        // with spirit". Optional per movement: an unauthored translation
        // renders NO element at all, never an empty line holding space.
        translation: typeof m?.translation === 'string' && m.translation.trim()
          ? smartQuotes(m.translation.trim()) : null,
        start,
        stop,
        // The DURATION-derived share of the rule — what the segment is worth in
        // time. The accordion may render it wider or narrower; this stays the
        // proportion every redistribution is measured against.
        natural: (stop - start) / span,
      };
    });
  }, [placed, end]);

  const first = segments.length ? segments[0].start : 0;
  const span = end - first;

  // -1 = NO MOVEMENT IS SOUNDING — the applause after the final chord, and
  // equally the tuning or the announcement before the first one. This loop used
  // to fall through to `return 0` for a position before the first start, which
  // lit movement I over music that had not begun while the band six inches below
  // printed its "nothing is playing" header. One derivation now answers for
  // both (`../band.js`), and it answers -1.
  const activeIndex = useMemo(
    () => activeMovementIndex({ placed: segments, position, end }),
    [segments, position, end],
  );
  /** Nothing has sounded YET — as against nothing sounding any more. */
  const unsounded = activeIndex < 0 && segments.length > 0 && position < segments[0].start;

  // ---- the accordion's two measurements -------------------------------------
  // The rule's own width, and how wide the SOUNDING segment would have to be for
  // neither its heading nor its gloss to be cut. Both are read off the DOM
  // because both are typographic facts (how wide is this rail, how wide is this
  // string in this face at this size) that no amount of arithmetic can supply.
  const ruleRef = useRef(null);
  const [railPx, setRailPx] = useState(RAIL_UNMEASURED);
  const [desiredPx, setDesiredPx] = useState(0);
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

  const measureDesired = useCallback(() => {
    const rule = ruleRef.current;
    // A bars-only rail has no type to right-size for.
    if (!rule || activeIndex < 0 || !named) { setDesiredPx(0); return; }
    const seg = rule.querySelector(`[data-index="${activeIndex}"]`);
    const cell = seg?.querySelector('.surround-movement-map__text');
    if (!seg || !cell) { setDesiredPx(0); return; }
    const segW = seg.getBoundingClientRect().width;
    const cellW = cell.getBoundingClientRect().width;
    // The chrome around the text column — the numeral's gutter and the text
    // insets — is a CONSTANT, so `desired` does not depend on the width the
    // accordion is about to set and cannot feed back into itself. Below ~1px of
    // cell there is nothing to subtract from and the reading would be garbage.
    if (!(cellW > 1) || !(segW > cellW)) { setDesiredPx(0); return; }
    const heading = seg.querySelector('.surround-movement-map__heading');
    const gloss = seg.querySelector('.surround-movement-map__translation');
    // `scrollWidth` on a `nowrap` + `overflow: hidden` box is the string's full
    // single-line width whatever the box is currently showing.
    const need = Math.max(heading?.scrollWidth ?? 0, gloss?.scrollWidth ?? 0);
    // THE ACCORDION ONLY EVER OPENS WHEN IT NEEDS TO (review finding, minor 3).
    // On a `nowrap` box that is NOT overflowing, `scrollWidth === clientWidth`,
    // so `need === cellW` and a bare `+ 1` asked for one pixel more than the
    // segment already had — enough to clear `extra > EPS` and quietly take a
    // pixel off every neighbour for a movement whose name already fitted. The
    // rounding-up margin is only spent where there is genuine overflow.
    if (!(need > cellW + 0.5)) { setDesiredPx(0); return; }
    const desired = Math.ceil((segW - cellW) + need) + 1;
    setDesiredPx(desired);
    // Review finding I5: the accordion's one measured input. It decides every
    // width on the rail and it is read off the DOM in a face that arrives
    // asynchronously, so it is the number to look at first when a rail on a
    // real screen is not the shape it should be.
    log.debug('surround.accordion.measured', {
      contentId, index: activeIndex, desired, need: Math.round(need),
      chrome: Math.round(segW - cellW), railPx: Math.round(railPx),
    });
  }, [activeIndex, named, log, contentId, railPx]);

  useLayoutEffect(() => { measureDesired(); },
    [measureDesired, segments, fontsTick]);

  const targetShares = useMemo(() => accordionShares({
    natural: segments.map((s) => s.natural),
    activeIndex,
    railPx,
    desiredPx,
    floorPx: SEGMENT_FLOOR_PX,
  }), [segments, activeIndex, railPx, desiredPx]);

  // ONE CLOCK (review finding I2). The widths are interpolated HERE, in JS, and
  // everything positional below — the segment widths, the playhead, the bond
  // and its connector — is derived from the array this returns in the same
  // render. The stylesheet animates none of it. Two clocks (a CSS `transition:
  // width` and the playhead's own ramp) is what let the cursor reach the
  // widened solution while the painted boundary was still 300ms away from it.
  const { shares, moving } = useEasedShares(targetShares, ACCORDION_MS);

  // Review finding I5: the degrade branch. When the sounding movement's name
  // cannot have the width it needs without starving its neighbours past the
  // floor, it takes what is free and keeps its ellipsis — a designed
  // degradation, and one that is invisible on screen (a trimmed name looks
  // like a trimmed name whatever the reason). This is the only way to tell
  // "the rail is crowded" from "the corpus authored a long name".
  const starved = desiredPx > 0 && railPx > 0
    && (targetShares[activeIndex] ?? 0) * railPx < desiredPx - 1;
  const lastStarved = useRef(null);
  useEffect(() => {
    const key = starved ? `${activeIndex}` : null;
    if (lastStarved.current === key) return;
    lastStarved.current = key;
    if (!starved) return;
    log.debug('surround.accordion.degraded', {
      contentId,
      index: activeIndex,
      desired: desiredPx,
      granted: Math.round((targetShares[activeIndex] ?? 0) * railPx),
      floor: SEGMENT_FLOOR_PX,
      movements: segments.length,
    });
  }, [starved, activeIndex, desiredPx, targetShares, railPx, segments.length, contentId, log]);

  // ---- the bond -------------------------------------------------------------
  // ONE definition of "how far through the piece" (review finding I3) — see
  // `elapsedFraction`. The band computes its own side from the same function
  // with the same inputs, so the two halves of the bond cannot point at
  // opposite sides of the screen.
  const side = useNowSide(config, elapsedFraction({ position, first, end }), log);

  const bond = useMemo(() => {
    if (activeIndex < 0 || !shares.length) return null;
    let start = 0;
    for (let i = 0; i < activeIndex; i += 1) start += shares[i] ?? 0;
    const width = shares[activeIndex] ?? 0;
    return { start, width, connector: bondConnector({ segStart: start, segEnd: start + width, side }) };
  }, [activeIndex, shares, side]);

  const lastLogged = useRef(null);
  useEffect(() => {
    if (!segments.length) return;
    if (lastLogged.current === activeIndex) return;
    lastLogged.current = activeIndex;
    const active = activeIndex >= 0 ? segments[activeIndex] : null;
    log.debug('surround.movement.change', {
      contentId,
      index: activeIndex,
      n: active?.n ?? null,
      name: active?.name ?? null,
      position: Math.round(position),
    });
    // `position` is read for the log payload only; the event fires on the change.
  }, [activeIndex, segments, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!segments.length) return null;

  // THE GUTTER IS SIZED ONCE PER RAIL, not per segment — that is the whole point
  // of it. A piece running to IX. gives every one of its segments a IX.-wide
  // track, so all of them share one text edge; a piece of three movements gets a
  // narrower one and wastes nothing.
  const numeralChars = segments.reduce(
    (max, seg, i) => Math.max(max, roman(seg.n, i).length), 1,
  );

  const headPct = playheadFraction({ segments, shares, position, end }) * 100;

  return (
    <div
      className={`surround-movement-map${named ? '' : ' surround-movement-map--bars'}`}
      data-testid="surround-movement-map"
      data-now-side={side}
      data-density={named ? 'names' : 'bars'}
      style={{
        '--numeral-chars': String(numeralChars),
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
      <div className="surround-movement-map__rule" ref={ruleRef}>
        <span className="surround-movement-map__barline surround-movement-map__barline--terminal surround-movement-map__barline--start" aria-hidden="true" />

        {/* THE BOND (design wave 7). ONE element that MOVES, rather than a
            per-segment background that lights and unlights: the point the user
            asked for is that the eye FOLLOWS the highlight from the rail down
            into the listening band, and a thing that travels is followed where
            a thing that blinks is not. It is written before the segments so it
            paints beneath them (both are positioned, so DOM order is paint
            order), and it hangs below the rule's box by the band's own bottom
            padding so its ground reaches the seam the NOW panel starts at. */}
        <span
          className="surround-movement-map__bond"
          data-testid="surround-bond"
          data-bonded={bond ? 'true' : 'false'}
          style={bond
            ? { '--bond-left': `${bond.start * 100}%`, '--bond-width': `${bond.width * 100}%` }
            : { '--bond-left': '0%', '--bond-width': '0%' }}
          aria-hidden="true"
        />
        {/* The connector: a shoulder in the same ground running along the band's
            seam, from the active segment across to the NOW panel. Zero-width —
            and so invisible — whenever the segment already sits over the panel,
            which is the "they simply touch" case. */}
        <span
          className="surround-movement-map__bond-connector"
          data-testid="surround-bond-connector"
          data-bridging={bond && bond.connector.width > 0 ? 'true' : 'false'}
          style={bond
            ? {
              '--connector-left': `${bond.connector.start * 100}%`,
              '--connector-width': `${bond.connector.width * 100}%`,
            }
            : { '--connector-left': '0%', '--connector-width': '0%' }}
          aria-hidden="true"
        />

        {segments.map((seg, i) => {
          // NOTHING SOUNDING HAS TWO OPPOSITE MEANINGS, and the rail must not
          // confuse them. After the last chord every movement HAS sounded and
          // the rule reads full; before the first one — a recording that opens
          // on tuning or an announcement, which the corpus explicitly permits —
          // none of them has, and a rule drawn full would say the piece was over
          // before it began.
          const state = activeIndex === i ? 'active'
            : unsounded ? 'future'
              : (activeIndex === -1 || i < activeIndex) ? 'elapsed' : 'future';
          const { title, tempo } = splitHeading(seg.name);
          // How much of THIS movement has sounded. Elapsed movements read full,
          // future ones empty, and the sounding one sweeps — that sweep is where
          // the viewer reads progress now. It is a fraction of the SEGMENT, so
          // the accordion cannot desynchronise it: whatever width the segment is
          // drawn at, the fill is that fraction of it.
          const length = seg.stop - seg.start;
          const fill = state === 'elapsed' ? 1
            : state === 'future' ? 0
              : (length > 0 ? clamp01((position - seg.start) / length) : 0);
          return (
            <div
              key={`${seg.n ?? i}:${seg.start}`}
              className={`surround-movement-map__segment surround-movement-map__segment--${state}`}
              data-testid="surround-movement"
              data-state={state}
              data-index={i}
              data-natural={seg.natural.toFixed(6)}
              style={{ width: `${(shares[i] ?? seg.natural) * 100}%` }}
            >
              {/* ONE quiet separator between movements. The double barline was
                  correct notation and too much ink at this size — it read as
                  clutter across four segments, so the grammar keeps the mark
                  and drops the doubling. */}
              {i > 0 && (
                <span
                  className="surround-movement-map__barline surround-movement-map__barline--separator"
                  aria-hidden="true"
                />
              )}
              {/* THE RULE COMES FIRST (design wave 4). The rule row rides at
                  the TOP of the band, in the overlap zone under the video's
                  bottom edge; the movement names hang BELOW it. Source order
                  is the layout order — no `column-reverse`, so the DOM a
                  screen reader walks is the order a viewer sees. */}
              <span className="surround-movement-map__bar" aria-hidden="true">
                {/* The fill is a full-width bar SCALED to its fraction, not a
                    bar whose width is set — see the stylesheet: a painted box's
                    position/size is pixel-snapped and a transform's is not, and
                    at this scale (a movement is minutes long across a few
                    hundred pixels) snapping is the difference between a glide
                    and a crawl. `--fill` is 0..1. */}
                <span
                  className="surround-movement-map__bar-fill"
                  data-testid="surround-movement-fill"
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
                  named one and buy nothing. */}
              {named && (
              <span className="surround-movement-map__text-row">
                <span className="surround-movement-map__numeral">{roman(seg.n, i)}</span>
                <span className="surround-movement-map__text">
                  <span className="surround-movement-map__heading">
                    {title && <span className="surround-movement-map__title">{title}</span>}
                    {tempo && <span className="surround-movement-map__tempo">{tempo}</span>}
                  </span>
                  {/* THE TRANSLATION (design wave 6). A recessive sub-line under
                      the heading, in the annotation face — sans, not Garamond —
                      so it reads as a gloss on the Italian rather than as more
                      programme. One line, ellipsized, exactly like the heading
                      above it: design wave 7 made the whole rail single-line and
                      widens the SOUNDING segment instead of wrapping anything. */}
                  {seg.translation && (
                    <span
                      className="surround-movement-map__translation"
                      data-testid="surround-movement-translation"
                    >
                      {seg.translation}
                    </span>
                  )}
                </span>
              </span>
              )}
            </div>
          );
        })}
        <span className="surround-movement-map__barline surround-movement-map__barline--terminal surround-movement-map__barline--end" aria-hidden="true" />

        {/* A barline in motion: one brass hairline, unlit. The ELEMENT is the
            width of the rule and carries the hairline on its right edge (see
            the stylesheet); `--head` is how far along, 0..1. That is what lets
            the cursor move on a compositor transform with sub-pixel precision
            instead of snapping a whole pixel at a time.
            Since design wave 7 the fraction is read off the RENDERED widths, not
            off the piece's elapsed time — see `band.js`, `playheadFraction`. */}
        <span
          className="surround-movement-map__playhead"
          data-testid="surround-playhead"
          data-head={(headPct / 100).toFixed(4)}
          style={{ '--head': String(headPct / 100) }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

MovementMap.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
