// Browse headers (owner report 2026-11-27): what a person, show, season, album
// or collection page says about itself, and how a page names its parents.
// Pure — the view (BrowseHeader.jsx, DetailView.jsx) renders these words and
// links; nothing here fetches. Field names follow the info API
// (`GET /api/v1/info/:source/:id`, PlexAdapter container metadata).
import { formatDuration } from "../search/resultPresentation.js";
import { contentIdToBrowsePath } from "./browsePath.js";

const PROXY_THUMB = (ratingKey) => `/api/v1/proxy/plex/library/metadata/${ratingKey}/thumb`;

function typeOf(item) {
  return String(item?.type ?? item?.metadata?.type ?? '').toLowerCase() || null;
}

function sectionOf(item) {
  return String(item?.metadata?.librarySectionTitle ?? '').toLowerCase();
}

/** Audiobook libraries call an artist an author and an album a book. */
function isBookLibrary(item) {
  return /audiobook|book/.test(sectionOf(item));
}

function count(n, noun) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

const KIND = {
  show: 'TV Show', season: 'Season', movie: 'Movie', collection: 'Collection', playlist: 'Playlist',
};

/** The kind of page in one word: Author, Artist, Book, Album, TV Show, Season, … */
export function headerKind(item) {
  const type = typeOf(item);
  if (type === 'artist') return isBookLibrary(item) ? 'Author' : 'Artist';
  if (type === 'album') return isBookLibrary(item) ? 'Book' : 'Album';
  if (KIND[type]) return KIND[type];
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : null;
}

/**
 * Key facts, in reading order: kind, year, content rating, up to three
 * genres, countries (people), counts. `itemCount` is the listed total when
 * the item does not carry its own count (Plex artists); `durationSeconds` is
 * a book's length when it is one file.
 */
export function headerFacts(item, { itemCount = null, durationSeconds = null } = {}) {
  if (!item) return [];
  const m = item.metadata ?? {};
  const type = typeOf(item);
  const facts = [headerKind(item)];
  if (m.year) facts.push(String(m.year));
  if (m.contentRating) facts.push(String(m.contentRating));
  if (type === 'artist' && Array.isArray(m.countries) && m.countries.length) facts.push(m.countries.slice(0, 2).join(', '));
  if (Array.isArray(m.genres) && m.genres.length) facts.push(m.genres.slice(0, 3).join(', '));
  if (type === 'show') {
    facts.push(count(m.seasonCount, 'season'));
    facts.push(count(m.leafCount ?? m.childCount, 'episode'));
  } else if (type === 'season') {
    facts.push(count(m.leafCount ?? m.childCount, 'episode'));
  } else if (type === 'artist') {
    facts.push(count(m.childCount || itemCount, isBookLibrary(item) ? 'book' : 'album'));
  } else if (type === 'album') {
    const length = formatDuration(durationSeconds);
    facts.push(length ?? (isBookLibrary(item) ? null : count(m.leafCount ?? m.childCount, 'track')));
  } else {
    facts.push(count(m.childCount || itemCount, 'item'));
  }
  return facts.filter(Boolean);
}

/** The header picture: the poster/thumb, else the background art. */
export function headerArt(item) {
  return item?.thumbnail || item?.image || item?.metadata?.art || null;
}

/**
 * The one parent worth a link from this page: a track's author/artist, an
 * album's artist, an episode's or a season's show. Null for top-level items.
 */
export function parentOf(item) {
  if (!item) return null;
  const m = item.metadata ?? {};
  const type = typeOf(item);
  const person = isBookLibrary(item) ? 'Author' : 'Artist';
  const link = (ratingKey, title, role) => (ratingKey && title
    ? { contentId: `plex:${ratingKey}`, title, role, thumbnail: PROXY_THUMB(ratingKey) }
    : null);
  if (type === 'track') return link(m.artistId ?? m.grandparentId, m.artist ?? m.grandparentTitle, person);
  if (type === 'album') return link(m.parentRatingKey ?? m.parentId, m.parentTitle, person);
  if (type === 'episode') return link(m.grandparentId ?? m.grandparentRatingKey, m.grandparentTitle, 'Show');
  if (type === 'season') return link(m.parentRatingKey ?? m.parentId, m.parentTitle, 'Show');
  return null;
}

/**
 * Breadcrumb ancestors for a page opened by its address (no in-app trail):
 * the content's own parents, outermost first. Never a library and never the
 * app area the person came from.
 */
export function ancestorsOf(item) {
  if (!item) return [];
  const m = item.metadata ?? {};
  const type = typeOf(item);
  const at = (ratingKey, title) => (ratingKey && title ? { contentId: `plex:${ratingKey}`, title } : null);
  let chain = [];
  if (type === 'track') chain = [at(m.artistId ?? m.grandparentId, m.artist ?? m.grandparentTitle), at(m.albumId ?? m.parentId, m.album ?? m.parentTitle)];
  else if (type === 'episode') chain = [at(m.grandparentId ?? m.grandparentRatingKey, m.grandparentTitle), at(m.parentId ?? m.parentRatingKey, m.parentTitle)];
  else if (type === 'album' || type === 'season') chain = [at(m.parentRatingKey ?? m.parentId, m.parentTitle)];
  return chain.filter(Boolean);
}

/**
 * A show with exactly one season lists that season's episodes under the show
 * header (one tap fewer than opening "Season 1"). Only on a complete list.
 */
export function soleSeasonOf(container, items, total) {
  if (typeOf(container) !== 'show' || !Array.isArray(items) || items.length !== 1 || total !== 1) return null;
  const only = items[0];
  return typeOf(only) === 'season' ? only : null;
}

/** `plex:457029` → `plex/457029` (a browse path). */
export function pathFor(contentId) {
  return contentIdToBrowsePath(contentId);
}

/** `plex/457029` → `plex:457029`; null for a source root or the catalog root. */
export function contentIdFromPath(path) {
  const parts = String(path ?? '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts.slice(1).join('/')}`;
}

const SECTION_ORDER = [
  ['album', (book) => (book ? 'Books' : 'Albums')],
  ['show', () => 'Shows'],
  ['movie', () => 'Movies'],
  ['season', () => 'Seasons'],
  ['episode', () => 'Episodes'],
  ['track', (book) => (book ? 'Chapters' : 'Tracks')],
];

/**
 * A person or artist page lists its items by kind (jellyfin study rec 4,
 * owner-approved 2026-11-27): "Books (14)", "Audiobooks (3)", in a fixed
 * order, natural order within each, empty kinds left out. Null for any other
 * page (a show lists its seasons as they come).
 */
export function sectionsFor(container, items) {
  if (typeOf(container) !== 'artist' || !Array.isArray(items) || items.length === 0) return null;
  const book = isBookLibrary(container);
  const groups = new Map();
  for (const row of items) {
    const type = typeOf(row) ?? 'other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(row);
  }
  const known = SECTION_ORDER.filter(([type]) => groups.has(type))
    .map(([type, label]) => ({ key: type, label: label(book), items: groups.get(type) }));
  const rest = [...groups.entries()].filter(([type]) => !SECTION_ORDER.some(([t]) => t === type))
    .flatMap(([, rows]) => rows);
  if (rest.length) known.push({ key: 'other', label: 'More from this ' + (book ? 'author' : 'artist'), items: rest });
  return known;
}
