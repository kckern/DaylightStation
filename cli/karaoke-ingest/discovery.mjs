const NOISE = /\b(karaoke|instrumental|version|lyrics|hd|official|backing track|sing along|sing-along)\b/gi;

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function hasAny(title, terms) {
  const t = normalize(title);
  return terms.some((term) => t.includes(normalize(term)));
}

export function parseSiblingEntry(e) {
  return {
    id: e.id,
    title: e.title || '',
    channel: e.channel || e.uploader || '',
    viewCount: e.view_count || 0,
    url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : ''),
  };
}

export function guessSongArtist(title) {
  let t = String(title || '').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\|.*$/, ' ');            // drop trailing "| channel ..." segments
  const parts = t.split(/\s+-\s+/);
  let artist = '';
  let song = t;
  if (parts.length >= 2) { artist = parts[0]; song = parts.slice(1).join(' - '); }
  song = song.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  artist = artist.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  return { artist, song };
}

export function filterKaraokeSiblings(entries, existingIds, cfg) {
  return (entries || [])
    .map(parseSiblingEntry)
    .filter((e) => e.id && !existingIds.has(e.id))
    .filter((e) => hasAny(e.title, cfg.karaokeTerms) && !hasAny(e.title, cfg.rejectTerms));
}

export function toCandidateRows(items, sourceVideo) {
  return items.map((e) => {
    const { song, artist } = guessSongArtist(e.title);
    return { channel: e.channel, viewCount: e.viewCount, song, artist, url: e.url, sourceVideo };
  });
}

const CAND_HEADER = ['channel', 'view_count', 'song', 'artist', 'url', 'source_video'];
export function serializeCandidates(rows) {
  const body = rows.map((r) => [r.channel, r.viewCount, r.song, r.artist, r.url, r.sourceVideo].join('\t'));
  return [CAND_HEADER.join('\t'), ...body].join('\n');
}
