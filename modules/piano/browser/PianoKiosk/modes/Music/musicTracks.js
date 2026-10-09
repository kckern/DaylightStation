// Pure mappers for the Music mode. No DOM.

/**
 * Map a /api/v1/queue response to playable music tracks, dropping unplayable
 * items. Plex audio hierarchy: grandparentTitle = artist, parentTitle = album.
 */
export function toMusicTracks(queueResponse) {
  const items = queueResponse?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && it.mediaUrl)
    .map((it, i) => ({
      contentId: it.contentId || it.id || null,
      mediaUrl: it.mediaUrl,
      title: it.title || '',
      artist: it.artist || it.grandparentTitle || '',
      album: it.album || it.parentTitle || '',
      duration: Number.isFinite(it.duration) ? it.duration : null,
      image: it.image || it.thumbnail || null,
      index: i + 1,
    }));
}

/** mm:ss (or h:mm:ss) for a seconds value. */
export function formatTime(s) {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
}
