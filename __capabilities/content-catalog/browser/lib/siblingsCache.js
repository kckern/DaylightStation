import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { splitContentId } from './contentSearchLogic.js';

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

export function toBrowseItem(item) {
  return {
    id: item.id,
    value: item.id,
    title: item.title,
    source: item.source,
    type: item.type || item.itemType,
    thumbnail: item.thumbnail,
    grandparent: item.grandparentTitle,
    parent: item.parentTitle,
    library: item.libraryTitle,
    itemCount: item.childCount ?? null,
    itemIndex: item.itemIndex ?? null,
    number: item.number ?? null,
    isContainer: item.isContainer || item.itemType === 'container',
  };
}

/**
 * Fetch siblings of a content id and shape the result for the shared
 * siblingsCache ({browseItems, currentParent, pagination, referenceIndex}).
 */
async function fetchSiblingsData(contentId, sourceOverride) {
  const parsed = splitContentId(contentId);
  if (!parsed?.source || !parsed.localId) return null;
  const { localId } = parsed;
  const source = sourceOverride || parsed.source;
  const data = await DaylightAPI(`/api/v1/siblings/${encodeURIComponent(source)}/${encodeURIComponent(localId)}`);
  return {
    browseItems: (data.items || []).map(toBrowseItem),
    currentParent: data.parent
      ? {
          id: data.parent.id,
          title: data.parent.title,
          source: data.parent.source || source,
          thumbnail: data.parent.thumbnail,
          parentKey: data.parent.parentId ?? null,
          libraryId: data.parent.libraryId ?? null,
        }
      : null,
    pagination: data.pagination || null,
    referenceIndex: data.referenceIndex ?? -1,
    // Root-first ancestor chain for the breadcrumb trail (optional; adapters
    // that can't build one omit it → the single-parent crumb fallback applies).
    ancestors: Array.isArray(data.ancestors) ? data.ancestors : null,
  };
}

/** A hover preload and a picker opening share the same request and ancestor trail. */
export function loadSiblings(contentId, sourceOverride) {
  const entry = getCacheEntry(contentId);
  if (entry?.status === 'loaded' && entry.data) return Promise.resolve(entry.data);
  if (entry?.promise) return entry.promise;
  const pending = { status: 'pending', data: null, promise: null };
  pending.promise = fetchSiblingsData(contentId, sourceOverride).then(data => {
    if (getCacheEntry(contentId) === pending) setCacheEntry(contentId, { status: 'loaded', data, promise: null });
    return data;
  }, error => {
    if (getCacheEntry(contentId) === pending) setCacheEntry(contentId, { status: 'error', data: null, promise: null });
    throw error;
  });
  setCacheEntry(contentId, pending);
  return pending.promise;
}
