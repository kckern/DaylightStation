// frontend/src/modules/Media/browse/tilePresentation.js
// Pure presentation rules for the picture tiles on Home, in browse grids and in
// search results that use cards. No React, no fetch.
//
//   - Art first, aspect by kind: stills (video / episode / clip) are 16:9,
//     posters (film, show, book, audiobook) 2:3, music (album / playlist /
//     track) 1:1. An unknown type falls back to 16:9.
//   - A date-named file ("20261005", "2026-10-05") never shows as a bare date:
//     it reads "<where it came from> · <short date>".
//   - Editions of one thing in a row ("Persuasion" ×4) collapse to one tile.

const WIDE = 'wide';
const POSTER = 'poster';
const SQUARE = 'square';

const KIND_BY_TYPE = {
  video: WIDE, episode: WIDE, clip: WIDE, short: WIDE, recording: WIDE, photo: WIDE, slideshow: WIDE,
  movie: POSTER, film: POSTER, show: POSTER, series: POSTER, season: POSTER, book: POSTER, audiobook: POSTER,
  album: SQUARE, artist: SQUARE, track: SQUARE, song: SQUARE, playlist: SQUARE, audio: SQUARE, music: SQUARE, podcast: SQUARE,
};

/** The art's shape for an item's type: 'wide' (16:9), 'poster' (2:3), 'square' (1:1). */
export function tileKind(item) {
  const type = String(item?.type ?? item?.mediaType ?? '').toLowerCase();
  return KIND_BY_TYPE[type] ?? WIDE;
}

/** The CSS aspect-ratio for a tile kind. */
export function aspectFor(kind) {
  return kind === POSTER ? '2 / 3' : kind === SQUARE ? '1 / 1' : '16 / 9';
}

const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})(?:[T_-]?\d{4,6})?$/;
const ISO_DATE = /^(\d{4})[-._](\d{2})[-._](\d{2})(?:[T _-]\d{2}[:._]?\d{2}(?:[:._]?\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function validDate(y, m, d) {
  const year = Number(y); const month = Number(m); const day = Number(d);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 ? date : null;
}

/** The Date a date-named title spells ("20261005", "2026-10-05"), else null. */
export function parseDateTitle(title) {
  const text = String(title ?? '').trim();
  const match = COMPACT_DATE.exec(text) ?? ISO_DATE.exec(text);
  return match ? validDate(match[1], match[2], match[3]) : null;
}

/** "Oct 5" this year, "Oct 5, 2025" any other year — in the viewer's locale. */
export function shortDate(date, { locale, now = new Date() } = {}) {
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function usefulParent(raw) {
  const parent = String(raw?.parentTitle ?? '').trim();
  const grand = String(raw?.grandparentTitle ?? '').trim();
  // "Season 1" names nothing: the show above it does.
  const generic = !parent || /^(season|series|specials?|volume|vol\.?|disc|part)\s*\d*$/i.test(parent);
  if (!generic) return parent;
  return grand || '';
}

/**
 * The title to show. A date-named item reads "<show or source> · Oct 5" (the
 * date alone when nothing names its source); everything else is its title.
 * @param {{title?: string, parentTitle?: string, grandparentTitle?: string}} raw
 */
export function presentTitle(raw, options = {}) {
  const title = raw?.title;
  const date = parseDateTitle(title);
  if (!date) return title ?? null;
  const when = shortDate(date, options);
  const source = usefulParent(raw);
  return source ? `${source} · ${when}` : when;
}

/** Same thing, whatever its punctuation, accents or case ("Persuasion", "PERSUASION!"). */
export function normalizeTitle(title) {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Collapse editions/versions in one row: same normalized title and same type
 * become one entry (the first one, in row order) that carries the others.
 * An entry with no title never collapses; neither do episodes, videos or tracks,
 * nor anything when `collapse` is false (Carry on: each resume point is its own tile).
 * Same-titled things differing in show/artist or year stay apart.
 * @template T
 * @param {T[]} entries
 * @param {{ get?: (entry: T) => {title?: string, type?: string}, idOf?: (entry: T) => string }} [options]
 * @returns {{ entry: T, editions: T[] }[]}  `editions` lists every entry of the group (length 1 when alone)
 */
// Only things that have editions collapse: films, books, audiobooks, albums.
// Episodes, videos and tracks are different things that happen to share a name
// ("Pilot", "Introduction", "Lesson 1" in two shows) and never merge.
const COLLAPSIBLE_TYPES = new Set(['movie', 'film', 'book', 'audiobook', 'album']);

/** What tells two same-titled things apart: the show/album/artist above it and the year. */
function identityKey(item) {
  const above = normalizeTitle(item.grandparentTitle ?? item.parentTitle ?? item.parent ?? item.metadata?.parentTitle ?? item.artist ?? item.albumArtist ?? '');
  const year = String(item.year ?? item.metadata?.year ?? '').trim();
  return `${above}|${year}`;
}

export function collapseEditions(entries, { get = (entry) => entry, idOf = (entry) => get(entry)?.contentId ?? get(entry)?.id, collapse = true } = {}) {
  const groups = [];
  const byKey = new Map();
  const seenIds = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    const id = idOf(entry);
    if (id != null) {
      if (seenIds.has(id)) continue; // the very same item twice is one tile
      seenIds.add(id);
    }
    const item = get(entry) ?? {};
    const title = normalizeTitle(item.title);
    const type = String(item.type ?? item.metadata?.type ?? item.mediaType ?? '').toLowerCase();
    const key = collapse && title && COLLAPSIBLE_TYPES.has(type) ? `${title}|${type}|${identityKey(item)}` : null;
    const group = key ? byKey.get(key) : null;
    if (group) { group.editions.push(entry); continue; }
    const created = { entry, editions: [entry] };
    groups.push(created);
    if (key) byKey.set(key, created);
  }
  return groups;
}

/** "4 editions" (count ≥ 2), else null. */
export function editionsLabel(count) {
  return count >= 2 ? `${count} editions` : null;
}

/** 0-100 progress for an unfinished item, else null (no bar). */
export function progressPercent(percent, finished = false) {
  if (finished === true) return null;
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return null;
  return value;
}
