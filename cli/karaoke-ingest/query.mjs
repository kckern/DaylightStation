export function pinnedUrl(row) {
  const h = (row.searchHint || '').trim();
  return /^https?:\/\//i.test(h) ? h : null;
}

export function buildSearchQuery(row) {
  if (pinnedUrl(row)) return null;
  const hint = (row.searchHint || '').trim();
  const q = `${row.song} ${row.artist} karaoke${hint ? ` ${hint}` : ''}`;
  return q.replace(/\s+/g, ' ').trim();
}

export function buildSearchArgv(query, { searchCount }) {
  return ['--js-runtimes', 'node', '-J', '--flat-playlist', '--no-warnings', `ytsearch${searchCount}:${query}`];
}

export function extractVideoId(url) {
  const m1 = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url);
  if (m1) return m1[1];
  const m2 = /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  if (m2) return m2[1];
  return '';
}
