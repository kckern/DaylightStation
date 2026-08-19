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
// WHAT IS DRAWN
//   * one hairline spanning `TIMELINE_SPAN` (1550-1910), divided into the four
//     era bands of `ERAS`, quiet barlines between them;
//   * the SUBJECT band(s) brightened — the era(s) the piece's own period names.
//     A period naming two ("Classical to Romantic") lights both, because that
//     is what the phrase means: the work sits across the join;
//   * a brass marker at the piece's year, the one thing on the drawing the
//     programme actually asserts;
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
import getLogger from '../../../lib/logging/Logger.js';
import './EraTimeline.scss';

/**
 * The extent the hairline spans. Deliberately a little wider than the eras it
 * carries at BOTH ends: a marker that lands on the very first or very last
 * pixel of the rule reads as "off the edge" rather than as "early Baroque".
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
 * and the drawing, the label fitting and the subject matching all follow.
 */
export const ERAS = Object.freeze([
  Object.freeze({ name: 'Renaissance', from: 1550, to: 1600 }),
  Object.freeze({ name: 'Baroque', from: 1600, to: 1750 }),
  Object.freeze({ name: 'Classical', from: 1750, to: 1820 }),
  Object.freeze({ name: 'Romantic', from: 1820, to: 1910 }),
]);

/** Design floor: nothing below 0.72rem, read at ten feet. Same law as the map. */
export const ERA_LABEL_PX = 0.72 * 16;
/**
 * Average advance per character for the tracked uppercase display face, in ems
 * of the label's own size, and the tracking added to it. Used only to give a
 * label an approximate WIDTH so the fitting below can be decided without a DOM
 * text measurement per label per resize.
 *
 * Lower than `CountryMap`'s 0.78 because that estimate is deliberately generous
 * in the direction that costs a NEIGHBOUR its name, and here the same generosity
 * would silently delete era labels the design wants. The tracking is added
 * separately so a change to the stylesheet's `letter-spacing` has one obvious
 * place to be mirrored.
 */
export const ERA_LABEL_EM_PER_CHAR = 0.62;
export const ERA_LABEL_TRACKING_EM = 0.12;
/**
 * How far past its own band a label may reach before it stops pointing at
 * anything. The eras are contiguous, so a little overhang is honest — the
 * neighbouring label's collision test is the real guard — but a "RENAISSANCE"
 * three times the width of the fifty years it names is a caption for the wrong
 * part of the line. This is what makes the shortest band's label appear on a
 * 1080p rail and drop on a 540p one, which is the adaptive behaviour the design
 * asks for rather than a label that is simply always absent.
 */
export const ERA_LABEL_OVERHANG = 1.6;
/** Breathing room between two placed labels, in px. */
export const ERA_LABEL_GAP_PX = 6;
/**
 * The width assumed before the element has been measured (and in jsdom, where
 * every box is 0x0). The rail's plate is ~420px on the kiosk this was designed
 * against — the same estimate `CountryMap.RENDER_W` is built on, for the same
 * box.
 */
export const NOMINAL_WIDTH_PX = 420;

let moduleLogger = null;
function fallbackLogger() {
  if (!moduleLogger) moduleLogger = getLogger().child({ app: 'surround', component: 'era-timeline' });
  return moduleLogger;
}
function resolveLogger(logger) {
  if (!logger) return fallbackLogger();
  return logger.child?.({ app: 'surround', component: 'era-timeline' }) ?? logger;
}

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
 * Substring matching, case-insensitively, because the authored period is a
 * human phrase rather than an enum: "Baroque", "Classical", "Classical to
 * Romantic", "Late Romantic" all have to resolve, and a phrase naming two eras
 * genuinely means both — the work sits across the join, which is exactly what a
 * timeline can show and a single label cannot.
 *
 * Returns era NAMES, in `ERAS` order, so two callers cannot disagree about
 * which of two matched eras is "first".
 */
export function subjectErasFor(period) {
  const text = String(period ?? '').toLowerCase();
  if (!text.trim()) return [];
  return ERAS.filter((era) => text.includes(era.name.toLowerCase())).map((era) => era.name);
}

/** A label's estimated width in px at the floor size. */
export function eraLabelWidthPx(name) {
  return String(name).length * (ERA_LABEL_EM_PER_CHAR + ERA_LABEL_TRACKING_EM) * ERA_LABEL_PX;
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
 * @param {object} opts
 * @param {number} opts.widthPx  Measured width of the rule, in CSS px.
 * @param {string[]} opts.subjects Era names the period lights up.
 * @returns {Array<{name, role, leftPct}>} placed labels, `leftPct` being the
 *          CENTRE of the label as a percentage of the rule's width.
 */
export function layoutEraLabels({ widthPx = NOMINAL_WIDTH_PX, subjects = [] } = {}) {
  const width = Number(widthPx) > 0 ? Number(widthPx) : NOMINAL_WIDTH_PX;
  const isSubject = (name) => subjects.includes(name);
  const centreOf = (era) => ((era.from + era.to) / 2 - TIMELINE_SPAN.from) / SPAN * width;
  const bandOf = (era) => ((era.to - era.from) / SPAN) * width;

  const placed = [];
  const boxes = [];
  const clashes = (box) => boxes.some(
    (b) => box.x0 < b.x1 + ERA_LABEL_GAP_PX && b.x0 - ERA_LABEL_GAP_PX < box.x1,
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
    w: eraLabelWidthPx(era.name),
    centre: Math.min(
      Math.max(centreOf(era), eraLabelWidthPx(era.name) / 2),
      width - eraLabelWidthPx(era.name) / 2,
    ),
  }));
  for (let i = 1; i < spread.length; i += 1) {
    const prev = spread[i - 1];
    const min = prev.centre + prev.w / 2 + ERA_LABEL_GAP_PX + spread[i].w / 2;
    if (spread[i].centre < min) spread[i].centre = min;
  }
  for (let i = spread.length - 1; i >= 0; i -= 1) {
    const max = i === spread.length - 1
      ? width - spread[i].w / 2
      : spread[i + 1].centre - spread[i + 1].w / 2 - ERA_LABEL_GAP_PX - spread[i].w / 2;
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
      const w = eraLabelWidthPx(era.name);
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
  const log = useMemo(() => resolveLogger(logger), [logger]);
  const ruleRef = useRef(null);
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
    () => layoutEraLabels({ widthPx, subjects }), [widthPx, subjects],
  );
  const markerFrac = useMemo(() => fractionFor(year), [year]);

  useEffect(() => {
    if (!period) return;
    if (subjects.length) return;
    // The event an author needs: a period the era table has never heard of, so
    // the slide draws a timeline with nothing lit on it.
    log.warn('surround.era.period-unmatched', { period });
  }, [period, subjects.length, log]);

  if (!period) return null;

  return (
    <div
      className={`surround-era-timeline ${className}`.trim()}
      data-testid="surround-era-timeline"
      data-subjects={subjects.join(',')}
    >
      <div className="surround-era-timeline__scale">
        {/* The marker's year rides ABOVE the rule and the era names below it,
            so the one thing the programme asserts never has to compete with a
            label for the same row. */}
        <div className="surround-era-timeline__marker-row">
          {markerFrac !== null && (
            <span
              className="surround-era-timeline__year"
              data-testid="surround-era-year"
              style={{ left: `${markerFrac * 100}%` }}
            >
              {year}
            </span>
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
                {/* One quiet barline at each join — the movement map's grammar,
                    at the scale of centuries instead of minutes. */}
                {i > 0 && <span className="surround-era-timeline__join" aria-hidden="true" />}
              </span>
            );
          })}
          {markerFrac !== null && (
            <span
              className="surround-era-timeline__marker"
              data-testid="surround-era-marker"
              style={{ left: `${markerFrac * 100}%` }}
              aria-hidden="true"
            />
          )}
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
          <span className="surround-era-timeline__note-line">{note}</span>
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
