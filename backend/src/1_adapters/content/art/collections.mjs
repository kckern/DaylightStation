// collections.mjs — pure collection resolution for ArtMode. No DOM, no IO.

// First 4-digit run in a (messy) date string → year, else null. "0000" → null.
export function parseYear(dateStr) {
  if (dateStr == null) return null;
  const m = String(dateStr).match(/\d{4}/);
  if (!m) return null;
  const y = Number(m[0]);
  return y > 0 ? y : null;
}

const includesCI = (hay, needle) =>
  String(hay ?? '').toLowerCase().includes(String(needle).toLowerCase());

// Build a predicate over an art entry { folder, meta }. Empty def → match-all.
// Date filters exclude entries with an unparseable year. Field filters are
// case-insensitive substring matches. `works` restricts to exact folder names.
export function buildArtPredicate(def = {}) {
  // `section` = the thematic subdir under a sectioned scope (art/<scope>/<section>/<work>/),
  // surfaced by artSource as meta.section; lets a collection scope to one section.
  const FIELDS = ['origin', 'medium', 'artist', 'department', 'category', 'display', 'section'];
  return (entry) => {
    const meta = entry?.meta || {};
    if (def.dateMin != null || def.dateMax != null) {
      const year = parseYear(meta.date);
      if (year == null) return false;
      if (def.dateMin != null && year < def.dateMin) return false;
      if (def.dateMax != null && year > def.dateMax) return false;
    }
    for (const f of FIELDS) {
      if (def[f] != null && !includesCI(meta[f], def[f])) return false;
    }
    if (Array.isArray(def.works) && def.works.length > 0) {
      if (!def.works.includes(entry.folder)) return false;
    }
    return true;
  };
}

// Hybrid membership (ArtMode "Model C"): a work belongs to collection `key` if the
// rule matches OR it's hand-tagged with the collection name — but hidden/flagged
// works are never shown, and an explicit `exclude` (or hide/flag) overrides a match.
// Pure; the single source of truth for "is this work in this collection?".
export function isMember(key, def = {}, entry) {
  const meta = entry?.meta || {};
  if (meta.hidden === true) return false;
  if (meta.flagged === true) return false;
  if (Array.isArray(meta.exclude) && meta.exclude.includes(key)) return false;
  if (Array.isArray(meta.tags) && meta.tags.includes(key)) return true;
  return buildArtPredicate(def)(entry);
}

// Resolve a collection key against a defs map, falling back to `all` (or {}).
export function resolveCollection(defs = {}, key) {
  if (key && Object.prototype.hasOwnProperty.call(defs, key)) {
    return { key, def: defs[key] || {} };
  }
  return { key: 'all', def: defs.all || {} };
}

export default { parseYear, buildArtPredicate, isMember, resolveCollection };
