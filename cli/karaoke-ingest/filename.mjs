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
  const nextBySeason = {};

  return rows.map((r) => {
    if (r.episode) {
      maxBySeason[r.season] = Math.max(maxBySeason[r.season] || 0, r.episode);
      return r;
    }

    // This is a null, assign a number
    if (maxBySeason[r.season] !== undefined) {
      // We've already seen an explicit episode in this season
      maxBySeason[r.season]++;
      return { ...r, episode: maxBySeason[r.season] };
    } else {
      // No explicit episodes seen yet in this season
      if (!nextBySeason[r.season]) nextBySeason[r.season] = 1;
      return { ...r, episode: nextBySeason[r.season]++ };
    }
  });
}
