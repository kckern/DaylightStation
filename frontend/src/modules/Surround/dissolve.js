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
