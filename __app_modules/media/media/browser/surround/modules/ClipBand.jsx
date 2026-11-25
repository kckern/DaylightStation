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
import React from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, trimmed } from "../../../../../../__capabilities/playback/browser/surround-typography.mjs";
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

export default function ClipBand({ data = null, position = 0 }) {
  const clip = data?.clip;
  const segment = clip?.segment;
  if (!segment || !isFiniteNumber(segment.start) || !isFiniteNumber(segment.end) || segment.end <= segment.start) {
    return null;
  }

  const title = smartQuotes(trimmed(clip.title));
  const length = segment.end - segment.start;
  const at = isFiniteNumber(position) ? position : segment.start;
  const elapsed = clamp(at - segment.start, 0, length);
  const remaining = clamp(segment.end - at, 0, length);
  const number = clipNumber(data.segments, segment.start);
  const next = clip.next;
  const nextTitle = next ? smartQuotes(trimmed(next.title)) : null;
  // Another concert only when both ends know their concert and they differ: an
  // unknown is read as "same", which keeps the band quiet rather than wrong.
  const elsewhere = Boolean(next?.work && clip.work && next.work !== clip.work);
  const nextWork = elsewhere ? smartQuotes(nextWorkLabel(next)) : null;

  return (
    <section className="clip-band">
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
        <div className="clip-band__heading">
          {title && <div className="clip-band__title">{title}</div>}
          <div className="clip-band__progress">
            <span className="clip-band__elapsed">{formatClock(elapsed)}</span>
            <div className="clip-band__bar">
              <div className="clip-band__fill" style={{ width: `${(elapsed / length) * 100}%` }} />
            </div>
            <span className="clip-band__remaining">{`-${formatClock(remaining)}`}</span>
          </div>
        </div>
      </div>

      {nextTitle && (
        <div className={`clip-band__next${elsewhere ? ' clip-band__next--elsewhere' : ''}`}>
          {elsewhere && (
            <img className="clip-band__next-poster" src={`/api/v1/display/${next.work}`}
              alt=""
              // A poster that will not load leaves the words, not a broken box.
              onError={(e) => { e.currentTarget.hidden = true; }}
            />
          )}
          <div className="clip-band__next-text">
            <div className="clip-band__next-label">{elsewhere ? 'Next, from' : 'Up next'}</div>
            {nextWork && <div className="clip-band__next-work">{nextWork}</div>}
            <div className="clip-band__next-title">{nextTitle}</div>
          </div>
        </div>
      )}
    </section>
  );
}

ClipBand.propTypes = {
  data: PropTypes.object,
  position: PropTypes.number,
};
