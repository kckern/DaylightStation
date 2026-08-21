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
 * A REJECTED CODE IS ANIMATED, NOT NARRATED. "Try again." used to appear as a
 * line of text below the slots, which pushed the pad down the screen the
 * instant it arrived — a rug-pull under the finger of a child who is already
 * reaching for the next digit. The refusal now happens IN the slots: the row
 * shakes, then the six digits turn over one by one into REJECT_WORD, hold, and
 * wipe back to empty. Nothing moves, the whole thing is over in under two
 * seconds, and the status row below keeps a reserved height so the one message
 * that still uses words (a backend outage, plus its retry button) does not
 * shift the pad either.
 *
 * Presentational — every decision (wrong code vs. dead backend, what to do
 * next) belongs to useSelfService.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * One character per slot. Six for a six-digit code is the whole point — the
 * word lands exactly on the digits it is replacing, so nothing moves.
 *
 * NO-NO-NO rather than a word like DENIED or INVALID: three syllables a child
 * who cannot read yet already knows by shape, arriving one letter at a time.
 * Swapping it is a one-line change; a shorter or longer string is padded or
 * truncated to `length` below rather than breaking the grid.
 */
export const REJECT_WORD = 'NONONO';

// The refusal, in milliseconds. Deliberately theatrical — a child needs to
// notice the answer without reading anything — but bounded: shake, six turns,
// hold, six wipes ≈ 1.9s, and any keypress cancels it outright.
const SHAKE_MS = 380;
const LETTER_MS = 125;
const HOLD_MS = 900;
const WIPE_MS = 70;

/**
 * Buttons that fire on TOUCH-DOWN.
 *
 * The pad is a wall panel a child jabs at, and `onClick` waits for a full
 * press-and-release ON the same element — a jab that slides a few pixels, or a
 * finger that rolls off the key, produces nothing at all, which is exactly the
 * "the buttons are hard to press" complaint. `pointerdown` fires the moment the
 * finger lands, for touch and mouse alike.
 *
 * `preventDefault()` on pointerdown suppresses the compatibility mouse events
 * (focus, text selection, the drag ghost) but NOT the click that follows, so
 * the click handler stays for keyboard/synthetic activation and guards against
 * firing the same tap twice. The guard is a timestamp rather than a flag
 * because a pointerdown that never becomes a click (finger dragged off the key)
 * must not swallow the NEXT activation.
 */
function useTapFire() {
  const lastPointerAt = useRef(0);
  return useCallback((fn) => ({
    onPointerDown: (event) => {
      event.preventDefault();
      lastPointerAt.current = Date.now();
      fn();
    },
    onClick: () => {
      if (Date.now() - lastPointerAt.current < 700) return; // our own tap, arriving again
      fn();
    },
  }), []);
}

/**
 * @param {object} props
 * @param {number} [props.length] - digits in a code (6).
 * @param {(code: string) => Promise<{resolved: boolean, degraded?: boolean, skipped?: boolean}>} props.onSubmit
 *   - resolves with the verdict, so the keypad knows whether to play the
 *     refusal. Anything falsy back (a caller that reports nothing) simply
 *     skips the animation rather than guessing.
 * @param {boolean} [props.busy] - a resolve is in flight.
 * @param {string|null} [props.message] - the degraded sentence. A wrong code no
 *   longer arrives here (see the header); if one does, it is shown in the
 *   reserved status row and displaces nothing.
 * @param {boolean} [props.degraded] - the message is a backend fault, so offer
 *   a retry rather than making the child re-type a code that was never wrong.
 * @param {() => void} [props.onRetry]
 * @param {() => void} [props.onReload] - Clear pressed on an already-empty
 *   entry. The panel's only refresh affordance (no address bar, no header in
 *   lock mode); absent, an empty Clear simply does nothing.
 */
export default function Keypad({
  length = 6,
  onSubmit,
  busy = false,
  message = null,
  degraded = false,
  onRetry = null,
  onReload = null,
}) {
  const [entry, setEntry] = useState('');
  // null when idle; otherwise { phase, shown } — how many slots have turned
  // over so far, counting up through the reveal and back down through the wipe.
  const [reject, setReject] = useState(null);
  const timersRef = useRef([]);
  const tap = useTapFire();

  const letters = useMemo(
    () => REJECT_WORD.slice(0, length).padEnd(length, REJECT_WORD.slice(-1)).split(''),
    [length],
  );

  const stopReject = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setReject((current) => (current === null ? current : null));
  }, []);

  // Timers outlive a render; they must not outlive the panel (the idle timeout
  // unmounts this while a refusal is still playing).
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const playReject = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const at = (ms, fn) => timersRef.current.push(setTimeout(fn, ms));
    // Set synchronously: the red row is the answer, and it must be on screen in
    // the same frame the response lands, not one shake later.
    setReject({ phase: 'shake', shown: 0 });
    let t = SHAKE_MS;
    for (let i = 1; i <= length; i += 1) {
      const shown = i;
      at(t, () => setReject({ phase: 'reveal', shown }));
      t += LETTER_MS;
    }
    t += HOLD_MS;
    for (let i = length - 1; i >= 0; i -= 1) {
      const shown = i;
      at(t, () => setReject({ phase: 'wipe', shown }));
      t += WIPE_MS;
    }
    at(t, () => setReject(null));
  }, [length]);

  // Any key cancels a playing refusal on the spot — a child who has already
  // started re-typing must not watch their new digits get wiped by the tail of
  // the old animation.
  const press = useCallback((digit) => {
    stopReject();
    setEntry((current) => (current.length >= length ? current : current + digit));
  }, [length, stopReject]);

  /**
   * Clear wipes the entry; Clear on an ALREADY-EMPTY entry refreshes the panel.
   * That is the second tap of a double Clear, or one deliberate tap on an idle
   * screen — the kiosk's only way to pick up a deploy, since lock mode draws no
   * header and FKB has no address bar (see `useSelfService`'s `reload`).
   *
   * A refusal still playing counts as "something to clear": that tap cancels
   * the animation and nothing else. Otherwise a child who mistyped a code would
   * find the panel reloading under them for tapping the one key that means
   * "start over".
   */
  const clearEntry = useCallback(() => {
    if (reject) { stopReject(); return; }
    if (!entry && onReload) { onReload(); return; }
    setEntry('');
  }, [entry, onReload, reject, stopReject]);
  const backspace = useCallback(() => {
    stopReject();
    setEntry((c) => c.slice(0, -1));
  }, [stopReject]);

  const submit = useCallback(async () => {
    if (busy || entry.length !== length) return;
    // Cleared on the way out, not on the answer coming back: the next child
    // walking up must never find a half-typed code waiting for them, and the
    // refusal that follows is about a code they have already finished typing.
    setEntry('');
    const verdict = await onSubmit(entry);
    // Only a real refusal gets the drama. `skipped` is a double-tap that never
    // made a request (nothing on screen may change), and `degraded` is an
    // outage — the child's code may well have been fine, so it gets words and
    // a retry button rather than six letters calling it wrong.
    if (verdict && verdict.resolved === false && !verdict.skipped && !verdict.degraded) {
      playReject();
    }
  }, [busy, entry, length, onSubmit, playReject]);

  const cells = reject
    ? Array.from({ length }, (_, i) => (i < reject.shown ? letters[i] : null))
    : Array.from({ length }, (_, i) => entry[i] ?? null);

  return (
    <section className="school-selfservice" data-testid="selfservice-keypad">
      <h1 className="school-selfservice__title">Type your code</h1>

      <div
        className={`school-selfservice__entry${reject ? ' is-rejected' : ''}${reject?.phase === 'shake' ? ' is-shaking' : ''}`}
        data-testid="selfservice-entry"
        data-state={reject ? 'rejected' : 'entry'}
        // Off during a refusal: the letters turn over one at a time, and a live
        // region would read "N", "NO", "NON"… The sr-only status below says it
        // once instead.
        aria-live={reject ? 'off' : 'polite'}
      >
        {cells.map((char, i) => (
          <span
            key={i}
            className={`school-selfservice__slot${char ? ' is-filled' : ''}${reject && char ? ' is-reject' : ''}`}
          >
            {char ?? ''}
          </span>
        ))}
      </div>
      {/* The refusal is a picture; this is the same news for anyone who cannot
          see it. Announced once, rather than letting the live region above read
          out six letters one at a time as they turn over. */}
      <p className="school-selfservice__sr" role="status">
        {reject ? 'That code did not work. Type it again.' : ''}
      </p>

      {/* Reserved height, always rendered: this row is the only thing between
          the slots and the pad, so it may never change the pad's position by
          appearing.

          WORDS ONLY FOR AN OUTAGE. A wrong code says what it has to say in the
          slots above; printing "Try again." underneath as well would be the
          same refusal twice, and the sentence a bad code carries is the one
          thing here a child cannot act on differently. `degraded` is the whole
          gate — the hook still sets `message` for a refusal, and the day it
          starts sending something a child CAN act on, this is the line to
          revisit. */}
      <div className="school-selfservice__status">
        {message && degraded && (
          <p className="school-selfservice__message is-degraded">
            {message}
          </p>
        )}
        {degraded && onRetry && (
          <button
            type="button"
            className="school-selfservice__retry"
            disabled={busy}
            {...tap(onRetry)}
          >
            Try again
          </button>
        )}
      </div>

      <div className="school-selfservice__pad">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="school-selfservice__key"
            disabled={busy}
            {...tap(() => press(digit))}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="school-selfservice__key school-selfservice__key--clear"
          disabled={busy}
          {...tap(clearEntry)}
        >
          Clear
        </button>
        <button
          key="0"
          type="button"
          className="school-selfservice__key"
          disabled={busy}
          {...tap(() => press('0'))}
        >
          0
        </button>
        <button
          type="button"
          className="school-selfservice__key school-selfservice__key--back"
          disabled={busy}
          aria-label="Backspace"
          {...tap(backspace)}
        >
          ⌫
        </button>
      </div>

      <button
        type="button"
        className="school-selfservice__go"
        disabled={busy || entry.length !== length}
        {...tap(submit)}
      >
        Go
      </button>
    </section>
  );
}
