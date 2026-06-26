/**
 * Decide whether an input arriving at `nowMs` (after the last input at
 * `lastMs`) should trigger the "who's playing?" prompt: true iff the idle gap
 * reached the threshold. `thresholdMs <= 0` disables the feature.
 */
export function firesOnGap(lastMs, nowMs, thresholdMs) {
  if (!(thresholdMs > 0)) return false;
  return nowMs - lastMs >= thresholdMs;
}
