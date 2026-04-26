// backend/src/3_applications/fitness/playlistSorter.mjs

/**
 * Playlist-as-show sort pipeline (mirrors frontend playlistVirtualSeasons.js).
 *
 * Applied server-side so non-frontend consumers (CLI, other clients) get the
 * same grab-bag ordering. Frontend re-runs the same pipeline for defense in
 * depth — running the sort twice is safe (dedupe is idempotent, and the second
 * shuffle just produces a different-but-equally-valid tier ordering).
 *
 * Pipeline:
 *   1. Dedupe by id (or ratingKey/key fallback) — first occurrence wins
 *   2. Fisher-Yates shuffle
 *   3. Stable sort by userRating DESCENDING
 *
 * Result: highest-starred items pinned at the top, same-tier items shuffled
 * into a different grab-bag on each call. Only applies when the container is
 * a Plex playlist; ordinary shows return unchanged.
 */

/**
 * Fisher-Yates shuffle (returns a new array; does not mutate input).
 * @param {Array} arr
 * @returns {Array}
 */
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Extract the userRating from a playable item. Returns -Infinity if absent so
 * unrated items sort to the bottom under DESC ordering.
 * @param {Object} item
 * @returns {number}
 */
function ratingOf(item) {
  // Check top-level first (our toListItem contract), then metadata fallback.
  const r = item?.userRating ?? item?.metadata?.userRating;
  const n = Number(r);
  return Number.isFinite(n) ? n : -Infinity;
}

/**
 * Pick a stable dedup key from an item. Prefers compound id, falls back to
 * ratingKey/key/localId.
 * @param {Object} item
 * @returns {string|number|null}
 */
function dedupKey(item) {
  return item?.id ?? item?.ratingKey ?? item?.key ?? item?.localId ?? null;
}

/**
 * Dedupe by id (first occurrence wins), shuffle, then stable sort userRating DESC.
 * Non-mutating; returns a new array.
 *
 * @param {Object[]} items
 * @returns {Object[]}
 */
export function sortPlaylistItems(items) {
  if (!Array.isArray(items) || items.length <= 1) return items ? [...items] : [];

  // Dedupe
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const key = dedupKey(it);
    if (key != null && seen.has(key)) continue;
    if (key != null) seen.add(key);
    deduped.push(it);
  }

  // Shuffle, then stable sort — equal-rated items keep their shuffled order.
  return shuffle(deduped).sort((a, b) => ratingOf(b) - ratingOf(a));
}

/**
 * @param {Object} containerInfo - The container metadata (info object)
 * @returns {boolean}
 */
export function isPlaylist(containerInfo) {
  return containerInfo?.type === 'playlist';
}
