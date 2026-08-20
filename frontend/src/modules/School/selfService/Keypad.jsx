/**
 * Keypad — the locked panel's idle screen (design §3).
 *
 * Deliberately anonymous. There is NO learner name here, no home grid, no
 * breadcrumb and no deep link: the code names the learner, so a name on the
 * lock screen would only tell a child whose codes to guess. The one thing on
 * screen besides the digits is whatever the last attempt had to say.
 *
 * THE DIGITS ARE SHOWN, NOT MASKED. The anonymity rule covers the learner's
 * NAME; the digits are printed on a sheet of paper in the child's hand, so
 * masking them hides nothing from anyone and costs a seven-year-old the only
 * way to check a six-digit copy before committing to a round trip. A masked
 * mis-tap is indistinguishable from a correct entry until the server says
 * "Try again.", which reads as "your code is wrong" rather than "you fumbled
 * a key".
 *
 * Presentational — every decision (wrong code vs. dead backend, what to do
 * next) belongs to useSelfService.
 */
import { useCallback, useState } from 'react';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * @param {object} props
 * @param {number} [props.length] - digits in a code (6).
 * @param {(code: string) => void} props.onSubmit
 * @param {boolean} [props.busy] - a resolve is in flight.
 * @param {string|null} [props.message] - "Try again", or the degraded sentence.
 * @param {boolean} [props.degraded] - the message is a backend fault, so offer
 *   a retry rather than making the child re-type a code that was never wrong.
 * @param {() => void} [props.onRetry]
 */
export default function Keypad({
  length = 6,
  onSubmit,
  busy = false,
  message = null,
  degraded = false,
  onRetry = null,
}) {
  const [entry, setEntry] = useState('');

  const press = useCallback((digit) => {
    setEntry((current) => (current.length >= length ? current : current + digit));
  }, [length]);

  const submit = useCallback(() => {
    if (busy || entry.length !== length) return;
    // Cleared on the way out, not on the answer coming back: the next child
    // walking up must never find a half-typed code waiting for them, and the
    // message that follows is about a code they have already finished typing.
    setEntry('');
    onSubmit(entry);
  }, [busy, entry, length, onSubmit]);

  const slots = Array.from({ length }, (_, i) => entry[i] ?? null);

  return (
    <section className="school-selfservice" data-testid="selfservice-keypad">
      <h1 className="school-selfservice__title">Type your code</h1>

      <div className="school-selfservice__entry" data-testid="selfservice-entry" aria-live="polite">
        {slots.map((digit, i) => (
          <span
            key={i}
            className={`school-selfservice__slot${digit ? ' is-filled' : ''}`}
          >
            {digit ?? ''}
          </span>
        ))}
      </div>

      {message && (
        <p
          className={`school-selfservice__message${degraded ? ' is-degraded' : ''}`}
          role="status"
        >
          {message}
        </p>
      )}
      {degraded && onRetry && (
        <button
          type="button"
          className="school-selfservice__retry"
          onClick={onRetry}
          disabled={busy}
        >
          Try again
        </button>
      )}

      <div className="school-selfservice__pad">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="school-selfservice__key"
            onClick={() => press(digit)}
            disabled={busy}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="school-selfservice__key school-selfservice__key--clear"
          onClick={() => setEntry('')}
          disabled={busy}
        >
          Clear
        </button>
        <button
          key="0"
          type="button"
          className="school-selfservice__key"
          onClick={() => press('0')}
          disabled={busy}
        >
          0
        </button>
        <button
          type="button"
          className="school-selfservice__key school-selfservice__key--back"
          onClick={() => setEntry((c) => c.slice(0, -1))}
          disabled={busy}
          aria-label="Backspace"
        >
          ⌫
        </button>
      </div>

      <button
        type="button"
        className="school-selfservice__go"
        onClick={submit}
        disabled={busy || entry.length !== length}
      >
        Go
      </button>
    </section>
  );
}
