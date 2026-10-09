// backend/src/3_applications/fitness/playlistSorter.mjs

/**
 * Playlist product policy: first-wins deduplication, randomized ordering inside
 * equal-rating tiers, and highest-rating-first presentation.
 */

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function ratingOf(item) {
  const rating = item?.userRating ?? item?.metadata?.userRating;
  const number = Number(rating);
  return Number.isFinite(number) ? number : -Infinity;
}

function dedupKey(item) {
  return item?.id ?? item?.ratingKey ?? item?.key ?? item?.localId ?? null;
}

/**
 * @param {Object[]} items
 * @param {Object} [options]
 * @param {() => number} [options.random] injectable entropy source
 */
export function sortPlaylistItems(items, { random = Math.random } = {}) {
  if (!Array.isArray(items) || items.length <= 1) return items ? [...items] : [];

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = dedupKey(item);
    if (key != null && seen.has(key)) continue;
    if (key != null) seen.add(key);
    deduped.push(item);
  }

  return shuffle(deduped, random).sort((a, b) => ratingOf(b) - ratingOf(a));
}

export function isPlaylist(containerInfo) {
  return containerInfo?.type === 'playlist';
}
