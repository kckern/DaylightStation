import WinTally from './WinTally.jsx';
import './gameChrome.scss';

/**
 * Who you are playing, how far up you are, and how close the next rung is.
 *
 * The three games each spelled this out in text — "Level 3 of 7", "1 / 3 wins",
 * one line each — which answers at reading distance, and the player is a child
 * across a room with their hands on the keys. So the rungs are drawn AS a ladder
 * and the wins AS a tally: the shapes carry what the sentences did, and the
 * sentences stay on as the accessible name rather than as the primary read.
 *
 * `portrait` is a slot rather than a hard dependency — Chess has character art
 * and a roster to open, Checkers and Connect Four have a name and nothing else,
 * and neither arrangement should have to reimplement the ladder to get it.
 *
 * `level` is 1-based: level 1 is the first rung, level `levels` is the top.
 */
export default function LadderBadge({
  name,
  level = null,
  levels = null,
  wins = null,
  needed = null,
  portrait = null,
  className = '',
}) {
  const rungCount = Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 0;
  const here = Number.isFinite(level) ? Math.floor(level) : 0;
  const winCount = Number.isFinite(needed) && needed > 0 ? Math.floor(needed) : 0;
  const won = Number.isFinite(wins) ? wins : 0;

  return (
    <div className={`pg-ladder ${className}`.trim()}>
      {portrait}
      <span className="pg-ladder__name">{name}</span>

      {rungCount > 0 && (
        <>
          <div
            className="pg-ladder__rungs"
            role="img"
            aria-label={`Level ${here} of ${rungCount}`}
          >
            {Array.from({ length: rungCount }, (_, index) => {
              const rung = index + 1;
              const state = rung === here ? 'here' : rung < here ? 'climbed' : null;
              return (
                <span
                  key={rung}
                  className={`pg-ladder__rung${state ? ` pg-ladder__rung--${state}` : ''}`}
                />
              );
            })}
          </div>
          <span className="pg-ladder__line" aria-hidden="true">
            Level {here} of {rungCount}
          </span>
        </>
      )}

      {/* The pips ARE the count, so a number beside them would be the same fact
          twice; the accessible name carries it for anyone not reading shapes. */}
      <WinTally label="to the next" wins={won} needed={winCount} />
    </div>
  );
}
