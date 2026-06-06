/**
 * Leader-anchored logarithmic vertical scale for the distance chart.
 *
 * The old scale logged `D - d` (distance below the far window top), so its steep
 * region sat in the empty top of the window — bunched leaders barely separated.
 * This anchors the expansion at the LEADER: gap behind the leader `g = leaderM - d`
 * is log-compressed with a small metre-scale `k`, so the first few metres behind
 * the leader get the most vertical pixels (expand the front, compress the back).
 *
 * @param {number} d        rider's absolute distance (m)
 * @param {number} leaderM  furthest rider's distance (m) — pinned to frac 1 (top)
 * @param {number} trailM   trailing rider's distance (m) — maps to frac 0 (bottom)
 * @param {number} [k=4]    metres at which compression sets in (smaller = more front expansion)
 * @returns {number} fraction in [0,1]; 1 = top (leader), 0 = bottom (trailing)
 */
export function gapFrac(d, leaderM, trailM, k = 4) {
  const span = Math.max(1, (leaderM || 0) - (trailM || 0));
  const g = Math.max(0, (leaderM || 0) - (d || 0));
  const depth = Math.log1p(g / k) / Math.log1p(span / k);
  const frac = 1 - depth;
  return Math.max(0, Math.min(1, frac));
}
