// courseGroups.js — video-collection tab grouping for Videos.jsx, split out
// so Fast Refresh can hot-reload the mode's routes on their own.

/**
 * Normalize the videos config into ordered tab groups — each `{ label, collections }`
 * becomes one tab whose poster wall merges every collection it lists.
 *
 * Grouped form (preferred): `videos.collections: [{ label, plex: [...] }, ...]`.
 * Legacy form: a flat `videos.plexCollection` (string or array) collapses to a
 * single unlabeled group → a plain grid with no tab bar.
 */
export function resolveCourseGroups(videos) {
  const toList = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  if (Array.isArray(videos?.collections) && videos.collections.length) {
    return videos.collections
      .map((g) => ({
        label: g?.label || null,
        collections: toList(g?.plex ?? g?.collections),
        // A tab can also cherry-pick shows out of the shared pool (`shows`) or
        // hide shows its collections would otherwise include (`exclude_shows`)
        // — lets e.g. Voice Lessons split out of a piano collection without
        // restructuring Plex.
        shows: toList(g?.shows),
        excludeShows: toList(g?.exclude_shows),
      }))
      .filter((g) => g.collections.length || g.shows.length);
  }
  const flat = toList(videos?.plexCollection);
  return flat.length ? [{ label: null, collections: flat, shows: [], excludeShows: [] }] : [];
}
