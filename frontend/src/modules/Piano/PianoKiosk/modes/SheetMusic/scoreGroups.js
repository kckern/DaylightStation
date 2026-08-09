/**
 * scoreGroups — resolve `sheetmusic:` config (piano.yml) into ordered score
 * tabs, mirroring the Courses menu's grouped-collections model (Videos.jsx
 * resolveCourseGroups).
 *
 * Grouped form (preferred): `sheetmusic.collections: [{ label, ref }]` — one
 * tab per entry, each ref a folder (`files:docs/sheet-music/video-games`) or
 * Plex collection. Legacy form: `sheetmusic.collection: <ref>` — one unlabeled
 * group, which renders as today's tabless grid.
 */
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** @returns {Array<{label: string|null, ref: string}>} ordered tab groups */
export function resolveScoreGroups(raw) {
  const r = isObj(raw) ? raw : {};
  if (Array.isArray(r.collections)) {
    return r.collections
      .filter((g) => isObj(g) && g.ref)
      .map((g) => ({ label: g.label ?? null, ref: String(g.ref) }));
  }
  if (r.collection) return [{ label: null, ref: String(r.collection) }];
  return [];
}

/**
 * URL slug for a collection tab, so which tab you are on can live in the address
 * bar and survive a reload or a shared link. Derived from the LABEL, not the
 * index, so a link keeps pointing at the same collection when the config is
 * reordered. An unlabelled collection falls back to its position, which is the
 * only stable thing left to name it by.
 */
export function groupSlug(group, index = 0) {
  const slug = String(group?.label ?? '')
    .toLowerCase()
    // An apostrophe sits INSIDE a word, so it is dropped rather than treated as
    // a boundary: "Bach's" is one word, not "bach" and "s".
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `group-${index + 1}`;
}

/**
 * Which collection a slug names. Falls back to the FIRST group rather than
 * nothing: a stale bookmark, a reordered config or a typed-by-hand address
 * should still open the game on something, never a dead end.
 */
export function groupIndexBySlug(groups, slug) {
  const want = String(slug ?? '').toLowerCase();
  const i = (groups || []).findIndex((g, n) => groupSlug(g, n) === want);
  return i >= 0 ? i : 0;
}

export default { resolveScoreGroups, groupSlug, groupIndexBySlug };
