// frontend/src/modules/Surround/dissolve.js
//
// The surround's ONE transition. Everything in the frame that replaces one piece
// of content with another — the footer ticker's cue/fact line, the rail's
// composer fact, the place carousel's slides — plays the same dissolve:
//
//     fade the old thing fully OUT to the ground,
//     hold the empty ground for a beat,
//     fade the new thing IN.
//
// A cross-fade would be a different language (two things visible at once, one
// dissolving into the other); dissolving THROUGH the dark is what makes the
// programme read as one hand. On the dark rail and the near-black band a short
// cross-flip reads as a blink, which is why the held beat exists at all.
//
// The numbers live HERE and nowhere else. Wave 2 shipped two copies of them
// (CUE_FADE_MS and COMPOSER_FACT_FADE_MS, both 320), which is two chances to
// drift; wave 3 adds a third surface, so the constants moved to one file that
// all three read. The per-module names survive as aliases because they are what
// the existing suites and call sites already say.
//
// SO DOES THE CHOREOGRAPHY. Centralising the numbers while writing the state
// machine three times centralised the wrong half: the constants could not drift
// but the behaviour already had — the carousel read `prefers-reduced-motion`
// from a render-time snapshot while the ticker read it live, and only the ticker
// had the fast paths that skip the fade for an urgent change. `useDissolve`
// below is the one controller all three surfaces run.

import { useEffect, useRef, useState } from 'react';

/** Each half of the dissolve: the old thing out, then the new thing in. */
export const DISSOLVE_FADE_MS = 320;
/** The beat of empty ground between the two halves — the "through black". */
export const DISSOLVE_HOLD_MS = 160;
/** Out + held ground + in. 800ms end to end. */
export const DISSOLVE_SWAP_MS = DISSOLVE_FADE_MS + DISSOLVE_HOLD_MS + DISSOLVE_FADE_MS;
/**
 * When the swap COMMITS: at the end of the held beat, not at the end of the
 * fade-out. Committing earlier would let the incoming content be visible sliding
 * in underneath the outgoing content's opacity.
 */
export const DISSOLVE_COMMIT_MS = DISSOLVE_FADE_MS + DISSOLVE_HOLD_MS;

/**
 * Whether the viewer has asked for less motion. Wrapped because `matchMedia` is
 * absent in some test environments and throws in a few embedded WebViews; a
 * missing media-query engine means "no preference expressed", not "reduce".
 */
export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch (_) {
    return false;
  }
}

/** The default identity of a piece of dissolving content. */
const defaultKeyOf = (value) => (value == null ? null : value.key ?? null);
/** The default "is there anything on screen to fade out of". */
const defaultHasContent = (value) => value != null;

/**
 * THE FRAME'S ONE DISSOLVE, as a hook.
 *
 * Hold the current content; when the next differs, fade out, hold the empty
 * ground for a beat, then commit and fade in. Callers render `shown` and apply
 * their own `--hidden` class while `hidden` is true; the opacity duration comes
 * from `DISSOLVE_FADE_MS`, which the caller sets inline so the stylesheet and
 * this timer cannot drift.
 *
 * TWO THINGS COMMIT INSTANTLY, and both are the same judgement — there is
 * nothing worth fading:
 *   * nothing is on screen (a first line, or a panel recovering from empty), so
 *     an out-fade would be a fade from blank to blank; and
 *   * the viewer has asked for less motion.
 *
 * THE REDUCED-MOTION READ IS LIVE, deliberately, and this is where the three
 * copies had already drifted. The carousel read it once per render into a
 * snapshot; the ticker called it at the moment of the change. LIVE is correct:
 * the preference is an accessibility setting, it can be flipped by the OS mid-
 * session, and a frame that keeps dissolving until something happens to
 * re-render it is ignoring an instruction it has already been given. The cost is
 * one `matchMedia` read per content change — twelve seconds apart at the fastest
 * — against a `matchMedia` listener per surface, which is the subscription the
 * snapshot was avoiding. (The carousel still reads a snapshot for its own
 * INTERVAL, which is a different question: whether to arm a timer at all.)
 *
 * @param {*} next the content that should be showing.
 * @param {object} [opts]
 * @param {(v:*) => (string|null)} [opts.keyOf] content identity. Two values with
 *   the same key are the same content and play no dissolve.
 * @param {(v:*) => boolean} [opts.hasContent] whether a value is something a
 *   viewer can see. Content-shaped payloads that can be "present but blank"
 *   (a `{ text: '' }` line) override this.
 * @param {(next:*, shown:*) => boolean} [opts.instant] extra fast paths: return
 *   true to commit without the fade. Used for changes that are URGENT rather
 *   than merely new — see `CueTicker`'s cue activation and movement boundary,
 *   where a softened swap would leave the band's two halves disagreeing about
 *   what is sounding for the length of a fade.
 * @returns {[*, boolean]} `[shown, hidden]`.
 */
export function useDissolve(next, opts = {}) {
  const {
    keyOf = defaultKeyOf,
    hasContent = defaultHasContent,
    instant = null,
  } = opts;

  const [shown, setShown] = useState(() => next);
  const [hidden, setHidden] = useState(false);
  const timers = useRef([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // The options are read at the moment of a change, never depended on: an inline
  // arrow for `instant` is a fresh identity every render and would re-run this
  // effect at the transport's 10 Hz if it were in the dependency list.
  const latest = useRef({ keyOf, hasContent, instant });
  latest.current = { keyOf, hasContent, instant };

  useEffect(() => {
    const { keyOf: key, hasContent: has, instant: fast } = latest.current;
    if (key(next) === key(shown)) return;
    clearTimers();
    if (!has(shown) || prefersReducedMotion() || (fast ? fast(next, shown) : false)) {
      setShown(next);
      setHidden(false);
      return;
    }
    // Fade out, hold the empty ground, then swap and fade in. The swap commits
    // at the END of the held beat so the incoming content is never visible
    // sliding in under the outgoing content's opacity.
    setHidden(true);
    timers.current.push(setTimeout(() => {
      setShown(next);
      setHidden(false);
    }, DISSOLVE_COMMIT_MS));
  }, [next, shown]);

  // Every surface unmounts — a queue advance, a collapse, a rail that stops
  // being authored. A pending commit that fires into a dead component is a React
  // warning at best and a leak at worst.
  useEffect(() => () => clearTimers(), []);

  return [shown, hidden];
}
