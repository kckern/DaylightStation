/**
 * Resolve content format from item and adapter.
 *
 * Priority chain:
 * 1. Item-level override (item.metadata.contentFormat)
 * 2. Adapter default (adapter.contentFormat getter)
 * 3. Media type (item.mediaType — e.g., 'audio', 'video')
 * 4. Fallback: 'video'
 *
 * @param {Object} item - Content item from adapter
 * @param {Object} [adapter] - Content adapter instance
 * @returns {string} Content format string
 */
export function resolveFormat(item, adapter) {
  return item.metadata?.contentFormat
    || adapter?.contentFormat
    || item.mediaType
    || 'video';
}
