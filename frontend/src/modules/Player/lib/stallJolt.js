/**
 * stallJolt — escalation ladder for jolting the player out of a stuck state
 * (a mid-playback stall, or a forward seek that never completes because Plex
 * hasn't transcoded the seeked region) WITHOUT losing the seek intent.
 *
 * Every rung re-seeks to the captured intent (the frozen playhead = the seek
 * target); only the disruptiveness escalates:
 *   0. refresh-url — reload dash.js AND mint a fresh Plex transcode session at the
 *      seek offset. Fixes the dominant case (seek past the transcoder's head), and
 *      is a superset of a plain reload, so it also clears soft stalls.
 *   1. remount    — nuclear: a real React remount of the player at the intent, for
 *      a reaped session where in-place refresh leaves the <video> wedged.
 * Past the last rung the caller declares exhaustion (user-facing retry overlay).
 *
 * Kept pure (no DOM/React) so the ladder + timing are unit-testable; the hook
 * wires it to onReload. See useMediaResilience.js.
 */

// How long the player must be continuously stuck before the first jolt. Long
// enough that a legitimately-slow-but-succeeding seek/buffer isn't interrupted,
// short enough to beat the old effectively-infinite stall.
export const STALL_JOLT_GRACE_MS = 4500;
// Spacing between escalating rungs while still stuck. Generous so a jolt that IS
// recovering (fresh transcode warming up) isn't cut short by the next rung.
export const STALL_JOLT_STEP_MS = 6000;

export const STALL_JOLT_LADDER = [
  { reason: 'stall-jolt-refresh-url', refreshUrl: true, forceRemount: false },
  { reason: 'stall-jolt-remount',     refreshUrl: true, forceRemount: true },
];

/**
 * The recovery plan for a given (0-based) ladder step, or null once the ladder is
 * exhausted (caller should surface the retry overlay).
 * @param {number} step
 * @returns {{reason: string, refreshUrl: boolean, forceRemount: boolean}|null}
 */
export function stallJoltPlan(step) {
  if (!Number.isInteger(step) || step < 0) return null;
  return STALL_JOLT_LADDER[step] || null;
}

/** True once `step` is past the last rung. */
export function isStallJoltExhausted(step) {
  return Number.isInteger(step) && step >= STALL_JOLT_LADDER.length;
}
