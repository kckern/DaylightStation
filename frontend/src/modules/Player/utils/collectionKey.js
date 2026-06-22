/**
 * Derive a stable "collection" identity for rate persistence: the show/season
 * (TV/lectures, via grandparentTitle/parentTitle) or artist/album (music). Stable
 * across the episodes/tracks of one collection, so advancing keeps the rate; a
 * different collection gets its own. Returns null when there's no collection
 * metadata (caller falls back to its default session scope).
 *
 * @param {Object|null} meta - effectiveMeta of the current item
 * @returns {string|null}
 */
export function resolveCollectionKey(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const norm = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
  const top = norm(meta.grandparentTitle) || norm(meta.artist);
  const mid = norm(meta.parentTitle) || norm(meta.album);
  const parts = [top, mid].filter(Boolean);
  return parts.length ? parts.join('/') : null;
}
