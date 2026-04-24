/**
 * Sort a playlist's flat item list by rating DESCENDING (highest first).
 * Prefers `userRating` (user's personal rating) over `rating` (global/audience).
 * Missing/non-numeric ratings sort last. Preserves original order for ties
 * (stable sort — Array.prototype.sort has been stable since ES2019).
 *
 * @param {Object[]} items
 * @returns {Object[]} new sorted array (does not mutate input)
 */
export function sortPlaylistByRating(items) {
  if (!Array.isArray(items) || items.length <= 1) return items || [];
  const ratingOf = (it) => {
    const r = it?.userRating ?? it?.rating;
    const n = Number(r);
    return Number.isFinite(n) ? n : -Infinity;
  };
  return [...items].sort((a, b) => ratingOf(b) - ratingOf(a));
}

/**
 * Build virtual season groups from a flat playlist item list.
 * Used by FitnessShow to paginate playlists that have no real seasons.
 *
 * @param {Object[]} items - Flat array of playlist items
 * @param {number} pageSize - Number of items per virtual season
 * @param {Object} [options] - Optional configuration
 * @param {function} [options.resolveShowImage] - (grandparentId) => imageUrl
 * @param {boolean} [options.sortByRating] - Sort items by rating DESC before chunking
 * @returns {{ parents: Object, items: Object[] }} Virtual parents map and items with parentId assigned
 */
export function buildVirtualSeasons(items, pageSize, options = {}) {
  if (!items || items.length === 0) {
    return { parents: {}, items: [] };
  }

  const { resolveShowImage, sortByRating = false } = options;

  // Optional rating sort BEFORE pagination — top-starred episodes land in
  // the first virtual season and in index-1 position within that season.
  const working = sortByRating ? sortPlaylistByRating(items) : items;

  // First pass: group items into pages
  const pages = [];
  for (let i = 0; i < working.length; i += pageSize) {
    pages.push(working.slice(i, i + pageSize));
  }

  // Pick unique show thumbnails per season (avoid reusing same show poster)
  const usedShowIds = new Set();
  const seasonThumbnails = pages.map((pageItems) => {
    // Try to find a show not yet used
    for (const item of pageItems) {
      const gpId = item.grandparentId;
      if (gpId && !usedShowIds.has(String(gpId))) {
        usedShowIds.add(String(gpId));
        return resolveShowImage ? resolveShowImage(gpId) : null;
      }
    }
    // All shows in this page already used; pick the first with a grandparentId
    const fallback = pageItems.find(item => item.grandparentId);
    return fallback && resolveShowImage ? resolveShowImage(fallback.grandparentId) : null;
  });

  const parents = {};
  const tagged = working.map((item, i) => {
    const pageNum = Math.floor(i / pageSize);
    const seasonNum = pageNum + 1; // Start at 1 so season 0 sort-to-end logic doesn't apply
    const virtualId = `virtual-season-${seasonNum}`;
    const start = pageNum * pageSize + 1;
    const end = Math.min(start + pageSize - 1, working.length);

    if (!parents[virtualId]) {
      parents[virtualId] = {
        index: seasonNum,
        title: `${start}\u2013${end}`,
        thumbnail: seasonThumbnails[pageNum] || null
      };
    }

    // Prefix label with show name for playlist episodes
    const showName = item.grandparentTitle;
    const epTitle = item.label || item.title;
    const prefixedLabel = showName ? `${showName}\u2014${epTitle}` : epTitle;

    return { ...item, label: prefixedLabel, parentId: virtualId, parentIndex: seasonNum };
  });

  return { parents, items: tagged };
}
