// frontend/src/modules/Admin/ContentLists/siblingsCache.js

/**
 * Module-level cache for preloaded siblings data.
 * Stores processed {browseItems, currentParent} ready for immediate use.
 */
const siblingsCache = new Map();
// Key: itemId (e.g., "plex:12345")
// Value: {
//   status: 'pending' | 'loaded' | 'error',
//   data: { browseItems, currentParent } | null,
//   promise: Promise | null
// }

export function getCacheEntry(itemId) {
  return siblingsCache.get(itemId);
}

export function setCacheEntry(itemId, entry) {
  siblingsCache.set(itemId, entry);
}

export function hasCacheEntry(itemId) {
  return siblingsCache.has(itemId);
}

export function clearCache() {
  siblingsCache.clear();
}
