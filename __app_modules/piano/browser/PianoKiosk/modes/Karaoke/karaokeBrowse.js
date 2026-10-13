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
 * Normalize a title/name for alphabetical sort: lowercase, strip a leading
 * parenthetical ("(Everything I Do) I Do It..." → "i do it..."), and drop a
 * leading article ("A", "An", "The") so "A Whole New World" files under W-adjacent
 * order the way a person hunting for it would look. Falls back to the trimmed
 * lowercase string if stripping would leave nothing.
 */
export function sortKey(str) {
  let s = String(str || '').trim().toLowerCase();
  s = s.replace(/^\([^)]*\)\s*/, '').trim(); // leading "(...)"
  s = s.replace(/^(the|a|an)\s+/, '').trim(); // leading article
  return s || String(str || '').trim().toLowerCase();
}

/**
 * Filter + sort song rows for display. A non-empty `query` searches song OR
 * artist (case-insensitive substring) across ALL songs, ignoring `category`.
 * With no query, `category` narrows the set ('All' or falsy = everything).
 * `sort` is 'song' (default) or 'artist'; both normalize leading articles/
 * parentheticals (see sortKey), and artist-sort tie-breaks on song.
 */
export function filterSongs(songs, { query, category, sort = 'song' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  let list = songs || [];
  if (q) {
    list = list.filter(
      (s) => s.song.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
    );
  } else if (category && category !== 'All') {
    list = list.filter((s) => s.category === category);
  }
  const bySong = (a, b) => sortKey(a.song).localeCompare(sortKey(b.song));
  const byArtist = (a, b) => {
    // Artistless rows sink below named artists, then tie-break on song.
    const aa = sortKey(a.artist);
    const bb = sortKey(b.artist);
    if (!aa && bb) return 1;
    if (aa && !bb) return -1;
    return aa.localeCompare(bb) || bySong(a, b);
  };
  return [...list].sort(sort === 'artist' ? byArtist : bySong);
}

/** Deterministic 32-bit hash of a string (FNV-1a). Stable across reloads. */
function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable hue (0–359) for a category name, so each karaoke genre gets its own
 * consistent color across the tab row and every card in it. Color-CODING, not
 * decoration — the same category is always the same hue.
 */
export function categoryHue(category) {
  return hashString(`cat:${category || ''}`) % 360;
}

/**
 * Recognition art for a poster-less karaoke song. Returns:
 *  - `seed`: a stable string for the canonical MaterialGlyph identicon (same
 *    song → same glyph forever), matching the producer's `slug:` seed shape.
 *  - `background`: a category-tinted gradient so cards in one genre share a hue
 *    FAMILY (color-coding), with a per-song angle so neighbors still differ.
 * The glyph carries per-song identity; the tile carries category color.
 */
export function songArt({ song, artist, category } = {}) {
  const hue = categoryHue(category);
  const h = hashString(`${song || ''}|${artist || ''}`);
  const hue2 = (hue + 16) % 360;
  const angle = 120 + (h % 60);
  const seed = `slug:${String(song || '').toLowerCase()}|${String(artist || '').toLowerCase()}`;
  const background =
    `linear-gradient(${angle}deg, hsl(${hue} 44% 30%), hsl(${hue2} 50% 18%))`;
  return { seed, background };
}
