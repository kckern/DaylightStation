// Minimum forward movement (seconds) that counts as genuine playback progress.
// Below this, a `timeupdate` is treated as jitter/seek noise rather than the
// playhead actually advancing.
export const PROGRESS_EPSILON = 0.05;

/**
 * Decide whether a `timeupdate` reflects genuine forward playback progress
 * versus a seek / recovery-nudge / DASH buffer-poke that merely fired the event.
 *
 * The media element fires `timeupdate` both when the playhead advances AND when
 * `currentTime` is assigned (seeks). Stall recovery relies on telling these
 * apart: the nudge strategy sets `currentTime -= 0.001`, which must NOT be read
 * as "playback recovered" — otherwise escalation to `reload` never happens.
 *
 * @param {number|null} pos            current playhead position (seconds)
 * @param {number|null} lastAdvancePos last position counted as real progress
 * @param {number}      epsilon        minimum forward delta to count as progress
 * @returns {{ advanced: boolean, nextPos: number|null }}
 *   advanced — true only on genuine forward motion beyond epsilon
 *   nextPos  — baseline to store next; rebaselines on backward jumps so a later
 *              forward tick is measured from the new (lower) position
 */
export function evaluatePlayheadProgress(pos, lastAdvancePos, epsilon = PROGRESS_EPSILON) {
  if (pos == null || Number.isNaN(pos)) {
    return { advanced: false, nextPos: lastAdvancePos ?? null };
  }
  if (lastAdvancePos == null) {
    return { advanced: true, nextPos: pos };
  }
  if (pos > lastAdvancePos + epsilon) {
    return { advanced: true, nextPos: pos };
  }
  // No forward progress. A backward jump (seek/nudge/reload-seekback) rebaselines
  // so the next genuine forward tick is measured from the new position.
  if (pos < lastAdvancePos) {
    return { advanced: false, nextPos: pos };
  }
  return { advanced: false, nextPos: lastAdvancePos };
}
