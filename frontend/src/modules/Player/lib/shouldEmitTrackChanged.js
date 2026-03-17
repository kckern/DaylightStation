/**
 * Determines whether a queue-track-changed event should be emitted.
 *
 * Phantom entries (created before queue API response) have a guid but
 * no title, mediaType, or content identifiers. Emitting track-changed
 * for these creates stale Player state and orphan resilience timers.
 *
 * @param {Object|null} item - Queue item to check
 * @returns {boolean} true if the track-changed event should be emitted
 */
export function shouldEmitTrackChanged(item) {
  if (!item) return false;
  if (!item.guid) return false;
  return !!(item.title || item.mediaType || item.mediaUrl
    || item.media || item.plex || item.contentId || item.assetId);
}
