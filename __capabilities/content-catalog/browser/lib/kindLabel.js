// The kind of an item in one word, by what it is in its library (owner report
// 2026-11-27: Plex audiobooks read "Track" everywhere). An audiobook library's
// track is an Audiobook, its album a Book and its artist an Author; a music
// track is a Song; a movie a Film. Shared by the search dropdown rows
// (ContentCombobox), Media's result subtitles and the Browse headers.

const FIXED = Object.freeze({
  movie: 'Film', episode: 'Episode', show: 'TV Show', series: 'TV Show', season: 'Season',
  collection: 'Collection', playlist: 'Playlist', book: 'Book', audiobook: 'Audiobook',
});

function typeOf(item) {
  const t = item?.type ?? item?.metadata?.type ?? item?.mediaType;
  return t ? String(t).toLowerCase() : null;
}

/** True when the item comes from an audiobook (or book) library. */
export function isBookLibrary(item) {
  const section = item?.metadata?.librarySectionTitle ?? item?.librarySectionTitle ?? '';
  return /audiobook|\bbooks?\b/i.test(String(section));
}

export function kindLabel(item) {
  const type = typeOf(item);
  if (!type) return null;
  const book = isBookLibrary(item);
  if (type === 'track') return book ? 'Audiobook' : 'Song';
  if (type === 'album') return book ? 'Book' : 'Album';
  if (type === 'artist') return book ? 'Author' : 'Artist';
  return FIXED[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export default kindLabel;
