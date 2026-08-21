// frontend/src/modules/Surround/map/EraTimeline.jsx
//
// "WHEN was this written" — the third question the rail asks, after where the
// composer lived and where in that country.
//
// It lives in `map/` beside `CountryMap` for one reason: it is the same KIND of
// thing. Both take a fact out of the sidecar (a country, an era), draw it as a
// position inside a fixed extent, and name the things around it so the position
// can actually be read. A shape with a star in it tells a viewer who cannot
// place Austria nothing; a line reading "Classical" tells a viewer who cannot
// place the Classical era exactly as little. Context is the content in both.
//
// DESIGN WAVE 10 — THE PLUMB. The first shipped version drew the right marks
// and could not be read, and the review that found it named four causes:
//
//   1. NOT ONE DATE WAS PRINTED on a rule spanning three and a half centuries,
//      so a marker on it could not be located. The only numeral on the plate
//      was the marker's own year, which is the one thing a scale is supposed to
//      help you place rather than the thing that places it.
//   2. THE TYPE SCALE WAS FLAT. Every mark sat between 0.72rem and 0.95rem, so
//      the one fact the programme asserts — the year — was the smallest thing
//      on the plate, and at ten feet the whole slide was an even grey.
//   3. BRASS WAS SPLIT ACROSS TWO MARKS AND TWO VALUES: a `--brass` year and a
//      `--brass-lit` marker, an inch apart, with nothing joining them. Two
//      accents is no accent.
//   4. THE MARKER WAS A BARLINE among barlines. 1742 stands eight years from
//      the Baroque join; two hairlines of near-equal height that close together
//      read as a doubled join, and a Baroque work lands there most times.
//
// So the drawing is now ONE OBJECT: a plumb line. The year hangs in brass at
// the top, a brass thread drops from it, and the thread lands in the rule as a
// marker that descends BELOW the line — a bob, not a barline, and the only mark
// on the plate whose silhouette is asymmetric. The year does not sit near its
// position, it hangs from it, and the thread is what makes the two one mark
// instead of two.
//
// WHAT IS DRAWN, top to bottom
//   * a DATELINE: the authored period, and the years the era(s) it names run
//     between. This is what makes the subject era readable as a span rather
//     than as a word, and it is why the names on the rule below no longer have
//     to shout — see `layoutEraLabels`;
//   * the YEAR, in brass, at display size, hung at its own position on the
//     rule with `yearAnchorFor` deciding which side of the thread it hangs on
//     so it cannot run off either end of the plate;
//   * the THREAD, and the RULE it lands in: one hairline spanning
//     `TIMELINE_SPAN` (1550-1910), divided into the four era bands of `ERAS`,
//     restrained barlines between them, the SUBJECT band(s) brightened;
//   * the EXTENT — the span's own two ends, written. Three numerals on the
//     plate (1550, the year, 1910) are what turn a bar into a scale;
//   * the era names below their bands, in the map's own label register
//     (letterspaced small caps of the display face) — dropped, never shrunk,
//     when they cannot fit;
//   * the period note beneath, in the caption's register.
//
// THE DATES ARE DATA, AND THEY ARE CONTESTABLE. Every boundary below is argued
// over by people who have spent careers on it — 1600 and 1750 are conventions,
// not events, and "Romantic to 1910" is one reading of several. They live in
// ONE exported constant so the argument has exactly one place to be settled,
// rather than being spread through a stylesheet as percentages.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { surroundLogger } from '../moduleKit.js';
import { smartQuotes } from '../typography.js';
import { LABEL_FLOOR_ANCHOR_PX } from '../fit.js';
import { useLabelFloorPx } from '../useLabelFloor.js';
import './EraTimeline.scss';

/**
 * The extent the hairline spans. Deliberately a little wider than the eras it
 * carries at BOTH ends: a marker that lands on the very first or very last
 * pixel of the rule reads as "off the edge" rather than as "early Baroque".
 *
 * Both ends are now WRITTEN on the plate (`__extent`), which is what makes the
 * generosity legible rather than merely present — a reader can see that the
 * line starts before the music does.
 */
export const TIMELINE_SPAN = Object.freeze({ from: 1550, to: 1910 });

/**
 * The era bands. `to` is exclusive of the next band's `from` by construction —
 * they tile the span with no gaps, which is what makes the rule read as one
 * line divided rather than as four bars laid out on it.
 *
 * These are the conventional Anglophone music-history boundaries, and they are
 * conventions: 1600 is the Florentine Camerata rounded off, 1750 is Bach's
 * death used as a convenient full stop, 1820 is Beethoven's middle period
 * ending, 1910 is where the histories stop calling it Romantic. Edit them HERE
 * and the drawing, the dateline, the label fitting and the subject matching all
 * follow.
 */
export const ERAS = Object.freeze([
  Object.freeze({ name: 'Renaissance', from: 1550, to: 1600 }),
  Object.freeze({ name: 'Baroque', from: 1600, to: 1750 }),
  Object.freeze({ name: 'Classical', from: 1750, to: 1820 }),
  Object.freeze({ name: 'Romantic', from: 1820, to: 1910 }),
]);

/**
 * Design floor: nothing below the frame's ten-foot label floor. Same law as the
 * map, and the same number, now that the floor is measured per screen root
 * (`../fit.js`): this is its value at the 1280 anchor, and it is what a timeline
 * rendered outside a frame is laid out at. The component below reads the live
 * one and passes it in.
 */
export const ERA_LABEL_PX = LABEL_FLOOR_ANCHOR_PX;
/**
 * Average advance per character for the tracked uppercase display face, in ems
 * of the label's own size, and the tracking added to it. Used only to give a
 * label an approximate WIDTH so the fitting below can be decided without a DOM
 * text measurement per label per resize.
 *
 * MEASURED, NOT GUESSED (wave 10). It was 0.62, chosen to be conservative in
 * the direction that keeps a name, and it was simply WRONG for this face:
 * Cormorant Garamond's tracked caps measured in Chromium at 8.64/11.52/17.28px
 * come out at 0.714 em/char for CLASSICAL, 0.803 for ROMANTIC and 0.824 for
 * BAROQUE — against the 0.74 this file assumed. An estimate that under-reads by
 * 11% does not merely mis-fit, it lets two labels the collision test believes
 * are clear PRINT INTO EACH OTHER, which is what rendering the plate at the 960
 * root showed: "CLASSICALROMANTIC", set solid.
 *
 * So the pair now covers the WIDEST measured name (0.824) rather than the mean.
 * That costs CLASSICAL its label on the smallest plate — where the two really
 * do not both fit — and buys the guarantee that nothing the fitting places ever
 * overlaps. The tracking is added separately so a change to the stylesheet's
 * `letter-spacing` has one obvious place to be mirrored.
 */
export const ERA_LABEL_EM_PER_CHAR = 0.71;
export const ERA_LABEL_TRACKING_EM = 0.12;
/**
 * ...AND PER NAME, WHICH IS WHAT THE TABLE ACTUALLY NEEDS.
 *
 * One average over four names cannot be right for four names, and being wrong
 * costs something in BOTH directions: read narrow and two labels print into each
 * other, read wide and a label that would have fitted is deleted. A single
 * figure covering the widest name (BAROQUE, 0.824) over-reads CLASSICAL by 16%,
 * which is enough to lose CLASSICAL on the office screen — a name the shipped
 * version wrote there.
 *
 * There are four names and they are frozen, so they are measured rather than
 * averaged. Chromium, Cormorant Garamond 500, uppercase, `letter-spacing:
 * 0.12em`, at 8.64 / 11.52 / 17.28px — the ratio is identical at all three, so
 * one figure per name holds for every root. TRACKING IS INCLUDED: these are
 * what the face sets, not a body width plus an allowance.
 *
 * Margin of 2% over measured, for sub-pixel and hinting differences between
 * this engine and the kiosks'. Anything not in this table falls back to the
 * pair above, which is the widest measured name — safe in the direction that
 * cannot overlap.
 */
export const ERA_LABEL_EM = Object.freeze({
  Renaissance: 0.775,   // measured 0.7599
  Baroque: 0.840,       // measured 0.8236 — the widest
  Classical: 0.728,     // measured 0.7139 — the narrowest
  Romantic: 0.819,      // measured 0.8027
});
/**
 * How far past its own band a label may reach before it stops pointing at
 * anything. The eras are contiguous, so a little overhang is fair — the
 * neighbouring label's collision test is the real guard — but a "RENAISSANCE"
 * three times the width of the fifty years it names is a caption for the wrong
 * part of the line. This is what makes the shortest band's label appear on a
 * 1080p rail and drop on a 540p one, which is the adaptive behaviour the design
 * asks for rather than a label that is simply always absent.
 */
export const ERA_LABEL_OVERHANG = 1.6;
/**
 * Breathing room between two placed labels, IN EMS OF THE LABEL'S OWN SIZE.
 *
 * Wave 10 raised this from a flat 6px and made it relative, and both halves of
 * that are the same fix. A period naming two eras lights two adjacent bands, so
 * CLASSICAL and ROMANTIC were being placed at the old 6px minimum — and 6px is
 * about one and a half word-spaces at this tracking, which is to say the two
 * labels rendered as the single phrase "CLASSICAL ROMANTIC". Four word-spaces
 * reads as two labels. It has to scale with `labelPx` for the same reason the
 * floor does: the fleet's three screen roots set this type at three sizes, and
 * a gap that separates at 1920 closes at 960.
 */
export const ERA_LABEL_GAP_EM = 1.4;
/**
 * ...and the gap the COLLISION test uses, which is a different number for a
 * reason worth stating: one of these gaps nudges, the other one deletes.
 *
 * The relax pass above moves subject labels apart and always converges, so a
 * generous gap there costs nothing. `clashes()` below DROPS a label that cannot
 * clear its neighbour, so a generous gap there buys separation by deleting era
 * names — and it does: raising the single flat gap to 1.4em cost CLASSICAL its
 * name on the 960 root, where it sits 7.7px from ROMANTIC. A crowded name is a
 * smaller failure than a missing one.
 *
 * BUT IT CANNOT BE THE OLD 6px EITHER, and rendering the plate is what settled
 * the number. At the 960 root CLASSICAL and ROMANTIC stand about six pixels
 * apart — a shade over one word-space at that size — and they came out set
 * solid, "CLASSICALROMANTIC", which is the same failure the subject relaxation
 * exists to prevent, in the path that has no relaxation. Two names that close
 * are not two names.
 *
 * 0.85em clears about two word-spaces. It keeps CLASSICAL on the 1280 office
 * screen, where the pair has room, and drops it on the 960 root, where it does
 * not — which is the adaptive behaviour the overhang rule already gives the
 * shortest band's name. `never places two names into each other` and
 * `writes CLASSICAL where there is room for it` pin both ends.
 */
export const ERA_LABEL_CLASH_EM = 0.85;
/**
 * How near an end the plumb may fall before the year stops hanging centred on
 * its thread and hangs off one side of it instead.
 *
 * At 0.22 of the span this is 1550-1629 and 1831-1910 — the two stretches where
 * a display-sized numeral centred on its own position would put half of itself
 * outside the plate, where the mat's `overflow: hidden` would cut it. Hanging
 * it off one side keeps the thread at the TRUE year, which is the thing that
 * must not be approximated; only the numeral's alignment gives way.
 */
export const YEAR_ANCHOR_EDGE = 0.22;
/**
 * The width assumed before the element has been measured (and in jsdom, where
 * every box is 0x0). The rail's plate is ~420px on the kiosk this was designed
 * against — the same estimate `CountryMap.RENDER_W` is built on, for the same
 * box.
 */
export const NOMINAL_WIDTH_PX = 420;


const SPAN = TIMELINE_SPAN.to - TIMELINE_SPAN.from;

/** A year -> its fraction along the rule, 0..1. Outside the span returns null. */
export function fractionFor(year) {
  const n = Number(year);
  if (!Number.isFinite(n)) return null;
  if (n < TIMELINE_SPAN.from || n > TIMELINE_SPAN.to) return null;
  return (n - TIMELINE_SPAN.from) / SPAN;
}

/**
 * Which era bands the piece's period lights up.
 *
 * WORD-BOUNDARY matching, case-insensitively, because the authored period is a
 * human phrase rather than an enum: "Baroque", "Classical", "Classical to
 * Romantic", "Late Romantic" all have to resolve, and a phrase naming two eras
 * means both — the work sits across the join, which is exactly what a timeline
 * can show and a single label cannot.
 *
 * Fix round 1 (review finding M4): a plain substring test lit CLASSICAL for a
 * period of "Neoclassical" — a real, distinct music-history term this table
 * does not carry, not a hinge phrase naming the Classical era. `\b` anchors
 * the match to a whole word, which "Classical to Romantic" and "Late
 * Romantic" still satisfy exactly as before.
 *
 * Returns era NAMES, in `ERAS` order, so two callers cannot disagree about
 * which of two matched eras is "first".
 */
export function subjectErasFor(period) {
  const text = String(period ?? '');
  if (!text.trim()) return [];
  return ERAS.filter((era) => new RegExp(`\\b${era.name}\\b`, 'i').test(text)).map((era) => era.name);
}

/**
 * THE DATELINE — the plate's one-line heading, and wave 10's answer to the
 * finding that the drawing said less than the sentence under it.
 *
 * It prints the AUTHORED period rather than the matched era names, and that is
 * the whole reason it can exist without repeating the rule below it: an author
 * who wrote "Late Baroque" or "Classical to Romantic" said something the four
 * era names cannot, and the dates then say what those words are worth in years.
 * The rule draws the same fact as a position; the dateline states it as a span.
 *
 * The span is the union of the matched bands — min `from` to max `to` — because
 * a hinge period genuinely covers both, and taking only the first band's dates
 * would print a range the drawing contradicts.
 *
 * @param {string|null} period the authored period phrase.
 * @param {string[]} subjects era names it lit, from `subjectErasFor`.
 * @returns {{era: string, span: string|null}|null} null when nothing was
 *   authored; `span` null for a period the era table has never heard of, which
 *   still deserves its heading — the words are the author's, the dates are ours
 *   and we do not have them.
 */
export function datelineFor(period, subjects = []) {
  const era = String(period ?? '').trim();
  if (!era) return null;
  const lit = ERAS.filter((e) => subjects.includes(e.name));
  if (!lit.length) return { era, span: null };
  const from = Math.min(...lit.map((e) => e.from));
  const to = Math.max(...lit.map((e) => e.to));
  // An en dash, because it is a range of years and not a compound word.
  return { era, span: `${from}–${to}` };
}

/**
 * Which side of its thread the year hangs on.
 *
 * A pure function so the three cases can be asserted without a layout engine.
 * `start` sets the numeral's left edge at the thread, `end` sets its right edge
 * there, `middle` centres it — and the stylesheet does exactly that with a
 * `transform`, so the thread's own `left` is never adjusted to compensate. The
 * year moves; the position does not.
 *
 * @returns {'start'|'middle'|'end'|null} null for no marker at all.
 */
export function yearAnchorFor(frac, edge = YEAR_ANCHOR_EDGE) {
  if (frac === null || !Number.isFinite(frac)) return null;
  if (frac < edge) return 'start';
  if (frac > 1 - edge) return 'end';
  return 'middle';
}

/**
 * A label's estimated width in px at the floor size.
 *
 * `labelPx` is the floor THIS ROOT gets. It has to be an argument rather than a
 * constant: the placement below decides which era names survive, and solving
 * that against the office screen's floor on the living room would drop names
 * that fit there and keep names that do not.
 */
export function eraLabelWidthPx(name, labelPx = ERA_LABEL_PX) {
  const em = ERA_LABEL_EM[name] ?? (ERA_LABEL_EM_PER_CHAR + ERA_LABEL_TRACKING_EM);
  return String(name).length * em * labelPx;
}

/**
 * Which era names get written, and where.
 *
 * A pure function of the measured width, which is the whole point: it can be
 * driven at 960, 1280 and 1920 in a unit test without a layout engine, and the
 * component's only job is to hand it a real number.
 *
 * THE RULES, in the order they are applied:
 *   1. SUBJECT LABELS ARE NEVER DROPPED. Same law as the map's subject country:
 *      the era this piece belongs to is the one thing the slide exists to say.
 *      They are placed first and, if two adjacent subjects crowd each other,
 *      they are NUDGED apart rather than one being discarded.
 *   2. A non-subject label must roughly fit its own band (`ERA_LABEL_OVERHANG`).
 *      Shrinking below the 0.72rem floor to make it fit is not an option — the
 *      floor is the ten-foot legibility law, and a label nobody can read is
 *      worse than no label.
 *   3. ...and it must not collide with a label already placed. Widest band
 *      first, so the eras with the most of the line to themselves win the ties.
 *
 * WHAT THE `subject` ROLE MEANS AFTER WAVE 10 has narrowed, and deliberately.
 * It still decides PLACEMENT — a subject is never dropped and never crowded —
 * but it no longer buys a step up in weight and colour, because the dateline
 * above now names the era outright. Two adjacent subjects rendered in full ink
 * six pixels apart were reading as one phrase; the fix is that the rule's names
 * are all one register and the heading carries the emphasis.
 *
 * @param {object} opts
 * @param {number} opts.widthPx  Measured width of the rule, in CSS px.
 * @param {number} opts.labelPx  The ten-foot label floor for THIS screen root.
 *   Defaults to the anchor's, which is what a timeline outside a frame gets.
 * @param {string[]} opts.subjects Era names the period lights up.
 * @returns {Array<{name, role, leftPct}>} placed labels, `leftPct` being the
 *          CENTRE of the label as a percentage of the rule's width.
 */
export function layoutEraLabels({
  widthPx = NOMINAL_WIDTH_PX, subjects = [], labelPx = ERA_LABEL_PX,
} = {}) {
  const labelWidth = (name) => eraLabelWidthPx(name, labelPx);
  const width = Number(widthPx) > 0 ? Number(widthPx) : NOMINAL_WIDTH_PX;
  // TWO GAPS, because one of them nudges and the other deletes — see the
  // constants. The relax pass gets the generous one; the drop test does not.
  const gap = labelPx * ERA_LABEL_GAP_EM;
  const clashGap = labelPx * ERA_LABEL_CLASH_EM;
  const isSubject = (name) => subjects.includes(name);
  const centreOf = (era) => ((era.from + era.to) / 2 - TIMELINE_SPAN.from) / SPAN * width;
  const bandOf = (era) => ((era.to - era.from) / SPAN) * width;

  const placed = [];
  const boxes = [];
  const clashes = (box) => boxes.some(
    (b) => box.x0 < b.x1 + clashGap && b.x0 - clashGap < box.x1,
  );
  const boxAt = (centre, w) => ({ x0: centre - w / 2, x1: centre + w / 2 });

  // 1. Subjects: placed, then RELAXED apart — never dropped, and never pushed
  //    off the end of the rule either.
  //
  //    A single forward nudge is not enough, and the failure is real rather
  //    than theoretical: at the 960x540 rail "CLASSICAL" and "ROMANTIC" both
  //    want the right-hand third of a 270px plate, and shoving the later one
  //    rightwards put half of "ROMANTIC" outside the plate, where the mat's
  //    `overflow: hidden` cut it. So the pass runs both ways — forward to
  //    separate, backward to put the group back inside the right edge, which
  //    moves the EARLIER label left instead. The eras are contiguous and the
  //    subject labels always fit end to end on any width the rail produces, so
  //    the two passes always converge.
  const spread = ERAS.filter((era) => isSubject(era.name)).map((era) => ({
    name: era.name,
    w: labelWidth(era.name),
    centre: Math.min(
      Math.max(centreOf(era), labelWidth(era.name) / 2),
      width - labelWidth(era.name) / 2,
    ),
  }));
  for (let i = 1; i < spread.length; i += 1) {
    const prev = spread[i - 1];
    const min = prev.centre + prev.w / 2 + gap + spread[i].w / 2;
    if (spread[i].centre < min) spread[i].centre = min;
  }
  for (let i = spread.length - 1; i >= 0; i -= 1) {
    const max = i === spread.length - 1
      ? width - spread[i].w / 2
      : spread[i + 1].centre - spread[i + 1].w / 2 - gap - spread[i].w / 2;
    if (spread[i].centre > max) spread[i].centre = max;
    if (spread[i].centre < spread[i].w / 2) spread[i].centre = spread[i].w / 2;
  }
  spread.forEach((s) => {
    boxes.push(boxAt(s.centre, s.w));
    placed.push({ name: s.name, role: 'subject', leftPct: (s.centre / width) * 100 });
  });

  // 2 + 3. The rest, biggest band first.
  ERAS.filter((era) => !isSubject(era.name))
    .sort((a, b) => (b.to - b.from) - (a.to - a.from))
    .forEach((era) => {
      const w = labelWidth(era.name);
      if (w > bandOf(era) * ERA_LABEL_OVERHANG) return;
      const centre = Math.min(Math.max(centreOf(era), w / 2), width - w / 2);
      const box = boxAt(centre, w);
      if (clashes(box)) return;
      boxes.push(box);
      placed.push({ name: era.name, role: 'era', leftPct: (centre / width) * 100 });
    });

  // Back into reading order — the DOM a screen reader walks should run left to
  // right, whatever order the placement algorithm settled them in.
  return placed.sort((a, b) => a.leftPct - b.leftPct);
}

export default function EraTimeline({
  period = null,
  year = null,
  note = null,
  className = '',
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'era-timeline'), [logger]);
  const ruleRef = useRef(null);
  // The ten-foot label floor for the screen root this slide is painted on. The
  // stylesheet reads the same number as a custom property; the placement below
  // has to know it in JS, because it decides which era names survive.
  const labelPx = useLabelFloorPx(ruleRef);
  // Seeded, not zero: happy-dom measures every box as 0x0 and a real browser
  // has not measured anything on the first paint either. The nominal width is
  // the rail's own, so the first painted frame is already close to right and
  // the observer below only ever corrects it.
  const [widthPx, setWidthPx] = useState(NOMINAL_WIDTH_PX);

  useEffect(() => {
    const el = ruleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const w = el.getBoundingClientRect?.().width ?? 0;
      if (w > 0) setWidthPx((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const subjects = useMemo(() => subjectErasFor(period), [period]);
  const labels = useMemo(
    () => layoutEraLabels({ widthPx, subjects, labelPx }), [widthPx, subjects, labelPx],
  );
  const markerFrac = useMemo(() => fractionFor(year), [year]);
  const dateline = useMemo(() => datelineFor(period, subjects), [period, subjects]);
  const anchor = yearAnchorFor(markerFrac);

  useEffect(() => {
    if (!period) return;
    if (subjects.length) return;
    // The event an author needs: a period the era table has never heard of, so
    // the slide draws a timeline with nothing lit on it.
    log.warn('surround.era.period-unmatched', { period });
  }, [period, subjects.length, log]);

  if (!period) return null;

  // The plumb's three parts all sit at the SAME `left`, and they are siblings of
  // the measured rule at the same width, so one number places all three. It is
  // written once here rather than three times below.
  const plumbAt = markerFrac === null ? null : `${markerFrac * 100}%`;

  return (
    <div
      className={`surround-era-timeline ${className}`.trim()}
      data-testid="surround-era-timeline"
      data-subjects={subjects.join(',')}
    >
      <div className="surround-era-timeline__scale">
        {dateline && (
          <p className="surround-era-timeline__dateline" data-testid="surround-era-dateline">
            {/* The author's own phrase, curled at the render seam like every
                other authored string the frame prints. */}
            <span className="surround-era-timeline__dateline-era">{smartQuotes(dateline.era)}</span>
            {dateline.span && (
              <>
                <span className="surround-era-timeline__dateline-sep" aria-hidden="true">·</span>
                <span className="surround-era-timeline__dateline-span">{dateline.span}</span>
              </>
            )}
          </p>
        )}

        {/* THE PLUMB, hung from the top. The year is the plate's one display-
            sized mark and the only brass one; the thread below it is the same
            brass at a lower value, so the two read as one object descending to
            the rule rather than as an accent used twice. */}
        <div className="surround-era-timeline__year-row">
          {plumbAt !== null && (
            <span
              className="surround-era-timeline__year"
              data-testid="surround-era-year"
              data-anchor={anchor}
              style={{ left: plumbAt }}
            >
              {year}
            </span>
          )}
        </div>

        <div className="surround-era-timeline__plumb-row" aria-hidden="true">
          {plumbAt !== null && (
            <span
              className="surround-era-timeline__plumb"
              data-testid="surround-era-plumb"
              style={{ left: plumbAt }}
            />
          )}
        </div>

        <div className="surround-era-timeline__rule" ref={ruleRef}>
          {ERAS.map((era, i) => {
            const subject = subjects.includes(era.name);
            return (
              <span
                key={era.name}
                className={`surround-era-timeline__band${subject ? ' surround-era-timeline__band--subject' : ''}`}
                data-testid="surround-era-band"
                data-era={era.name}
                data-subject={subject ? 'true' : 'false'}
                style={{
                  left: `${((era.from - TIMELINE_SPAN.from) / SPAN) * 100}%`,
                  width: `${((era.to - era.from) / SPAN) * 100}%`,
                }}
              >
                {/* One restrained barline at each join — the segment map's
                    grammar, at the scale of centuries instead of minutes. It
                    straddles the rule; the marker does not. That asymmetry is
                    the whole of the two marks being told apart. */}
                {i > 0 && <span className="surround-era-timeline__join" aria-hidden="true" />}
              </span>
            );
          })}
          {plumbAt !== null && (
            <span
              className="surround-era-timeline__marker"
              data-testid="surround-era-marker"
              style={{ left: plumbAt }}
              aria-hidden="true"
            />
          )}
        </div>

        {/* THE EXTENT, written. Without these two numerals the rule is a bar of
            unknown length and the marker on it cannot be placed by anyone who
            does not already know the dates — which is the viewer this slide
            exists for. They are `aria-hidden` because a screen reader gets the
            era names and the year as text and does not need the axis. */}
        <div className="surround-era-timeline__extent" aria-hidden="true">
          <span className="surround-era-timeline__extent-year">{TIMELINE_SPAN.from}</span>
          <span className="surround-era-timeline__extent-year">{TIMELINE_SPAN.to}</span>
        </div>

        <div className="surround-era-timeline__labels">
          {labels.map((l) => (
            <span
              key={l.name}
              className={`surround-era-timeline__label surround-era-timeline__label--${l.role}`}
              data-testid="surround-era-label"
              data-era={l.name}
              data-role={l.role}
              style={{ left: `${l.leftPct}%` }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {note && (
        <p className="surround-era-timeline__note" data-testid="surround-era-note">
          {/* The frame's one curl, at this plate's own render seam — see
              `../typography.js`. A period note is editorial prose and carries
              the possessives and quoted phrases prose carries. */}
          <span className="surround-era-timeline__note-line">{smartQuotes(note)}</span>
        </p>
      )}
    </div>
  );
}

EraTimeline.propTypes = {
  period: PropTypes.string,
  year: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  note: PropTypes.string,
  className: PropTypes.string,
  logger: PropTypes.object,
};
