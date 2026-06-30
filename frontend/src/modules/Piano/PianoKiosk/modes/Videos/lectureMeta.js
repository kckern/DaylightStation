// lectureMeta.js
const num = (v) => {
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : null; }
  return Number.isFinite(v) ? v : null;
};

/** Plex content id for the Player, e.g. "plex:662039". Null if unresolved. */
export function lectureContentId(item) {
  if (!item) return null;
  if (item.plex) return `plex:${item.plex}`;
  if (typeof item.id === 'string' && /^plex:/i.test(item.id)) return item.id;
  if (typeof item.contentId === 'string') return item.contentId;
  return null;
}

/** Resume position in seconds from a /playable lecture item (0 = start). */
export function deriveResumeSeconds(item) {
  const ws = num(item?.watchSeconds);
  if (ws && ws > 0) return ws;
  const dur = num(item?.duration);
  const pct = num(item?.watchProgress);
  if (pct && pct > 0 && dur && dur > 0) {
    return Math.min(dur, (Math.max(0, Math.min(100, pct)) / 100) * dur);
  }
  return 0;
}

/**
 * Tile badge state from media_memory signals: watched flag + integer percent.
 * The backend `isWatched` flag is unreliable for generic Plex collections (it
 * comes back true with playCount 0 / progress 0), so derive "watched" from the
 * honest per-item history instead: a real completed view (playCount) or
 * near-complete progress. Otherwise show the in-progress percent (or nothing).
 */
export function lectureStatus(item) {
  const pct = num(item?.watchProgress);
  const plays = num(item?.playCount);
  const percent = pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  const watched = (plays != null && plays > 0) || percent >= 90;
  // Device-level signals carry no completion timestamp.
  return { watched, percent, completedAt: null };
}

/**
 * Per-user watch status — prefers the user-keyed fields from the piano courses
 * endpoint (userWatched/userPercent) when present, else falls back to the
 * device-level lectureStatus (Plex media-memory signals).
 */
export function lectureUserStatus(item) {
  if (item?.userPercent != null || item?.userWatched != null) {
    const pct = num(item.userPercent);
    const percent = pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
    return { watched: !!item.userWatched, percent, completedAt: item.userCompletedAt || null };
  }
  return lectureStatus(item);
}
