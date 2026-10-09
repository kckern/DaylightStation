// rateDrift.js — decide whether the media element's actual playbackRate has
// diverged from the rate the app intends, and therefore needs re-asserting.
//
// The controlled-rate effect in useCommonMediaController only runs when
// `playbackRate`, `getMediaEl` or `elementKey` changes. Anything that moves
// `el.playbackRate` afterwards — an element swapped in without re-keying, a
// dash source restart, whatever else — leaves the element drifted with nothing
// watching. The app then reports one rate while the video plays at another.
//
// Measured on the yellow-room tablet 2026-08-17 by buffer-drain rate (buffer
// empties at exactly the playback rate when nothing is being appended; control
// windows read 1.00x, confirming the method):
//
//   18:37:08-47   1.00x actual / label 1     <- agreed
//   18:38:38-39:17 1.00x actual / label 1    <- agreed
//   18:39:21-40:02 1.98x actual / label 1    <- DRIFTED
//   18:40:09-40:47 1.99x actual / label 1    <- DRIFTED
//   18:42:19-43:02 1.02x actual / label 1.5  <- DRIFTED, other direction
//
// Drift runs both ways, so this is not "the rate failed to apply" — it is the
// element and the app losing track of each other. The intended value is always
// known and the actual is always readable, so divergence is decidable without
// knowing which mechanism caused it.

// Rates are set as exact ladder values; anything beyond float noise is real.
export const RATE_EPSILON = 0.01;

/**
 * @param {number} actual   - el.playbackRate
 * @param {number} intended - the controlled rate the app believes is in effect
 * @param {number} [epsilon]
 * @returns {boolean} true when the element must be corrected
 */
export function shouldReassertRate(actual, intended, epsilon = RATE_EPSILON) {
  if (!Number.isFinite(intended) || intended <= 0) return false; // nothing meaningful to assert
  if (!Number.isFinite(actual)) return false;                    // element not ready / detached
  return Math.abs(actual - intended) > epsilon;
}

export default shouldReassertRate;
