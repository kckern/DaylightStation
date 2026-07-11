export function sanitizeSegment(s) {
  return String(s)
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function buildEpisodeFilename({ show, season, episode, song, artist }) {
  const base = `${sanitizeSegment(show)} - S${pad2(season)}E${pad2(episode)} - ${sanitizeSegment(song)} (${sanitizeSegment(artist)})`;
  return `${base}.mp4`;
}

export function assignEpisodes(rows) {
  const maxBySeason = {};
  for (const r of rows) {
    if (r.episode) maxBySeason[r.season] = Math.max(maxBySeason[r.season] || 0, r.episode);
  }
  return rows.map((r) => {
    if (r.episode) return r;
    const next = (maxBySeason[r.season] || 0) + 1;
    maxBySeason[r.season] = next;
    return { ...r, episode: next };
  });
}
