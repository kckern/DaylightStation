/**
 * NumberPad — the reading shelf's number entry: a page, a count of minutes,
 * or a 13-digit ISBN.
 *
 * This is NOT the panel's `selfService/Keypad`, and it must not be. Keypad's
 * vocabulary is copied here (the same nine-plus-one keys, the same Kongtext
 * digits, the same slots); its behaviour is not, on four counts:
 *
 *   1. Keypad AUTO-SUBMITS at exactly `length` digits after a settle and has
 *      no Go button. A page number has no fixed length, so the child says
 *      when they are done — the submit button is the only way out.
 *   2. Keypad EMPTIES the entry on submit. A failed ISBN lookup would make a
 *      child retype thirteen digits; here the entry survives a submit and the
 *      parent clears it (via `value`) when it means to.
 *   3. Keypad's length is fixed and it refuses digits past it. Here the
 *      length is the caller's (`maxLength`), and the glyph size follows the
 *      slot count so thirteen fit the panel's 32rem.
 *   4. Keypad has no `X`. ISBN-10 check digits can be `X`, so it is offered
 *      when `allowX` is set — and only then.
 *
 * Also absent by design: the `<h1>Type your code</h1>`, the screen-off
 * button, the abandoned-entry timer and every other timer. Validation lives
 * in the parent: it watches `onChange`, decides `canSubmit`, and says why in
 * `hint`. Nothing is logged from here; the parent owns the story.
 *
 * What IS shared with Keypad is the press itself: every key and the submit
 * fire on pointerdown through `useTapFire`, so a jab that slides or rolls
 * off the key still lands (the panel's "hard to press" complaint).
 */
import { useCallback, useState } from 'react';
import useTapFire from '../selfService/useTapFire.js';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * @param {object} props
 * @param {string} props.label - the question above the slots.
 * @param {number} [props.maxLength] - how many characters the entry holds.
 * @param {boolean} [props.allowX] - offer an `X` key (ISBN-10 check digit).
 * @param {string} [props.submitLabel] - the button's word.
 * @param {boolean} [props.canSubmit] - the parent's verdict on the current
 *   entry; false disables submit. An empty entry is never submittable.
 * @param {string|null} [props.hint] - one line under the pad, for when the
 *   parent has something to say about the entry.
 * @param {string} [props.value] - a string makes the pad CONTROLLED: what is
 *   shown is this, and edits go out through `onChange` only. Anything else
 *   leaves the pad holding its own entry.
 * @param {(entry: string) => void} [props.onChange]
 * @param {(entry: string) => void} props.onSubmit
 */
export default function NumberPad({
  label,
  maxLength = 6,
  allowX = false,
  submitLabel = 'Go',
  canSubmit = true,
  hint = null,
  value,
  onChange = null,
  onSubmit,
}) {
  const controlled = typeof value === 'string';
  const [own, setOwn] = useState('');
  const tap = useTapFire();
  const entry = controlled ? value : own;

  const update = useCallback((next) => {
    if (next === entry) return;
    if (!controlled) setOwn(next);
    onChange?.(next);
  }, [controlled, entry, onChange]);

  const press = useCallback((char) => {
    if (entry.length >= maxLength) return;
    update(entry + char);
  }, [entry, maxLength, update]);

  const backspace = useCallback(() => {
    update(entry.slice(0, -1));
  }, [entry, update]);

  const submittable = canSubmit && entry.length > 0;
  const submit = useCallback(() => {
    if (!submittable) return;
    // The entry stays: a "no, not that book" or a failed lookup comes back to
    // the digits the child already typed, not to an empty row.
    onSubmit?.(entry);
  }, [entry, onSubmit, submittable]);

  const slots = Array.from({ length: maxLength }, (_, i) => entry[i] ?? '');

  return (
    <section className="school-books-pad" data-testid="numberpad">
      <h2 className="school-books-pad__label">{label}</h2>

      <div
        className="school-books-pad__entry"
        data-testid="numberpad-entry"
        style={{ '--slots': maxLength }}
        aria-live="polite"
      >
        {slots.map((char, i) => (
          <span
            key={i}
            className={`school-books-pad__slot${char ? ' is-filled' : ''}`}
            data-testid="numberpad-slot"
          >
            {char}
          </span>
        ))}
      </div>

      <div className="school-books-pad__keys">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="school-books-pad__key"
            {...tap(() => press(digit))}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="school-books-pad__key school-books-pad__key--back"
          aria-label="Backspace"
          {...tap(backspace)}
        >
          ⌫
        </button>
        <button
          type="button"
          className="school-books-pad__key"
          {...tap(() => press('0'))}
        >
          0
        </button>
        {allowX ? (
          <button
            type="button"
            className="school-books-pad__key"
            {...tap(() => press('X'))}
          >
            X
          </button>
        ) : (
          // Keeps the bottom row's shape (⌫ | 0 | _) so `0` sits under `8`
          // whether or not there is an X.
          <span className="school-books-pad__key school-books-pad__key--blank" aria-hidden="true" />
        )}
      </div>

      <button
        type="button"
        className="school-books-pad__submit"
        disabled={!submittable}
        {...tap(submit)}
      >
        {submitLabel}
      </button>

      {hint && (
        <p className="school-books-pad__hint" role="status">{hint}</p>
      )}
    </section>
  );
}
