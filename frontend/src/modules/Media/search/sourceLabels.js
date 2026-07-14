// frontend/src/modules/Media/search/sourceLabels.js
// Friendly, user-facing names for search source/adapter ids. Raw source ids
// (plex, abs, canvas-filesystem, …) must never render in the UI — every
// component that mentions a source goes through this map.

export const SOURCE_LABELS = Object.freeze({
  plex: 'Movies & TV',
  abs: 'Audiobooks',
  singalong: 'Sing-along',
  files: 'Local files',
  freshvideo: 'Fresh videos',
  immich: 'Photos',
  youtube: 'YouTube',
  readalong: 'Read-along',
  retroarch: 'Games',
  app: 'Apps',
  'canvas-filesystem': 'Art',
  art: 'Art',
  list: 'Lists',
  query: 'Saved searches',
  'local-content': 'Local library',
  stream: 'Streams',
});

/**
 * Friendly label for a single source id. Unknown ids are prettified
 * ("some-source" → "Some source") so a new adapter never leaks a raw slug.
 * Suffixed ids fall back to their base ("plex-main" → "Movies & TV").
 */
export function sourceLabel(source) {
  if (!source) return null;
  const key = String(source).toLowerCase();
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  const base = key.split('-')[0];
  if (SOURCE_LABELS[base]) return SOURCE_LABELS[base];
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Deduped, order-preserving friendly labels for a list of source ids. */
export function sourceLabelList(sources = []) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const label = sourceLabel(s);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

export default SOURCE_LABELS;
