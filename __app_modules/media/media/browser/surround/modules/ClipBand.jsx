// The band under a clip: one piece cut from a whole concert. Three zones —
// where the piece comes from (the concert, its year, and which of its pieces
// this is), how far into the piece we are (its own clock, not the concert's),
// and what plays next. Everything comes off the payload: the window and the
// queue arrive as `data.clip` (see the playback capability's clipContext.js).
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

export default function ClipBand({ data = null, position = 0 }) {
  const clip = data?.clip;
  const segment = clip?.segment;
  if (!segment || !isFiniteNumber(segment.start) || !isFiniteNumber(segment.end) || segment.end <= segment.start) {
    return null;
  }

  const piece = data.piece ?? {};
  const title = smartQuotes(trimmed(piece.title));
  const length = segment.end - segment.start;
  const at = isFiniteNumber(position) ? position : segment.start;
  const elapsed = clamp(at - segment.start, 0, length);
  const remaining = clamp(segment.end - at, 0, length);
  const number = clipNumber(data.segments, segment.start);
  const next = clip.next;
  const nextTitle = next ? smartQuotes(trimmed(next.title)) : null;
  const nextSubtitle = next ? smartQuotes(trimmed(next.subtitle)) : null;

  return (
    <section className="clip-band">
      <div className="clip-band__from">
        {title && <div className="clip-band__title">{title}</div>}
        <div className="clip-band__meta">
          {piece.year && <span className="clip-band__year">{String(piece.year)}</span>}
          {number && <span className="clip-band__number">{`No. ${number.k} of ${number.n}`}</span>}
        </div>
        {number && (
          <ol className="clip-band__ticks" aria-hidden="true">
            {Array.from({ length: number.n }, (_, i) => (
              <li
                key={i}
                className={`clip-band__tick${i + 1 === number.k ? ' clip-band__tick--lit' : ''}`}
              />
            ))}
          </ol>
        )}
      </div>

      <div className="clip-band__progress">
        <span className="clip-band__elapsed">{formatClock(elapsed)}</span>
        <div className="clip-band__bar">
          <div className="clip-band__fill" style={{ width: `${(elapsed / length) * 100}%` }} />
        </div>
        <span className="clip-band__remaining">{`-${formatClock(remaining)}`}</span>
      </div>

      {nextTitle && (
        <div className="clip-band__next">
          <div className="clip-band__next-label">Up next</div>
          <div className="clip-band__next-title">{nextTitle}</div>
          {nextSubtitle && <div className="clip-band__next-subtitle">{nextSubtitle}</div>}
        </div>
      )}
    </section>
  );
}

ClipBand.propTypes = {
  data: PropTypes.object,
  position: PropTypes.number,
};
