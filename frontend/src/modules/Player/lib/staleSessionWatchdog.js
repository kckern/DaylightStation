/**
 * Sliding-window watchdog that escalates to recovery when dash.js emits
 * enough segment-404 errors (code 28) in a short window — a clear
 * signal that the Plex transcode session is dead.
 *
 * Design notes:
 * - Only code 28 errors count (dash.js SEGMENT_BASE_ERROR_CODE /
 *   "segment not available"). Other errors (manifest, manifest parse,
 *   etc.) indicate different failure modes and should not trigger
 *   session refresh.
 * - One-shot semantics: once the threshold is crossed it stays quiet
 *   until reset() is called (typically on successful manifest load or
 *   playback start — see Task 6).
 *
 * @param {Object} opts
 * @param {Function} [opts.onEscalate] - called with { reason, errorCount, windowMs } at threshold
 * @param {number} [opts.threshold=3] - number of errors needed within window
 * @param {number} [opts.windowMs=10000] - sliding window duration
 * @returns {{ recordError: Function, reset: Function, hasEscalated: boolean }}
 */
export function createStaleSessionWatchdog({ onEscalate, threshold = 3, windowMs = 10000 } = {}) {
  let timestamps = [];
  let escalated = false;

  return {
    /**
     * Record a dash.js error. Only code-28 errors are counted.
     * May trigger onEscalate synchronously if threshold is crossed.
     */
    recordError(err) {
      if (escalated) return;
      if (!err || err.code !== 28) return;

      const now = Date.now();
      // Drop timestamps outside the window
      timestamps = timestamps.filter(t => now - t < windowMs);
      timestamps.push(now);

      if (timestamps.length >= threshold) {
        escalated = true;
        if (typeof onEscalate === 'function') {
          onEscalate({
            reason: 'stale-session-detected',
            errorCount: timestamps.length,
            windowMs
          });
        }
      }
    },
    /**
     * Clear state. Call on successful manifest load / playback start
     * so a later recovery attempt starts with a fresh count.
     */
    reset() {
      timestamps = [];
      escalated = false;
    },
    get hasEscalated() { return escalated; }
  };
}
