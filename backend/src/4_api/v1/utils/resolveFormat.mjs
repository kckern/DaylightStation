/**
 * Resolve content format from item and adapter.
 *
 * Priority chain:
 * 1. Item-level override (item.metadata.contentFormat)
 * 2. Adapter default (adapter.contentFormat getter)
 * 3. Media type (item.mediaType — e.g., 'audio', 'video')
 * 4. Container detection (no mediaUrl + has children → 'list')
 * 5. Fallback: 'video'
 *
 * @param {Object} item - Content item from adapter
 * @param {Object} [adapter] - Content adapter instance
 * @returns {string} Content format string
 */
export function resolveFormat(item, adapter) {
  // Explicit format from metadata or adapter
  if (item.metadata?.contentFormat) return item.metadata.contentFormat;
  if (adapter?.contentFormat) return adapter.contentFormat;

  // Infer from media type
  if (item.mediaType) return item.mediaType;

  // Container detection: no media URL but has children
  const isContainer = item.itemType === 'container'
    || item.metadata?.childCount > 0
    || (item.items && item.items.length > 0);
  if (!item.mediaUrl && isContainer) return 'list';

  return 'video';
}
