// karaokeBrowse.js — pure helpers for the Karaoke song browser. No React, no API
// calls: parse the /playable response into flat, filterable song rows.

/**
 * Split a Plex karaoke title "Song (Artist)" into { song, artist }. The artist
 * is whatever sits inside the LAST "(...)" pair that closes the string — so a
 * title with a parenthetical in the song itself, e.g. "My Way (Live) (Frank
 * Sinatra)", still resolves to song "My Way (Live)" / artist "Frank Sinatra".
 * No trailing "(...)" at all → the whole title is the song, artist ''.
 */
export function parseSongTitle(title) {
  const str = String(title || '').trim();
  if (!str.endsWith(')')) return { song: str, artist: '' };
  const openIdx = str.lastIndexOf(' (');
  if (openIdx === -1) return { song: str, artist: '' };
  return {
    song: str.slice(0, openIdx).trim(),
    artist: str.slice(openIdx + 2, str.length - 1).trim(),
  };
}

/**
 * Flatten /playable `items` into song rows: { id, song, artist, category }.
 * `category` is the Plex season title (the karaoke genre, e.g. "Piano Men").
 */
export function parseSongs(items) {
  return (items || []).map((item) => {
    const { song, artist } = parseSongTitle(item?.title);
    return {
      id: item?.id,
      song,
      artist,
      category: item?.parentTitle || '',
    };
  });
}

/**
 * Ordered category labels from /playable `parents` (one per season), sorted by
 * the Plex season index so tabs read in the show's authored order.
 */
export function categoriesOf(parents) {
  return Object.values(parents || {})
    .slice()
    .sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
    .map((p) => p?.title)
    .filter(Boolean);
}

/**
 * Filter + sort song rows for display. A non-empty `query` searches song OR
 * artist (case-insensitive substring) across ALL songs, ignoring `category`.
 * With no query, `category` narrows the set ('All' or falsy = everything).
 * Always returns alphabetical-by-song (case-insensitive).
 */
export function filterSongs(songs, { query, category } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let list = songs || [];
  if (q) {
    list = list.filter(
      (s) => s.song.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
    );
  } else if (category && category !== 'All') {
    list = list.filter((s) => s.category === category);
  }
  return [...list].sort((a, b) => a.song.toLowerCase().localeCompare(b.song.toLowerCase()));
}
