import PropTypes from 'prop-types';
import './pips.scss';

/**
 * The day's reading obligation, as something you can COUNT rather than read.
 *
 * "1 of 2 stories" is a sentence, and the child it is aimed at cannot read a
 * sentence. One pip per story owed, filled as each is finished, says the same
 * thing in the one notation a four-year-old already has — and says it from
 * across a room, which the text never did either.
 *
 * ONE COMPONENT, THREE ACTS. This is deliberately shared rather than
 * reimplemented: the same pips appear on the shelf while choosing, in the
 * surround rail while the story plays, and filling at the close. That is what
 * makes those three screens read as one ceremony instead of three designs, so
 * they must be the same object and not two that merely look alike.
 *
 * It carries no colours of its own — `pips.scss` reads `--pip-ink` and
 * `--pip-size` from whatever host it is dropped into, so the rail's oxblood
 * ground and the shelf's charcoal one each get pips that belong to them.
 *
 * The label survives as the accessible name, so a screen reader and a passing
 * adult still get the words; it is simply no longer the thing on screen.
 *
 * WHILE A STORY PLAYS, one pip is LIVE — the one this story will fill. It
 * pulses, and where the position is known it fills clockwise as the story runs.
 * That is where the reading session's progress lives now: the surround frame
 * suppresses the Player's own progress bar, and a bar across the top said
 * "how far through this file" where the pips already say "how far through
 * today". One place, one notation.
 *
 * Falls back to the plain label whenever the numbers cannot carry it: an
 * unreadable obligation (`target` null), or a target so large that pips would
 * become a smear of dots nobody can count at a glance.
 */

/** Past this many, counting dots is slower than reading the sentence. */
export const MAX_PIPS = 8;

export default function ReadingPips({
  count, target, label, className = '', testId = 'reading-count',
  live = false, progress = null,
}) {
  const owed = Number.isFinite(target) ? target : null;
  const done = Number.isFinite(count) ? count : 0;

  if (owed === null || owed < 1 || owed > MAX_PIPS) {
    return label
      ? <p className={`reading-pips-label ${className}`.trim()} data-testid={testId}>{label}</p>
      : null;
  }

  // THE ONE BEING READ RIGHT NOW is the first pip not yet filled — which is
  // where the story in progress will land when it finishes. It is drawn as a
  // ring that fills clockwise, so the pips answer BOTH questions a child has:
  // how many books are left (count them) and how far through this one we are
  // (watch it close). Only ever one, and only while something is playing.
  const activeIndex = live && done < owed ? done : -1;
  const fraction = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null;

  return (
    <div
      className={`reading-pips ${className}`.trim()}
      data-testid={testId}
      role="img"
      aria-label={label || `${done} of ${owed} stories`}
    >
      {Array.from({ length: owed }, (_, i) => {
        if (i === activeIndex) {
          return (
            <span
              key={i}
              className="reading-pip reading-pip--live"
              data-testid="reading-pip-live"
              // A conic gradient rather than an SVG ring: one element, no
              // viewBox to keep in sync with `--pip-size`, and the browser
              // interpolates the sweep. `null` progress leaves the sweep unset
              // and the pip simply pulses — an unknown position must not draw
              // a confident zero.
              style={fraction === null ? undefined : { '--pip-sweep': `${fraction * 360}deg` }}
            />
          );
        }
        return <span key={i} className={`reading-pip${i < done ? ' reading-pip--done' : ''}`} />;
      })}
      {/* Past the target is worth seeing: a child who read a third story on a
          two-story day has done something, and a row of full pips hides it. */}
      {done > owed ? <span className="reading-pip-extra">{`+${done - owed}`}</span> : null}
    </div>
  );
}

ReadingPips.propTypes = {
  count: PropTypes.number,
  target: PropTypes.number,
  label: PropTypes.string,
  className: PropTypes.string,
  testId: PropTypes.string,
  /** A story is playing now: mark the pip it will fill. */
  live: PropTypes.bool,
  /** 0..1 through that story, or null when the position is not known. */
  progress: PropTypes.number,
};
