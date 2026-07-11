export function parseSeedTsv(tsv) {
  const lines = String(tsv || '').split('\n').map((l) => l.replace(/\r$/, ''));
  const rows = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cols = line.split('\t');
    if (/artist\s*\/\s*source/i.test(cols[0] || '')) continue; // header
    const [artist, song, category, feature] = cols;
    rows.push({
      artist: (artist ?? '').trim(),
      song: (song ?? '').trim(),
      category: (category ?? '').trim(),
      feature: (feature ?? '').trim(),
    });
  }
  return rows;
}

export function convertSeed(seedRows, resolveSeasonFn) {
  const rows = [];
  const unmatched = [];
  for (const s of seedRows) {
    const season = resolveSeasonFn(s.category);
    if (season == null) { unmatched.push(s); continue; }
    rows.push({ season, episode: null, artist: s.artist, song: s.song, searchHint: '', status: 'pending', videoId: '' });
  }
  return { rows, unmatched };
}
