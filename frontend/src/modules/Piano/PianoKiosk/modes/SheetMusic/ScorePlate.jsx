import { useMemo } from 'react';
import { plateFor } from './scorePlate.js';

/**
 * ScorePlate — cover art for a score with no scanned poster.
 *
 * An engraver's plate: letterpress eyebrow (composer), a seeded guilloche
 * rosette, and a plate number under it. Replaces the old fallback, which set
 * the whole title in bold on a cream rectangle and gave a grid of 39 études
 * nothing to tell them apart by.
 *
 * Pure presentation — all geometry comes from scorePlate.js.
 */
export function ScorePlate({ title, className = '' }) {
  const plate = useMemo(() => plateFor(title), [title]);
  const { composer, opus, number, name, movement, ink, rosette: art } = plate;

  const stamp = [
    opus != null ? `Op. ${opus}` : null,
    number != null ? `№ ${number}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <span
      className={`score-plate ${className}`.trim()}
      style={{ '--plate-ink': ink.ink, '--plate-deep': ink.deep }}
      data-plate-seed={plate.seed}
    >
      {composer && <span className="score-plate__eyebrow">{composer}</span>}

      <svg className="score-plate__rosette" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {art.rings.map((r) => (
          <circle key={`ring-${r}`} className="score-plate__ring" cx="50" cy="50" r={r} />
        ))}
        {art.petals.map((d) => (
          <path key={`petal-${d}`} className="score-plate__petal" d={d} />
        ))}
        {art.star.map((d) => (
          <path key={`star-${d}`} className="score-plate__star" d={d} />
        ))}
        <circle className="score-plate__centre" cx="50" cy="50" r={art.centre} />
      </svg>

      <span className="score-plate__foot">
        {stamp && <span className="score-plate__stamp">{stamp}</span>}
        <span className="score-plate__name">{name}</span>
        {movement && <span className="score-plate__movement">{movement}</span>}
      </span>
    </span>
  );
}

export default ScorePlate;
