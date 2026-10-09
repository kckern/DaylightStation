/**
 * Determines if a resilience reload should be skipped because the
 * current activeSource is a phantom/unresolvable entry.
 *
 * Phantom entries are created during the queue loading race condition:
 * the queue controller emits a placeholder before the API response
 * arrives. These have no mediaType, no media URL, no content identifiers.
 * Attempting recovery on them always fails and can destroy working playback.
 *
 * @param {Object} params
 * @param {Object|null} params.activeSource - Current queue item
 * @param {string|null} params.playerType - Resolved player type (video/audio/etc.)
 * @param {Object|null} params.resolvedMeta - Resolved metadata from SinglePlayer
 * @returns {boolean} true if reload should be skipped
 */
export function shouldSkipResilienceReload({ activeSource, playerType, resolvedMeta }) {
  if (!activeSource) return true;
  if (playerType) return false;
  if (resolvedMeta?.mediaType || resolvedMeta?.mediaUrl || resolvedMeta?.plex) return false;
  if (activeSource.mediaType || activeSource.mediaUrl || activeSource.media
      || activeSource.plex || activeSource.contentId) return false;
  return true;
}
