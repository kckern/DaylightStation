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

/** Tile badge state: watched flag + integer percent [0..100]. */
export function lectureStatus(item) {
  const pct = num(item?.watchProgress);
  return {
    watched: Boolean(item?.isWatched),
    percent: pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
  };
}
