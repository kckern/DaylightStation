// frontend/src/modules/Admin/ContentLists/siblingsCache.js

/**
 * Module-level cache for preloaded siblings data.
 * Stores processed {browseItems, currentParent} ready for immediate use.
 */
const siblingsCache = new Map();
// Key: contentId (e.g., "plex:12345")
// Value: {
//   status: 'pending' | 'loaded' | 'error',
//   data: { browseItems, currentParent } | null,
//   promise: Promise | null
// }

export function getCacheEntry(contentId) {
  return siblingsCache.get(contentId);
}

export function setCacheEntry(contentId, entry) {
  siblingsCache.set(contentId, entry);
}

export function hasCacheEntry(contentId) {
  return siblingsCache.has(contentId);
}

export function clearCache() {
  siblingsCache.clear();
}
