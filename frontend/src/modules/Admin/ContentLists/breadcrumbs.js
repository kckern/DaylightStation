// breadcrumbs.js — pure hygiene for the combobox breadcrumb trail. Mirrors the
// comboboxScroll.js pattern: no React, no fetch, unit-tested in isolation.
//
// The siblings API returns an optional root-first `ancestors` chain (capped at
// the show's collection/library). The rendered trail is a HARD requirement to
// have no duplicate, ghost, or junk crumbs — this sanitizer enforces that on
// the frontend regardless of what any adapter emits.

/**
 * True for a synthetic library placeholder crumb. Plex emits these as the cap
 * level when a show is in no collection (id `library:{sectionId}`, type
 * `library`, or the generic title 'Library').
 */
function isLibraryPlaceholder(crumb) {
  return (typeof crumb.id === 'string' && crumb.id.startsWith('library:'))
    || crumb.type === 'library'
    || crumb.title === 'Library';
}

/**
 * Clean a breadcrumb chain for rendering (root-first order preserved):
 *   1. drop ghosts — any crumb missing `id` or `title`,
 *   2. dedupe by `id` — keep the first occurrence,
 *   3. collapse junk — when a real (collection/show) crumb exists, drop a
 *      synthetic library placeholder; keep it only when it is the sole ancestor.
 *
 * @param {Array<{id?:string,title?:string,source?:string,localId?:string,type?:string}>} crumbs
 * @returns {Array} the cleaned crumbs
 */
export function sanitizeBreadcrumbs(crumbs) {
  if (!Array.isArray(crumbs)) return [];

  // 1. Drop ghosts (missing/empty id or title).
  const real = crumbs.filter((c) => c && c.id && c.title);

  // 2. Dedupe by id (first occurrence wins).
  const seen = new Set();
  const deduped = real.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // 3. Collapse the junk library placeholder only when a real ancestor remains
  //    to take its place — otherwise the library IS the trail, so keep it.
  const hasRealAncestor = deduped.some((c) => !isLibraryPlaceholder(c));
  if (!hasRealAncestor) return deduped;
  return deduped.filter((c) => !isLibraryPlaceholder(c));
}

export default sanitizeBreadcrumbs;
