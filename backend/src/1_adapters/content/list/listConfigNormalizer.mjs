// backend/src/1_adapters/content/list/listConfigNormalizer.mjs

/**
 * Normalize YAML list item input field.
 * Handles the space-after-colon YAML quirk and semicolon composites.
 * "plex: 663846; overlay: 440630" → "plex:663846;overlay:440630"
 * @param {string} input
 * @returns {string}
 */
function normalizeInput(input) {
  if (!input) return '';
  // Normalize each semicolon-separated segment: trim and collapse space after first colon
  return input
    .split(';')
    .map(seg => seg.trim().replace(/^(\w+):\s+/, '$1:'))
    .join(';');
}

/**
 * Normalize a single list config item from old format to action-as-key format.
 *
 * Old format (menu/program): { label, input, action }
 * Old format (watchlist):    { title, src, media_key }
 * New format:                { title, play|open|display|list|queue }
 *
 * Items already in new format (with play/open/display/list/queue keys) pass through.
 *
 * @param {Object} item - Raw YAML list item
 * @returns {Object} Normalized item
 */
export function normalizeListItem(item) {
  if (!item) return item;

  // Already new format — pass through
  if (item.play || item.open || item.display || item.list || item.queue) {
    return { ...item };
  }

  const result = {};

  // ── Title ───────────────────────────────────────────────
  result.title = item.title || item.label;

  // ── Watchlist format: src + media_key ───────────────────
  if (item.src && item.media_key != null) {
    const contentId = `${item.src}:${String(item.media_key)}`;
    result.play = { contentId };

    // Watchlist-specific fields
    if (item.program != null) result.program = item.program;
    if (item.priority != null) result.priority = item.priority;
    if (item.wait_until != null) result.wait_until = item.wait_until;
    if (item.skip_after != null) result.skip_after = item.skip_after;
    if (item.watched != null) result.watched = item.watched;
    if (item.progress != null) result.progress = item.progress;
    if (item.summary != null) result.summary = item.summary;
    if (item.hold != null) result.hold = item.hold;
    if (item.assetId != null) result.assetId = item.assetId;
    if (item.playable != null) result.playable = item.playable;
  }

  // ── Menu/program format: input + action ─────────────────
  else if (item.input) {
    const normalized = normalizeInput(item.input);
    const action = (item.action || 'Play').toLowerCase();

    switch (action) {
      case 'open': {
        // Extract local part after "app:" prefix (or use raw if no prefix)
        const colonIdx = normalized.indexOf(':');
        result.open = colonIdx >= 0 ? normalized.slice(colonIdx + 1) : normalized;
        break;
      }
      case 'display':
        result.display = { contentId: normalized };
        break;
      case 'list':
        result.list = { contentId: normalized };
        break;
      case 'queue':
        result.queue = { contentId: normalized };
        break;
      default: // 'play' or unrecognized
        result.play = { contentId: normalized };
        break;
    }
  }

  // ── Common fields ───────────────────────────────────────
  if (item.uid != null) result.uid = item.uid;
  if (item.image != null) result.image = item.image;
  if (item.fixed_order != null) result.fixed_order = item.fixed_order;
  if (item.active != null) result.active = item.active;
  if (item.continuous != null) result.continuous = item.continuous;
  if (item.shuffle != null) result.shuffle = item.shuffle;
  if (item.playbackrate != null) result.playbackrate = item.playbackrate;
  if (item.days != null) result.days = item.days;
  if (item.applySchedule != null) result.applySchedule = item.applySchedule;

  return result;
}

/**
 * Extract the content ID string from a normalized list item.
 * Checks action keys (play/list/queue/display/open) and falls back to legacy input.
 * @param {Object} item - Normalized list item
 * @returns {string} Content ID or empty string
 */
export function extractContentId(item) {
  if (!item) return '';
  return item.input
    || item.play?.contentId
    || item.list?.contentId
    || item.queue?.contentId
    || item.display?.contentId
    || (item.open ? `app:${item.open}` : '')
    || '';
}
