/**
 * NumberPad — the reading shelf's number entry: a page, a count of minutes,
 * or a 13-digit ISBN.
 *
 * This is NOT the panel's `selfService/Keypad`, and it must not be. Keypad's
 * vocabulary is copied here (the same nine-plus-one keys, the same Kongtext
 * digits, the same slots); its behaviour is not, on four counts:
 *
 *   1. Keypad AUTO-SUBMITS at exactly `length` digits after a settle and has
 *      no Go button. A page number has no fixed length, so the child says when
 *      they are done and the submit button is the only way out. An ISBN DOES
 *      have a length, so that pad passes `showSubmit={false}` and its parent
 *      fires on the finished number instead (`useBookShelf`'s auto-advance);
 *      the button is retired per-pad, not for everyone.
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
 *
 * The ⌫ key is the one exception, and the reason is the same pointerdown.
 * There used to be a `Clear number` button between the slots and the grid,
 * right above the `3` — a right-aligned target that fires the instant a
 * finger lands and wipes a half-typed ISBN with no chance to slide off it. A
 * child did exactly that four times in 88 seconds. Clearing now lives on ⌫,
 * behind a HOLD: the key resolves on release (or on the finger sliding off,
 * which keeps the jab working), and a press that lasts `HOLD_TO_CLEAR_MS`
 * wipes the entry instead — once, and the release that follows owes nothing.
 * `Escape` still clears outright for the paired keyboard and the scanner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import useTapFire from '../selfService/useTapFire.js';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** How long a finger must stay on ⌫ before it wipes the whole entry. */
const HOLD_TO_CLEAR_MS = 600;

/**
 * @param {object} props
 * @param {string} props.label - the question above the slots.
 * @param {number} [props.maxLength] - how many characters the entry holds.
 * @param {boolean} [props.allowX] - offer an `X` key (ISBN-10 check digit).
 * @param {string} [props.submitLabel] - the button's word.
 * @param {boolean} [props.showSubmit] - false retires the button for this pad.
 *   `Enter` still submits, so a barcode scanner's trailing return keeps working.
 * @param {boolean} [props.canSubmit] - the parent's verdict on the current
 *   entry; false disables submit. An empty entry is never submittable.
 * @param {boolean} [props.disabled] - freezes every control during a write.
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
  showSubmit = true,
  canSubmit = true,
  disabled = false,
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
    if (disabled) return;
    if (entry.length >= maxLength) return;
    update(entry + char);
  }, [disabled, entry, maxLength, update]);

  const backspace = useCallback(() => {
    if (disabled) return;
    update(entry.slice(0, -1));
  }, [disabled, entry, update]);

  const clear = useCallback(() => {
    if (disabled) return;
    update('');
  }, [disabled, update]);

  // The hold lives on refs, not state: the timer fires from outside React and
  // must see the CURRENT entry, and a re-render mid-press must not re-arm it.
  // `active` says a press is still in progress (so the compatibility click can
  // be ignored); `owes` says that press still has a backspace to pay.
  const holdRef = useRef({ active: false, owes: false });
  const holdTimer = useRef(null);
  const lastPointerAt = useRef(0);
  const actionsRef = useRef({ clear, backspace });
  const [holding, setHolding] = useState(false);
  useEffect(() => { actionsRef.current = { clear, backspace }; });

  const disarm = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  }, []);
  // Unmount (an aborted lookup, a walk-away) must not leave a wipe armed.
  useEffect(() => disarm, [disarm]);

  const holdStart = useCallback((event) => {
    event.preventDefault();
    if (disabled) return;
    lastPointerAt.current = Date.now();
    holdRef.current = { active: true, owes: true };
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      // The hold has paid for the press: the release owes no character.
      holdRef.current.owes = false;
      setHolding(false);
      actionsRef.current.clear();
    }, HOLD_TO_CLEAR_MS);
  }, [disabled]);

  // Release, or the finger sliding off the key, or the browser taking the
  // gesture. Whichever arrives first ends the press; the rest are no-ops.
  const holdEnd = useCallback(() => {
    if (!holdRef.current.active) return;
    const { owes } = holdRef.current;
    holdRef.current = { active: false, owes: false };
    lastPointerAt.current = Date.now();
    disarm();
    if (owes) actionsRef.current.backspace();
  }, [disarm]);

  const submittable = !disabled && canSubmit && entry.length > 0;
  const submit = useCallback(() => {
    if (!submittable) return;
    // The entry stays: a "no, not that book" or a failed lookup comes back to
    // the digits the child already typed, not to an empty row.
    onSubmit?.(entry);
  }, [entry, onSubmit, submittable]);

  // Activity can synchronously rerender the parent earlier in the same native
  // key dispatch. Keep this listener mounted so that render cannot remove it
  // before its turn; read current actions instead of subscribing on every render.
  const keyboardRef = useRef(null);
  keyboardRef.current = { disabled, press, backspace, clear, allowX, submittable, submit };

  // The wall panel has a paired HID keyboard, and a barcode scanner presents
  // as one. Keep the handler scoped to the mounted pad; never steal typing
  // from a future real input embedded in the same screen.
  useEffect(() => {
    const onKeyDown = (event) => {
      const { disabled, press, backspace, clear, allowX, submittable, submit } = keyboardRef.current;
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName?.toLowerCase?.();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (allowX && event.key.toUpperCase() === 'X') {
        event.preventDefault();
        press('X');
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        backspace();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        clear();
      } else if (event.key === 'Enter' && submittable) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const slots = Array.from({ length: maxLength }, (_, i) => entry[i] ?? '');

  return (
    /* Digits, and the surface a barcode scanner types into. */
    <section className="school-books-pad" data-testid="numberpad" data-ime="off">
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
            disabled={disabled}
            {...tap(() => press(digit))}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className={`school-books-pad__key school-books-pad__key--back${holding ? ' is-holding' : ''}`}
          aria-label="Backspace — hold to clear the whole number"
          disabled={disabled}
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          onPointerLeave={holdEnd}
          onPointerCancel={holdEnd}
          onClick={() => {
            // Our own tap, arriving again as the compatibility click (the
            // guard useTapFire uses). A real keyboard activation gets through.
            if (Date.now() - lastPointerAt.current < 700) return;
            backspace();
          }}
        >
          ⌫
        </button>
        <button
          type="button"
          className="school-books-pad__key"
          disabled={disabled}
          {...tap(() => press('0'))}
        >
          0
        </button>
        {allowX ? (
          <button
            type="button"
            className="school-books-pad__key"
            disabled={disabled}
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

      {showSubmit && (
        <button
          type="button"
          className="school-books-pad__submit"
          disabled={!submittable}
          {...tap(submit)}
        >
          {submitLabel}
        </button>
      )}

      {hint && (
        <p className="school-books-pad__hint" role="status">{hint}</p>
      )}
    </section>
  );
}
