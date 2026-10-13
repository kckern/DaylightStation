/**
 * Recency-window picking for ArtMode.
 *
 * Uniform random-with-replacement (the old `arr[random]`) clusters and favors a
 * few works because it has no memory of what just showed. The fix is a sliding
 * no-repeat window: once an item shows it's benched from candidacy until roughly
 * `fraction` of the pool has had a turn, then it re-enters. This bounds how often
 * any one work can recur without requiring full exhaustion of the collection.
 *
 * @module domains/art/recencyWindow
 */

/**
 * Return the subset of `candidates` eligible to be picked: the full pool minus
 * the most-recently-shown `floor(fraction * n)` items. Never returns empty (the
 * bench is capped at n-1) so the screensaver can't stall on a fully-benched pool.
 *
 * @param {Array<{id:string}>} candidates - the full candidate pool
 * @param {Map<string,*>|Object} recency - id → comparable "last shown" key (e.g.
 *   ISO timestamp); absent ⇒ never shown ⇒ always eligible
 * @param {number} [fraction=0.55] - share of the pool to keep benched
 * @returns {Array<{id:string}>} the eligible candidates (a subset of `candidates`)
 */
export function eligibleByRecency(candidates, recency, fraction = 0.55) {
  const n = candidates.length;
  if (n <= 1) return candidates;
  const window = Math.min(n - 1, Math.max(0, Math.floor(fraction * n)));
  if (window === 0) return candidates;

  const at = (c) => {
    const v = typeof recency?.get === 'function' ? recency.get(c.id) : recency?.[c.id];
    return v == null ? null : v;
  };
  // Most-recently-shown first; never-shown items sort to the bottom (eligible).
  const shown = candidates
    .filter((c) => at(c) != null)
    .sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
  const benched = new Set(shown.slice(0, window).map((c) => c.id));
  const eligible = candidates.filter((c) => !benched.has(c.id));
  return eligible.length ? eligible : candidates;
}

export default { eligibleByRecency };
