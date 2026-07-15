// frontend/src/modules/Media/search/resultPresentation.js
// Human-facing title/subtitle derivation for search result rows. Raw source
// ids and mediaType slugs never render — everything routes through friendly
// labels ("Music · Album · 47 min", "TV Show · 155 episodes", "Audiobook").
import { looksLikeMachineTitle } from '../../../hooks/useStreamingSearch.js';
import { sourceLabel } from './sourceLabels.js';

const TYPE_LABELS = {
  movie: 'Movie',
  show: 'TV Show',
  series: 'TV Show',
  season: 'Season',
  episode: 'Episode',
  album: 'Album',
  artist: 'Artist',
  track: 'Track',
  audiobook: 'Audiobook',
  book: 'Book',
  photo: 'Photo',
  video: 'Video',
  audio: 'Audio',
  game: 'Game',
  playlist: 'Playlist',
  collection: 'Collection',
};

const CHILD_NOUNS = {
  show: 'episode',
  series: 'episode',
  season: 'episode',
  album: 'track',
  artist: 'album',
  audiobook: 'chapter',
  playlist: 'item',
  collection: 'item',
};

// "TV Shows" → "TV Show", "Audiobooks" → "Audiobook"; "Music" stays.
function singularize(label) {
  const s = String(label).trim();
  if (!/[a-rt-z]s$/i.test(s)) return s; // keep "ss" endings and non-s endings
  return s.slice(0, -1);
}

function capitalize(word) {
  const w = String(word);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function rawType(row) {
  const t = row?.type ?? row?.metadata?.type ?? row?.mediaType;
  return t ? String(t).toLowerCase() : null;
}

/** "47 min", "5 hr 12 min" — duration is in seconds. */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return '1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${hr} hr ${min} min` : `${hr} hr`;
}

/**
 * Display title for a result row. Machine filenames (timestamps, extension
 * blobs) get de-uglified when metadata offers nothing better.
 */
export function displayTitle(row) {
  const raw = row?.title ?? String(row?.id ?? row?.itemId ?? '');
  if (!looksLikeMachineTitle(raw)) return raw;
  const cleaned = String(raw)
    .replace(/\.[a-z0-9]{2,4}$/i, '') // strip extension
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || raw;
}

/**
 * Context line under the title: library section + human type + count/length.
 * e.g. "Music · Album · 47 min", "TV Show · 155 episodes", "Audiobook".
 * Never a raw source id, never a mediaType slug.
 */
export function resultSubtitle(row) {
  const parts = [];
  const type = rawType(row);
  const section = row?.metadata?.librarySectionTitle
    ? singularize(row.metadata.librarySectionTitle)
    : null;
  let typeLabel = type ? (TYPE_LABELS[type] ?? capitalize(type)) : null;

  if (section) {
    parts.push(section);
    // Drop the type when the section already says it ("Audiobooks" + album,
    // "TV Shows" + show) — no "Audiobook · Album" noise.
    const redundant = typeLabel && (
      typeLabel.toLowerCase() === section.toLowerCase()
      || (section.toLowerCase() === 'audiobook' && (type === 'album' || type === 'book'))
    );
    if (redundant) typeLabel = null;
  }
  if (typeLabel) parts.push(typeLabel);

  // For a music track, the artist/album is what actually distinguishes two
  // rows with the same title ("Hey Jude" the single vs the album cut). Show
  // it right after the type so identical titles are never ambiguous.
  if (type === 'track') {
    const artist = row?.metadata?.artist ?? row?.metadata?.grandparentTitle;
    const album = row?.metadata?.album ?? row?.metadata?.parentTitle;
    const context = [artist, album].filter(Boolean).join(' — ');
    if (context) parts.push(context);
  }

  const childCount = row?.childCount ?? row?.metadata?.childCount;
  const noun = CHILD_NOUNS[type];
  if (typeof childCount === 'number' && childCount > 0 && noun) {
    parts.push(`${childCount} ${noun}${childCount === 1 ? '' : 's'}`);
  } else {
    const duration = formatDuration(row?.duration);
    if (duration) parts.push(duration);
  }

  // Last resort: a friendly source name beats an empty line — but never the raw id.
  if (parts.length === 0) {
    const label = sourceLabel(row?.source ?? String(row?.id ?? '').split(':')[0]);
    if (label) parts.push(label);
  }
  return parts.join(' · ');
}
