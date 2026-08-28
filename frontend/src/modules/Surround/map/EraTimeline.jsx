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
import { useLabelFloorPx } from '../useLabelFloor.js';
import {
  TIMELINE_SPAN, ERAS, NOMINAL_WIDTH_PX,
  fractionFor, subjectErasFor, datelineFor, yearAnchorFor, layoutEraLabels,
} from './eraTimelineModel.js';
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
                  left: `${((era.from - TIMELINE_SPAN.from) / (TIMELINE_SPAN.to - TIMELINE_SPAN.from)) * 100}%`,
                  width: `${((era.to - era.from) / (TIMELINE_SPAN.to - TIMELINE_SPAN.from)) * 100}%`,
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
