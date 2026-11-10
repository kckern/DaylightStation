/**
 * Bikes whose rider claim is old and whose pedals have not turned since.
 * A bike with no rider, or with no known last-active time, is never stale.
 *
 * @param {Array<{id: string, rider?: *, lastActiveMs?: number|null}>} [bikes]
 * @param {number} nowMs
 * @param {number} [maxIdleMs] default 30 minutes
 * @returns {string[]} ids of stale bikes; [] when nowMs is not finite
 */
export function staleClaims(bikes = [], nowMs, maxIdleMs = 30 * 60 * 1000) {
  if (!Number.isFinite(nowMs) || !Array.isArray(bikes)) return [];
  return bikes
    .filter((b) => b && b.rider && Number.isFinite(b.lastActiveMs) && nowMs - b.lastActiveMs > maxIdleMs)
    .map((b) => b.id);
}

export default staleClaims;
