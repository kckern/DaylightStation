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

export default { resolveScoreGroups };
