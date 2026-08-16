import GameButton from './GameButton.jsx';
import './gameChrome.scss';

/**
 * One value out of an ordered many, stepped rather than picked.
 *
 * A `GameChoice` shows every option at once, which is right for three or four
 * and wrong for thirteen: a segmented control that wraps to four rows is not a
 * control any more. A ladder is ordered — rung 5 is between 4 and 6 — so the
 * shape that fits it is a step, with the current rung named in the middle.
 *
 * Both ends are real buttons at the touch floor, and they disable at the ends of
 * the range rather than wrapping: a player who thinks they are at the top should
 * find out by the button going quiet, not by being thrown back to the bottom.
 */
export default function GameStepper({
  label = null,
  value,
  options = [],
  onChange,
  className = '',
}) {
  const index = options.findIndex((option) => option.value === value);
  const at = index < 0 ? 0 : index;
  const current = options[at];
  const step = (delta) => {
    const next = options[at + delta];
    if (next) onChange?.(next.value);
  };

  return (
    <div className={`pg-stepper ${className}`.trim()} role="group" aria-label={label ?? undefined}>
      <GameButton
        variant="icon"
        onClick={() => step(-1)}
        disabled={at <= 0}
        aria-label={`Down one${label ? ` ${label}` : ''}`}
      >
        −
      </GameButton>
      {/* aria-live so stepping ANNOUNCES the new value: the buttons keep focus,
          so without it a screen-reader user steps blind. */}
      <span className="pg-stepper__value" aria-live="polite">
        <span className="pg-stepper__ordinal">{at + 1} of {options.length}</span>
        <span className="pg-stepper__label">{current?.label ?? '—'}</span>
      </span>
      <GameButton
        variant="icon"
        onClick={() => step(1)}
        disabled={at >= options.length - 1}
        aria-label={`Up one${label ? ` ${label}` : ''}`}
      >
        +
      </GameButton>
    </div>
  );
}
