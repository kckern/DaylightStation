/**
 * Recency-aware ordering for the "watched" pool of a resolved queue.
 *
 * Once every item in a collection has been watched (e.g. a family that has
 * cycled through every Bluey episode), the queue's unwatched/watched partition
 * collapses to a single watched bucket. Ordering that bucket by source order
 * (non-shuffle) makes playback always restart at the same early episodes, and
 * ordering it by uniform shuffle lets an episode seen minutes ago come right
 * back up. Both read to viewers as "we keep seeing the same episodes."
 *
 * This helper de-prioritizes recently-played items using their `lastPlayed`
 * timestamp — the mirror of ArtMode's `recencyWindow` for still images.
 *
 * @module domains/content/utils/recencyOrder
 */

/**
 * Read an item's comparable "last played" key from a recency lookup.
 * Absent ⇒ never played ⇒ treated as least-recently-seen (plays soonest).
 * @param {{id:string}} item
 * @param {Map<string,*>|Object} recency - id → comparable key (e.g. ISO timestamp)
 * @returns {*|null}
 */
function lastPlayedOf(item, recency) {
  const v = typeof recency?.get === 'function' ? recency.get(item.id) : recency?.[item.id];
  return v == null ? null : v;
}

/**
 * Order a pool of already-watched items so recently-played ones surface last.
 *
 * - `shuffle:false` → sort by `lastPlayed` ascending (least-recently-seen, and
 *   never-played, first). Turns "always restart at episode 1" into a rotation
 *   through the catalog.
 * - `shuffle:true` → bench the most-recently-played `fraction` of the pool,
 *   shuffle the eligible remainder to the front and the benched items to the
 *   back. Bounds how often any one item can recur without full exhaustion.
 *
 * Never drops items (a queue must still contain everything) and never throws on
 * an empty/singleton pool.
 *
 * @param {Array<{id:string}>} items - the watched pool
 * @param {Map<string,*>|Object} recency - id → `lastPlayed` comparable key
 * @param {Object} [opts]
 * @param {boolean} [opts.shuffle=false]
 * @param {number} [opts.fraction=0.55] - share of the pool to bench (shuffle mode)
 * @param {(arr:Array)=>Array} [opts.shuffleFn] - in-place shuffler (Fisher-Yates);
 *   required for deterministic tests, defaults to identity when absent
 * @returns {Array<{id:string}>} a new, reordered array (same membership)
 */
export function orderWatchedByRecency(items, recency, opts = {}) {
  const { shuffle = false, fraction = 0.55, shuffleFn } = opts;
  const n = items.length;
  if (n <= 1) return [...items];

  if (!shuffle) {
    // Least-recently-seen first; never-played (null) sorts to the very front.
    return [...items].sort((a, b) => {
      const av = lastPlayedOf(a, recency);
      const bv = lastPlayedOf(b, recency);
      if (av == null && bv == null) return 0;
      if (av == null) return -1;
      if (bv == null) return 1;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  const sh = typeof shuffleFn === 'function' ? shuffleFn : (arr) => arr;
  const window = Math.min(n - 1, Math.max(0, Math.floor(fraction * n)));
  if (window === 0) return sh([...items]);

  // Most-recently-played first; never-played items are never benched.
  const shown = items
    .filter((it) => lastPlayedOf(it, recency) != null)
    .sort((a, b) => {
      const av = lastPlayedOf(a, recency);
      const bv = lastPlayedOf(b, recency);
      return av < bv ? 1 : av > bv ? -1 : 0;
    });
  const benched = new Set(shown.slice(0, window).map((it) => it.id));
  const eligible = items.filter((it) => !benched.has(it.id));
  const benchedItems = items.filter((it) => benched.has(it.id));
  return [...sh([...eligible]), ...sh([...benchedItems])];
}

export default { orderWatchedByRecency };
