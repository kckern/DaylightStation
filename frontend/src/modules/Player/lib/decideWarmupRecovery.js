/**
 * decideWarmupRecovery — classify a transcode-warmup (0-byte fragment) episode and
 * pick how long to wait before escalating to a recovery, plus which reason to use.
 *
 * Two distinct failure modes present identically as "0-byte fragments" but need
 * very different deadlines:
 *
 *  - STARTUP warmup: a fresh Plex transcode spinning up near the start position.
 *    Transient — it resolves on its own within a few seconds once the encoder
 *    catches up. Ride it out with a long (60s) safety deadline.
 *
 *  - SEEK-STALL warmup: a mid-playback FORWARD seek landed beyond the transcoder's
 *    head, so Plex serves empty fragments for a region the current session will
 *    never produce. This does NOT self-resolve — the session must be restarted at
 *    the seek offset (URL refresh). Escalate fast (a few seconds), not after 60s.
 *
 * The discriminator: we've already played (so it's not startup) AND a seek happened
 * very recently (so the empty fragments are the seek's fault, not a cold encoder).
 * See docs/reference/player/playback-encoding-resilience.md.
 */

export const STARTUP_WARMUP_DEADLINE_MS = 60000;
export const SEEK_STALL_WARMUP_DEADLINE_MS = 5000;
// A warmup counts as seek-induced only if a seek started within this window.
export const RECENT_SEEK_WINDOW_MS = 12000;

/**
 * @param {object} args
 * @param {boolean} args.hasEverPlayed  true once the media has produced real progress
 * @param {number}  args.msSinceLastSeek ms since the last seek STARTED (Infinity/NaN if none)
 * @returns {{kind: 'seek-stall'|'startup', deadlineMs: number, reason: string}}
 */
export function decideWarmupRecovery({ hasEverPlayed, msSinceLastSeek } = {}) {
  const recentlySeeked =
    Number.isFinite(msSinceLastSeek) && msSinceLastSeek >= 0 && msSinceLastSeek < RECENT_SEEK_WINDOW_MS;
  if (hasEverPlayed && recentlySeeked) {
    return {
      kind: 'seek-stall',
      deadlineMs: SEEK_STALL_WARMUP_DEADLINE_MS,
      reason: 'seek-stall-transcode-warming',
    };
  }
  return {
    kind: 'startup',
    deadlineMs: STARTUP_WARMUP_DEADLINE_MS,
    reason: 'startup-deadline-exceeded-after-warmup',
  };
}
