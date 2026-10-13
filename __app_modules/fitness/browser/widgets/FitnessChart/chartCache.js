/**
 * chartCache — rules for the live race chart's per-participant cache when a
 * strap is reassigned mid-session.
 *
 * A correction moves a stint's series from one person to another. Without
 * these rules the chart kept the old person's cached entry (a stranded
 * "absent" badge and legend entry pointing at data that now belongs to someone
 * else), and drew a "rejoined" marker on the new owner's line where no dropout
 * ever happened.
 */

/**
 * A rejoin marker belongs where the person actually stopped broadcasting: the
 * tick right after they were last seen must be inactive. A stint moved back to
 * them continuously has no such gap.
 *
 * @param {{ lastSeenTick?: number, lastValue?: number|null }|null} prevEntry
 * @param {{ active?: boolean[] }} entry
 * @returns {boolean}
 */
export function shouldMarkRejoin(prevEntry, entry) {
  if (!prevEntry || prevEntry.lastValue == null) return false;
  const last = prevEntry.lastSeenTick ?? -1;
  if (last < 0) return false;
  const active = Array.isArray(entry?.active) ? entry.active : [];
  return active[last + 1] === false;
}

/**
 * Does this person still own any heart-rate samples? After a correction moved
 * their stint away, they own none and should leave the chart entirely.
 *
 * @param {Function|null} getSeries - (id, metric) => array
 * @param {string} id
 * @returns {boolean} true when unknown (no getter) so nothing is dropped blindly
 */
export function hasHeartRateData(getSeries, id) {
  if (typeof getSeries !== 'function') return true;
  const hr = getSeries(id, 'heart_rate', { clone: false }) || [];
  return hr.some((v) => Number.isFinite(v) && v > 0);
}
