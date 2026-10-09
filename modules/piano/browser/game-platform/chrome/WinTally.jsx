import './gameChrome.scss';

/**
 * How close you are to the next opponent, drawn rather than spelled.
 *
 * "1 of 3" is a sentence a child has to stop and read; three circles, one
 * filled, is a glance. All three games ask the same question of their ladder, so
 * they ask it the same way — Chess printed it as unstyled text in a class that
 * had no rules at all, and the other two printed it as "0 / 3 wins".
 */
export default function WinTally({ label = null, wins = 0, needed = 0, className = '' }) {
  const total = Number.isFinite(needed) && needed > 0 ? Math.floor(needed) : 0;
  // Clamped: a stale ladder read can outrun what the rung actually needs, and a
  // tally that overflows its own track says nothing true.
  const won = Math.min(total, Math.max(0, Math.floor(Number(wins) || 0)));
  if (!total) return null;

  return (
    <div className={`pg-ladder__line ${className}`.trim()}>
      <span
        className="pg-ladder__pips"
        role="img"
        aria-label={`${won} of ${total} wins${label ? ` ${label}` : ''}`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={`pg-ladder__pip${index < won ? ' pg-ladder__pip--won' : ''}`} />
        ))}
      </span>
      {label && <span aria-hidden="true">{label}</span>}
    </div>
  );
}
