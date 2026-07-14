/**
 * CountInOverlay — the large centered beat number shown over the score while a
 * count-in is running (before a Polish/play-along run starts). Renders nothing
 * when inactive. Any tap on the score cancels the count-in (handled in the
 * player's onScoreClick), so this layer is non-interactive.
 *
 * @param {object} p
 * @param {boolean} p.active
 * @param {number}  p.beat - current 1-based beat
 */
export default function CountInOverlay({ active, beat }) {
  if (!active) return null;
  return (
    <div className="piano-score-countin" aria-live="polite" aria-label={`Count in, beat ${beat}`}>
      {/* key on the beat remounts the span each tick so the pop animation re-fires */}
      <span key={beat} className="piano-score-countin__beat">{beat}</span>
    </div>
  );
}
