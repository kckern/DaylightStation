// The band under a clip: one piece cut from a whole concert. Three zones —
// the piece NOW playing (its own name, the loudest type in the band, beside a
// small grid of the concert's pieces with this one lit), how far into it we
// are (its own clock, not the concert's), and what plays next. The concert
// itself is NOT named here: the placard and the poster rail already carry it.
//
// Up next is partitioned when the next clip comes from ANOTHER concert — that
// concert's poster and "Next, from <concert> (<year>)" behind a rule — so it
// never reads as the next track of this one. From the same concert it is just
// the name. Everything comes off the payload: the window, the clip's own name
// and the queue arrive as `data.clip` (see the playback capability's
// clipContext.js).
//
// THE TYPE IS MEASURED (`clipBandFit.js`). The band's height is fixed and a
// piece's name can be a two-song medley, so the title steps down from its
// stylesheet size until the zone sets inside the band in at most two lines, and
// Up next steps down until it does too. Nothing pours over the picture or
// pushes the progress bar out of the band.
//
// UP NEXT IS A BUTTON on screens with a mouse or touch: it asks the host for
// the queue move to that clip (`surround-advance`, with the step past any break
// between), which goes through the change curtain like every other move. It
// takes no focus (`tabIndex -1`): the kiosk's remote keys stay the Player's.
import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, trimmed } from "../../../../../../__capabilities/playback/browser/surround-typography.mjs";
import { surroundLogger } from "../../../../../../__capabilities/playback/browser/surround-module-kit.mjs";
import { fitClipBand } from "./clipBandFit.js";
import "./ClipBand.scss";

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Seconds as m:ss; anything unusable reads as 0:00. */
export function formatClock(seconds) {
  const s = isFiniteNumber(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Which of the concert's pieces this clip is: `k` of `n`, counting every rail
 * segment but introductions (a spoken lead-in is not a piece). The clip is the
 * piece whose start is nearest its own, which holds whether the clip's window
 * was cut from the same spans as the rail or trimmed slightly differently.
 * @returns {{ k: number, n: number }|null}
 */
export function clipNumber(segments, clipStart) {
  const pieces = (Array.isArray(segments) ? segments : [])
    .filter((s) => s && s.kind !== 'introduction' && isFiniteNumber(s.start));
  if (!pieces.length || !isFiniteNumber(clipStart)) return null;
  let best = 0;
  pieces.forEach((s, i) => {
    if (Math.abs(s.start - clipStart) < Math.abs(pieces[best].start - clipStart)) best = i;
  });
  return { k: best + 1, n: pieces.length };
}

/** The other concert's name for the partition: its own piece, else the queue's subtitle. */
function nextWorkLabel(next) {
  const title = trimmed(next?.workTitle);
  if (title) return next.workYear ? `${title} (${next.workYear})` : title;
  return trimmed(next?.subtitle) || null;
}

/** The piece grid's shape: as near a square as n allows (ceil(sqrt n) columns). */
export function gridShape(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}
/** The grid's height budget: cells shrink for a big concert so it always fits the band. */
const GRID_HEIGHT_REM = 3.2;

const validWindow = (segment) => Boolean(segment)
  && isFiniteNumber(segment.start) && isFiniteNumber(segment.end) && segment.end > segment.start;

/**
 * Fit the band's two text zones to the room under the picture. Mutates the elements' font
 * sizes directly (React sets none on them) and re-runs when the words change,
 * the band resizes, or the faces land.
 */
function useBandFit({ bandRef, titleRef, headingRef, nextTextRef, deps, log }) {
  const [tick, setTick] = useState(0);
  const lastReport = useRef('');

  useEffect(() => {
    const band = bandRef.current;
    if (!band || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      if (typeof requestAnimationFrame !== 'function') { setTick((n) => n + 1); return; }
      frame = requestAnimationFrame(() => { frame = 0; setTick((n) => n + 1); });
    });
    observer.observe(band);
    // The footer is the budget (`bandInnerHeight`), and it moves without the
    // band moving: a 4:3 picture or a collapse re-lays the column.
    const footer = band.closest?.('.surround-frame__footer');
    if (footer) observer.observe(footer);
    return () => {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bandRef]);

  // The display face is much wider than the fallback serif; a size measured
  // before it lands is measured against the wrong metrics.
  useEffect(() => {
    let live = true;
    document?.fonts?.ready?.then?.(() => { if (live) setTick((n) => n + 1); });
    return () => { live = false; };
  }, []);

  useLayoutEffect(() => {
    const report = fitClipBand({
      band: bandRef.current,
      title: titleRef.current,
      heading: headingRef.current,
      nextText: nextTextRef.current,
    });
    if (!report) return;
    const key = JSON.stringify(report);
    if (key === lastReport.current) return;
    lastReport.current = key;
    if (report.titleFits === false || report.nextFits === false) {
      log.warn('surround.clip-band.unfittable', report);
    } else {
      log.debug('surround.clip-band.fit', report);
    }
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function ClipBand({ data = null, position = 0, logger = null }) {
  const log = useMemo(() => surroundLogger(logger, 'clip-band'), [logger]);
  const bandRef = useRef(null);
  const titleRef = useRef(null);
  const headingRef = useRef(null);
  const nextTextRef = useRef(null);

  const clip = data?.clip;
  const segment = clip?.segment;
  const valid = validWindow(segment);
  const title = valid ? smartQuotes(trimmed(clip.title)) : null;
  const next = valid ? clip.next : null;
  const nextTitle = next ? smartQuotes(trimmed(next.title)) : null;
  // Another concert only when both ends know their concert and they differ: an
  // unknown is read as "same", which keeps the band quiet rather than wrong.
  const elsewhere = Boolean(next?.work && clip?.work && next.work !== clip.work);
  const nextWork = elsewhere ? smartQuotes(nextWorkLabel(next)) : null;
  const step = Number.isInteger(next?.step) && next.step > 0 ? next.step : null;

  useBandFit({
    bandRef, titleRef, headingRef, nextTextRef, log, deps: [title, nextTitle, nextWork, elsewhere],
  });

  const goNext = useCallback(() => {
    if (!step) return;
    log.info('surround.clip-band.next-click', { step, work: next?.work ?? null, title: nextTitle });
    bandRef.current?.dispatchEvent(new CustomEvent('surround-advance', {
      bubbles: true,
      detail: { step, source: 'clip-band' },
    }));
  }, [step, next, nextTitle, log]);

  if (!valid) return null;

  const length = segment.end - segment.start;
  const at = isFiniteNumber(position) ? position : segment.start;
  const elapsed = clamp(at - segment.start, 0, length);
  const remaining = clamp(segment.end - at, 0, length);
  const number = clipNumber(data.segments, segment.start);

  return (
    <section className="clip-band" ref={bandRef}>
      <div className="clip-band__now">
        {number && (
          <ol
            className="clip-band__grid"
            aria-label={`Piece ${number.k} of ${number.n}`}
            style={(() => {
              const { cols, rows } = gridShape(number.n);
              return {
                gridTemplateColumns: `repeat(${cols}, var(--clip-cell))`,
                '--clip-cell': `min(0.55rem, calc(${GRID_HEIGHT_REM}rem / ${rows} - 3px))`,
              };
            })()}
          >
            {Array.from({ length: number.n }, (_, i) => (
              <li
                key={i}
                className={`clip-band__cell${i + 1 === number.k ? ' clip-band__cell--now' : ''}`}
              />
            ))}
          </ol>
        )}
        <div className="clip-band__heading" ref={headingRef}>
          {title && <div className="clip-band__title" ref={titleRef}>{title}</div>}
          <div className="clip-band__progress">
            <span className="clip-band__elapsed">{formatClock(elapsed)}</span>
            <div className="clip-band__bar">
              <div className="clip-band__fill" style={{ width: `${(elapsed / length) * 100}%` }} />
            </div>
            <span className="clip-band__remaining">{`-${formatClock(remaining)}`}</span>
          </div>
        </div>
      </div>

      {nextTitle && (() => {
        const Tag = step ? 'button' : 'div';
        const props = step
          ? {
            type: 'button',
            tabIndex: -1,
            onClick: goNext,
            'aria-label': `Play next: ${nextTitle}`,
          }
          : {};
        return (
          <Tag
            className={`clip-band__next${elsewhere ? ' clip-band__next--elsewhere' : ''}${step ? ' clip-band__next--action' : ''}`}
            {...props}
          >
            {elsewhere && (
              <img className="clip-band__next-poster" src={`/api/v1/display/${next.work}`}
                alt=""
                // A poster that will not load leaves the words, not a broken box.
                onError={(e) => { e.currentTarget.hidden = true; }}
              />
            )}
            <div className="clip-band__next-text" ref={nextTextRef}>
              <div className="clip-band__next-label">{elsewhere ? 'Next, from' : 'Up next'}</div>
              {nextWork && <div className="clip-band__next-work">{nextWork}</div>}
              <div className="clip-band__next-title">{nextTitle}</div>
            </div>
          </Tag>
        );
      })()}
    </section>
  );
}

ClipBand.propTypes = {
  data: PropTypes.object,
  position: PropTypes.number,
  logger: PropTypes.object,
};
