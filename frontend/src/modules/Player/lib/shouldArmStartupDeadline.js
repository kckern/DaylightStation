/**
 * Determines whether the resilience startup deadline timer should be armed.
 *
 * The deadline should only arm when we have enough metadata to know what
 * media we're trying to play. Without metadata, the deadline will fire
 * for phantom/placeholder entries and trigger futile recovery attempts.
 *
 * @param {Object} params
 * @param {Object|null} params.meta - Media metadata from the player
 * @param {boolean} params.disabled - Whether resilience is disabled (e.g. titlecard)
 * @returns {boolean} true if the deadline timer should be armed
 */
export function shouldArmStartupDeadline({ meta, disabled }) {
  if (disabled) return false;
  if (!meta) return false;
  return !!(meta.mediaType || meta.mediaUrl || meta.plex
    || meta.media || meta.contentId || meta.assetId);
}
