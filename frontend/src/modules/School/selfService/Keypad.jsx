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
 * THE INTERACTION OUTLASTS THE ENTRY. Auto-submit made the sixth DIGIT the
 * child's finishing gesture, and `submit` empties the pad before the round
 * trip — so the trailing activations of that key (a release that outran the
 * tap dedupe, an impatient second jab) arrive on an empty pad and used to read
 * as the start of a new code, cancelling the refusal they had just earned.
 * STRAY_PRESS_MS is where that is held: for as long as one physical gesture is
 * allowed to take, a key is the tail of the last code rather than the head of
 * the next.
 *
 * Presentational — every decision (wrong code vs. dead backend, what to do
 * next) belongs to useSelfService.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screenOff } from '../../../lib/fkb.js';
import useArmedAction from '../../../lib/identity/useArmedAction.js';
import { schoolLog } from '../schoolLog.js';

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

// The pause between the 6th digit landing and auto-submit firing. `submit`
// (below) is a real round trip — it resolves the code, may open a card, and
// soft-claims a learner — so it is not free to retry. This settle window is
// what lets a child who overshoots the last digit backspace before that
// request ever goes out, without adding a noticeable delay for a correct code.
const AUTO_SUBMIT_SETTLE_MS = 300;

/**
 * HOW LONG A KEY ACTIVATION STILL BELONGS TO THE CODE THAT JUST WENT OUT.
 *
 * `submit` empties the entry BEFORE the round trip (see there for why), and
 * auto-submit made the child's finishing gesture a DIGIT KEY rather than a
 * deliberate tap on Go. Those two together mean every trailing activation of
 * that last key — the release that outran `useTapFire`'s dedupe window, the
 * impatient second jab from a child who saw nothing happen — now lands on an
 * EMPTY pad, where `press` reads it as the start of a new code and cancels the
 * refusal that same submission had just earned. NONONO fired and was wiped
 * before anyone could see it.
 *
 * So a press this soon after the verdict is treated as the tail of the old
 * interaction and dropped: nobody has reacted to an answer they have not
 * finished seeing. Deliberately the SAME 700ms as `useTapFire`'s window, and
 * for the same reason — it is how long one physical gesture at this panel is
 * allowed to take. Past it, the header's rule stands unchanged: any key
 * cancels a playing refusal, because by then the child has read it.
 */
const STRAY_PRESS_MS = 700;

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
 * @param {number} [props.screenOffTimeoutSeconds] - Keypad-only display sleep.
 *   Zero/invalid disables automatic sleep. This is deliberately independent
 *   from the card-to-keypad idle timeout owned by useSelfService.
 * @param {boolean} [props.screenOffSuppressed] - Ceremony/runner or another
 *   foreground obligation is using the panel; do not sleep it.
 */
export default function Keypad({
  length = 6,
  onSubmit,
  busy = false,
  message = null,
  degraded = false,
  onRetry = null,
  onReload = null,
  screenOffTimeoutSeconds = 0,
  screenOffSuppressed = false,
}) {
  const [entry, setEntry] = useState('');
  const [screenOffFailure, setScreenOffFailure] = useState(null);
  const [activityEpoch, setActivityEpoch] = useState(0);
  // null when idle; otherwise { phase, shown } — how many slots have turned
  // over so far, counting up through the reveal and back down through the wipe.
  const [reject, setReject] = useState(null);
  const timersRef = useRef([]);
  const tap = useTapFire();

  const turnScreenOff = useCallback((source) => {
    schoolLog.selfService('screen-off.requested', { source });
    if (screenOff()) {
      setScreenOffFailure(null);
      schoolLog.selfService('screen-off.succeeded', { source });
      return true;
    }
    const sentence = "The screen can't turn off here. Tell a grown-up.";
    setScreenOffFailure(sentence);
    schoolLog.selfServiceError('screen-off.failed', { source, reason: 'fkb_unavailable' });
    return false;
  }, []);
  const { armed: screenOffArmed, trigger: triggerScreenOff } = useArmedAction(
    () => turnScreenOff('manual'),
    { armMs: 3000 },
  );

  const noteActivity = useCallback(() => {
    setScreenOffFailure(null);
    setActivityEpoch((current) => current + 1);
  }, []);

  // Automatic screen sleep belongs ONLY to the anonymous keypad. Keypad
  // unmounting already suppresses it for cards and runners; the explicit gates
  // cover a resolve in flight and the scan ceremony, which overlays the keypad.
  useEffect(() => {
    const ms = Number(screenOffTimeoutSeconds) * 1000;
    if (!Number.isFinite(ms) || ms <= 0 || busy || screenOffSuppressed) return undefined;
    const timer = setTimeout(() => turnScreenOff('idle'), ms);
    return () => clearTimeout(timer);
  }, [activityEpoch, busy, screenOffSuppressed, screenOffTimeoutSeconds, turnScreenOff]);

  const requestScreenOff = useCallback(() => {
    if (!screenOffArmed) schoolLog.selfService('screen-off.armed', { source: 'manual' });
    triggerScreenOff();
  }, [screenOffArmed, triggerScreenOff]);

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

  /**
   * Until when a digit/backspace activation is read as the tail of the code
   * that just went out rather than the start of a new one (STRAY_PRESS_MS).
   * Armed twice per submission — once when the request leaves, once when the
   * verdict lands — so the window is measured from whichever the child could
   * actually have been reacting to, and a slow round trip does not extend it.
   */
  const strayUntilRef = useRef(0);
  const armStrayGuard = useCallback(() => {
    strayUntilRef.current = Date.now() + STRAY_PRESS_MS;
  }, []);
  const isStray = useCallback(() => Date.now() < strayUntilRef.current, []);

  // Any key cancels a playing refusal on the spot — a child who has already
  // started re-typing must not watch their new digits get wiped by the tail of
  // the old animation. The one exception is the stray window above: an
  // activation that arrives before anyone could have read the answer is the
  // previous gesture finishing, not a new one starting, and it is dropped
  // outright rather than allowed to cancel the refusal it caused.
  const press = useCallback((digit) => {
    if (isStray()) {
      schoolLog.selfService('keypad.stray-press', { key: 'digit' });
      return;
    }
    stopReject();
    setEntry((current) => (current.length >= length ? current : current + digit));
  }, [isStray, length, stopReject]);

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
    // Clear itself is never held back — "start over" has to work the instant
    // it is asked for. Its RELOAD branch is: inside the stray window the entry
    // is empty because `submit` just emptied it, not because the screen is
    // idle, and reloading the panel out from under a verdict still in flight
    // is the same rug pull by a louder route.
    if (!entry && onReload && !isStray()) { onReload(); return; }
    setEntry('');
  }, [entry, isStray, onReload, reject, stopReject]);
  const backspace = useCallback(() => {
    if (isStray()) {
      schoolLog.selfService('keypad.stray-press', { key: 'backspace' });
      return;
    }
    stopReject();
    setEntry((c) => c.slice(0, -1));
  }, [isStray, stopReject]);

  const submit = useCallback(async () => {
    if (busy || entry.length !== length) return;
    // Cleared on the way out, not on the answer coming back: the next child
    // walking up must never find a half-typed code waiting for them, and the
    // refusal that follows is about a code they have already finished typing.
    setEntry('');
    // From here until STRAY_PRESS_MS after the answer lands, the pad is empty
    // but the interaction is NOT over: see STRAY_PRESS_MS.
    armStrayGuard();
    const verdict = await onSubmit(entry);
    armStrayGuard();
    // Only a real refusal gets the drama. `skipped` is a double-tap that never
    // made a request (nothing on screen may change), and `degraded` is an
    // outage — the child's code may well have been fine, so it gets words and
    // a retry button rather than six letters calling it wrong.
    if (verdict && verdict.resolved === false && !verdict.skipped && !verdict.degraded) {
      playReject();
    }
  }, [armStrayGuard, busy, entry, length, onSubmit, playReject]);

  // A bonded BK-3001 is a normal Android HID keyboard: its keys reach the
  // WebView as browser keydown events. Keep this listener on the keypad, not
  // SchoolApp, so typing can never leak into a runner or an open School page.
  // Preventing default on Enter also avoids activating whichever touch button
  // happened to retain focus after the child last used the screen.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        noteActivity();
        press(event.key);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        noteActivity();
        backspace();
        return;
      }
      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        event.preventDefault();
        noteActivity();
        submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backspace, noteActivity, press, submit]);

  // `submit` is recreated on every keystroke (it closes over `entry`), so
  // routing the auto-submit timer through a ref — rather than depending on
  // `submit` directly — keeps this effect's own deps down to the two
  // primitives that actually define "a code just completed": `entry` and
  // `length`. Depending on `submit` instead would re-arm (and, worse,
  // re-cancel) the settle timer on every unrelated re-render that changes its
  // identity (e.g. `busy` flipping), which is exactly the "re-render
  // re-triggers it" failure mode to avoid.
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);

  // Auto-submit: the 6th digit is the only decision left, so there is nothing
  // for "Go" to add. A short settle (see AUTO_SUBMIT_SETTLE_MS) sits between
  // the completed code and the actual request so a child who overshoots the
  // last digit can backspace before anything irreversible fires — the timer
  // is cancelled by the same cleanup that runs on every backspace/clear.
  useEffect(() => {
    if (entry.length !== length) return undefined;
    const timer = setTimeout(() => submitRef.current(), AUTO_SUBMIT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [entry, length]);

  const cells = reject
    ? Array.from({ length }, (_, i) => (i < reject.shown ? letters[i] : null))
    : Array.from({ length }, (_, i) => entry[i] ?? null);

  return (
    <section
      className="school-selfservice"
      data-testid="selfservice-keypad"
      onPointerDownCapture={noteActivity}
      onKeyDownCapture={noteActivity}
      onClickCapture={noteActivity}
    >
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
        className={`school-selfservice__screen-off${screenOffArmed ? ' is-armed' : ''}`}
        aria-live="polite"
        disabled={busy || screenOffSuppressed}
        {...tap(requestScreenOff)}
      >
        {screenOffArmed ? 'Tap again to turn off screen' : 'Turn off screen'}
      </button>
      <p className="school-selfservice__screen-off-status" role="status">
        {screenOffFailure ?? ''}
      </p>
    </section>
  );
}
