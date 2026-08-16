/**
 * Distinct-identity churn counter.
 *
 * 2026-08-16: 480 distinct `waitKey` values appeared in three minutes while the
 * player opened 495 Plex transcode sessions in four. That cardinality explosion
 * was the clearest single tell of the whole incident, and nothing counted it —
 * the number had to be recovered afterwards by uniq-ing a log by hand.
 *
 * Two design decisions are worth stating, because the obvious versions of both
 * are wrong:
 *
 * 1. **The bucket is NOT the media item.** Bucketing per guid is the natural
 *    reading of "distinct values per item per minute", and in this incident it
 *    would have counted nothing: the guid itself was what churned, so every
 *    bucket would have held exactly one value. The bucket is therefore the
 *    Player instance (one counter per mount), and `guid` is a counted dimension
 *    rather than a key.
 *
 * 2. **One emission per episode, not per value.** A counter that fires on every
 *    distinct value fires 480 times, which is a second storm. An episode opens
 *    when any dimension crosses the threshold and closes only once every
 *    dimension has receded, so a churn burst produces exactly one line.
 */

export const CHURN_WINDOW_MS = 60000;
export const CHURN_DISTINCT_THRESHOLD = 10;

/** Dimensions counted, in report order. */
export const CHURN_DIMENSIONS = Object.freeze(['waitKey', 'guid']);

/** A dimension that was not supplied. Named, so it cannot pass as a real value. */
export const CHURN_VALUE_ABSENT = '(absent)';

const SAMPLE_LIMIT = 3;

const normalizeValue = (value) => (
  value === undefined || value === null || value === '' ? CHURN_VALUE_ABSENT : String(value)
);

/**
 * @param {object} [options]
 * @param {number} [options.windowMs=60000] rolling window
 * @param {number} [options.threshold=10] distinct values per window that count as churn
 * @returns {{ record: Function, snapshot: Function, reset: Function }}
 */
export function createIdentityChurnCounter({
  windowMs = CHURN_WINDOW_MS,
  threshold = CHURN_DISTINCT_THRESHOLD
} = {}) {
  /** dimension -> Map<value, lastSeenAtMs> */
  const seen = new Map(CHURN_DIMENSIONS.map((dim) => [dim, new Map()]));
  /** Timestamps of record() calls still inside the window. */
  let observations = [];
  /** Non-null while an episode is open — the emit-once latch. */
  let episode = null;

  const prune = (cutoff) => {
    while (observations.length && observations[0] <= cutoff) observations.shift();
    for (const values of seen.values()) {
      for (const [value, at] of values) {
        if (at <= cutoff) values.delete(value);
      }
    }
  };

  const distinctCounts = () => {
    const out = {};
    for (const dim of CHURN_DIMENSIONS) out[dim] = seen.get(dim).size;
    return out;
  };

  const samplesFor = (dim) => Array.from(seen.get(dim).entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, SAMPLE_LIMIT)
    .map(([value]) => value);

  return {
    /**
     * Record one observation of the player's identity.
     *
     * @param {{ waitKey?: *, guid?: * }} values current identity, per dimension
     * @param {number} [atMs] observation time
     * @returns {object|null} a report the FIRST time an episode opens, else null
     */
    record(values = {}, atMs = Date.now()) {
      const cutoff = atMs - windowMs;
      observations.push(atMs);
      for (const dim of CHURN_DIMENSIONS) {
        seen.get(dim).set(normalizeValue(values[dim]), atMs);
      }
      prune(cutoff);

      const distinct = distinctCounts();
      const over = CHURN_DIMENSIONS.filter((dim) => distinct[dim] > threshold);

      if (!over.length) {
        // Every dimension has receded: the episode is over and the next burst
        // gets its own line.
        episode = null;
        return null;
      }
      if (episode) {
        episode.peak = Math.max(episode.peak, ...over.map((dim) => distinct[dim]));
        return null;
      }

      episode = { startedAtMs: atMs, peak: Math.max(...over.map((dim) => distinct[dim])) };
      const samples = {};
      for (const dim of CHURN_DIMENSIONS) samples[dim] = samplesFor(dim);
      return {
        // Which dimension crossed. `guid` means the CONTENT identity is moving
        // (a caller re-minting identity); `waitKey` alone means the nonce is
        // climbing (a recovery loop). On 2026-08-16 it was both.
        churningDimensions: over,
        distinct,
        samples,
        observations: observations.length,
        windowMs,
        threshold,
        episodeStartedAtMs: atMs
      };
    },

    /** Current state without recording anything. */
    snapshot() {
      return {
        distinct: distinctCounts(),
        observations: observations.length,
        episodeOpen: episode !== null,
        episodePeak: episode ? episode.peak : null,
        windowMs,
        threshold
      };
    },

    reset() {
      for (const values of seen.values()) values.clear();
      observations = [];
      episode = null;
    }
  };
}

export default createIdentityChurnCounter;
