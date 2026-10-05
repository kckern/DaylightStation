/**
 * Countdown and PLAY are projections supplied by the owning transport. This
 * non-interactive presentation has no clock. `beat` keeps existing ScorePlayer
 * callers working until they migrate to the countdown API.
 */
export default function CountInOverlay({ active, remaining, progress, play = false, beat }) {
  if (!active) return null;
  const numeral = remaining ?? beat;
  const announcement = play ? 'PLAY' : `Starting in ${numeral}`;
  return (
    <div className={`piano-score-countin${play ? ' is-play' : ''}`} aria-live="polite" aria-atomic="true"
      aria-label={announcement} style={progress == null ? undefined : { '--countdown-progress': progress }}>
      <span className="piano-score-countin__announcement">{announcement}</span>
      <span key={play ? 'play' : numeral} className="piano-score-countin__beat" aria-hidden="true">{play ? 'PLAY' : numeral}</span>
      {progress != null && !play && <span className="piano-score-countin__bar" aria-hidden="true" />}
    </div>
  );
}
