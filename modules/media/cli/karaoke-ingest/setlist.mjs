const HEADER = ['season', 'episode', 'artist', 'song', 'search_hint', 'status', 'video_id'];

function toIntOrNull(v) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function parseSetlist(tsv) {
  const lines = String(tsv || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const rows = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cols = line.split('\t');
    if (cols[0] === 'season' && cols[2] === 'artist') continue; // header
    const [season, episode, artist, song, searchHint, status, videoId] = cols;
    rows.push({
      season: toIntOrNull(season) ?? 0,
      episode: toIntOrNull(episode),
      artist: (artist ?? '').trim(),
      song: (song ?? '').trim(),
      searchHint: (searchHint ?? '').trim(),
      status: (status ?? 'pending').trim() || 'pending',
      videoId: (videoId ?? '').trim(),
    });
  }
  return rows;
}

export function serializeSetlist(rows) {
  const body = rows.map((r) => [
    r.season,
    r.episode ?? '',
    r.artist,
    r.song,
    r.searchHint ?? '',
    r.status ?? 'pending',
    r.videoId ?? '',
  ].join('\t'));
  return [HEADER.join('\t'), ...body].join('\n');
}
