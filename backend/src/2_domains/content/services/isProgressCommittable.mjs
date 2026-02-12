/**
 * isProgressCommittable — Pure domain function
 *
 * Determines whether a progress update should be trusted and persisted,
 * or treated as browsing/seeking that hasn't been proven yet.
 *
 * Rules:
 *   1. Small jump (|newPlayhead - lastCommittedPlayhead| <= 300s):
 *      Always committable. Covers chapter skips, 30-second buttons,
 *      and normal playback drift.
 *
 *   2. Large jump (> 300s): Enter skeptical mode.
 *      The listener must accumulate >= 60s of continuous watch time
 *      at the new position before the jump is trusted.
 *      This prevents browse-ahead, accidental seeks, and sleep-through
 *      from corrupting the real listening position.
 *
 * @param {Object} params
 * @param {number} params.sessionWatchTime    - Seconds of continuous listening at the new position
 * @param {number} params.lastCommittedPlayhead - Last trusted playhead (seconds)
 * @param {number} params.newPlayhead          - Proposed new playhead (seconds)
 * @returns {{ committable: true } | { committable: false, skeptical: true }}
 */
export function isProgressCommittable({ sessionWatchTime, lastCommittedPlayhead, newPlayhead }) {
  const SMALL_JUMP_THRESHOLD = 300;  // 5 minutes
  const SKEPTICAL_WATCH_REQUIREMENT = 60;  // 1 minute of continuous listening

  const jumpDistance = Math.abs(newPlayhead - lastCommittedPlayhead);

  // Small jumps are always trusted
  if (jumpDistance <= SMALL_JUMP_THRESHOLD) {
    return { committable: true };
  }

  // Large jump — require proof of intent via watch time
  if (sessionWatchTime >= SKEPTICAL_WATCH_REQUIREMENT) {
    return { committable: true };
  }

  return { committable: false, skeptical: true };
}

export default isProgressCommittable;
