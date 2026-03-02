/**
 * Build virtual season groups from a flat playlist item list.
 * Used by FitnessShow to paginate playlists that have no real seasons.
 *
 * @param {Object[]} items - Flat array of playlist items
 * @param {number} pageSize - Number of items per virtual season
 * @returns {{ parents: Object, items: Object[] }} Virtual parents map and items with parentId assigned
 */
export function buildVirtualSeasons(items, pageSize) {
  if (!items || items.length === 0) {
    return { parents: {}, items: [] };
  }

  const parents = {};
  const tagged = items.map((item, i) => {
    const pageNum = Math.floor(i / pageSize);
    const virtualId = `virtual-season-${pageNum}`;
    const start = pageNum * pageSize + 1;
    const end = Math.min(start + pageSize - 1, items.length);

    if (!parents[virtualId]) {
      parents[virtualId] = {
        index: pageNum,
        title: `${start}\u2013${end}`,
        thumbnail: null
      };
    }

    return { ...item, parentId: virtualId, parentIndex: pageNum };
  });

  return { parents, items: tagged };
}
