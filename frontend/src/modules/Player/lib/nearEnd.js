/**
 * `isNearEnd` — the single "the playhead is at the end of this media" predicate.
 *
 * Three subsystems need this and two used to carry their own copy:
 *   - endOfContentWatchdog  — advance the queue when `ended` never fires
 *   - atDurationStuck       — telemetry for the near-end stall-detection guard
 *   - useMediaResilience    — suppress the jolt ladder at EOF (2026-07-10)
 *
 * The 0.5s threshold is inherited from the 2026-05-23 stuck-at-duration audit.
 * `>=` (not `>`) matters: dash.js clamps `currentTime` to exactly `duration`
 * when the trailing fragment is zero-byte, which is the dominant EOF case here.
 */
export const NEAR_END_THRESHOLD_SECONDS = 0.5;

/**
 * @param {number|null} currentTime
 * @param {number|null} duration
 * @param {number} [thresholdSeconds=0.5]
 * @returns {boolean}
 */
export function isNearEnd(currentTime, duration, thresholdSeconds = NEAR_END_THRESHOLD_SECONDS) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) return false;
  if (duration <= 0) return false;
  return currentTime >= (duration - thresholdSeconds);
}
