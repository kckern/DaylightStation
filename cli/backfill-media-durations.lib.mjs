/**
 * Pure computation functions for media data backfill.
 * No I/O, no side effects — all testable.
 */

/**
 * Compute session end time in unix milliseconds.
 * @param {Object} session - session block from YAML (has `start`, `duration_seconds`)
 * @returns {number|null} end time in ms, or null if data is missing
 */
export function computeSessionEndMs(session) {
  if (!session?.start || !session?.duration_seconds) return null;
  const startMs = new Date(session.start).getTime();
  if (isNaN(startMs)) return null;
  return startMs + (session.duration_seconds * 1000);
}

/**
 * Find timeline media events with broken end timestamps.
 * "Broken" means: null, undefined, or within 1 second of start (same tick).
 *
 * @param {Array} events - timeline.events array from session YAML
 * @returns {Array} events that need end timestamp fixing
 */
export function findBrokenEndEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(evt => {
    if (evt.type !== 'media') return false;
    const { start, end } = evt.data || {};
    if (end === null || end === undefined) return true;
    if (typeof start === 'number' && typeof end === 'number' && Math.abs(end - start) < 1000) return true;
    return false;
  });
}

/**
 * Find timeline media events that have stale durationSeconds values.
 *
 * @param {Array} events - timeline.events array
 * @param {Object} fixMap - { contentId: { source: 'plex'|'session' } }
 * @returns {Array} events with contentId in the fixMap
 */
export function findStaleDurationEvents(events, fixMap) {
  if (!Array.isArray(events) || !fixMap) return [];
  return events.filter(evt => {
    if (evt.type !== 'media') return false;
    const cid = evt.data?.contentId;
    return cid && fixMap[cid];
  });
}
