import { useEffect, useRef } from 'react';
import './RepInterstitial.scss';

/**
 * RepInterstitial — the coach's card between two reps of a drill.
 *
 * A passed rep re-serves the next one, and while the next instance resolves
 * the run has nothing to draw: for about a third of a second the stage was a
 * black frame, nine times a drill. This card stands in that gap and says the
 * three things a teacher would say — how that one went, which rep it was, and
 * what is coming — and then fades onto the next rep, which by then is already
 * on the stand underneath it.
 *
 * It is a CARD, not a curtain. Nothing opens behind it; the curtain is the
 * ninth rep's, and it stays `GateCeremony`'s. Opaque for most of its life so
 * the resolving frame is never seen, then a short fade.
 *
 * THE NUMBER IS DELIBERATE. `failureCoaching` forbids a percentage on the fail
 * panel, and that rule stands there: a number with no bar beside it, shown to a
 * child who did not clear it, is a statistic in place of advice. A PASSED rep
 * is the other case — the bar was cleared, and "100%" is the one word a child
 * wants to read between reps. It was asked for by name.
 */

/** Total wall-clock before the card hands back. Mirrors RepInterstitial.scss. */
export const REP_CARD_MS = 2200;

const percent = (score) => (typeof score === 'number' && Number.isFinite(score)
  ? `${Math.round(Math.min(Math.max(score, 0), 1) * 100)}%`
  : 'Passed');

/**
 * The three lines, as a pure function so the copy is testable without a
 * timer: an eyebrow (which rep or set this was), a headline (the score), and
 * the line that names what comes next.
 */
export function repCardCopy({ score, setIndex, setCount, repIndex, repCount, setClear, next }) {
  const key = next?.key ?? null;
  const hand = next?.hand ?? null;
  if (setClear) {
    return {
      eyebrow: `Set ${setIndex} of ${setCount} clear`,
      headline: percent(score),
      line: key ? `Next: ${key}${hand ? `, ${hand}` : ''}` : 'Next set',
    };
  }
  const nextRep = Math.min(repIndex + 1, repCount);
  return {
    eyebrow: `Rep ${repIndex} of ${repCount}`,
    headline: percent(score),
    line: key ? `${key} again — rep ${nextRep} of ${repCount}` : `Rep ${nextRep} of ${repCount}`,
  };
}

export default function RepInterstitial({ score = null, setIndex, setCount, repIndex, repCount, setClear = false, next = null, onDone }) {
  const copy = repCardCopy({ score, setIndex, setCount, repIndex, repCount, setClear, next });

  // Armed once, on mount — the same rule as GateCeremony, for the same reason:
  // the gate re-renders on every MIDI note, and a timer keyed on a fresh
  // `onDone` closure would restart under a child's hands and never fire.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current?.(), REP_CARD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="rep-card" role="status" aria-label={`${copy.eyebrow}. ${copy.headline}. ${copy.line}.`}>
      <div className="rep-card__face">
        <span className="rep-card__eyebrow">{copy.eyebrow}</span>
        <span className="rep-card__headline">{copy.headline}</span>
        <span className="rep-card__line">{copy.line}</span>
      </div>
    </div>
  );
}
