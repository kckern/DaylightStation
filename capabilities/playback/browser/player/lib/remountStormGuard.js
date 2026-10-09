/**
 * Rate limiter for player-key changes.
 *
 * Every change of the SinglePlayer React key tears down the media element and
 * builds a new one — for Plex DASH that means a brand-new transcode session.
 * On 2026-08-16 an identity-churn bug turned that into 495 sessions in four
 * minutes against one lecture, two of them streaming the same audio 86ms apart.
 * Almost none of those remounts went through the explicit remount path: the key
 * changed and React reconciliation did the rest, so the brake has to sit on the
 * key itself.
 *
 * The guard admits key changes until more than `maxMounts` distinct keys appear
 * inside `windowMs`, then trips. A tripped guard stays tripped until `reset()`,
 * so the caller can freeze the key and surface an error instead of hammering the
 * media server. Repeating a key it already admitted is free — a re-render that
 * lands on the same key costs nothing, and only a CHANGE is a remount.
 *
 * Time is passed in rather than read, so this is deterministic under test.
 */
export function createRemountStormGuard({ maxMounts = 6, windowMs = 30000 } = {}) {
  let stamps = [];
  let lastKey = null;
  let isTripped = false;

  return {
    /**
     * @param {string} key - the candidate player key
     * @param {number} now - milliseconds (Date.now() in production)
     * @returns {boolean} true if the key change may proceed
     */
    admit(key, now) {
      if (isTripped) return false;
      if (key === lastKey) return true;   // re-render with the same key is free
      lastKey = key;
      stamps = stamps.filter((t) => now - t < windowMs);
      stamps.push(now);
      if (stamps.length > maxMounts) {
        isTripped = true;
        return false;
      }
      return true;
    },
    tripped() { return isTripped; },
    reset() { stamps = []; lastKey = null; isTripped = false; },
  };
}

export default createRemountStormGuard;
