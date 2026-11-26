/**
 * Which file a Plex item's audio is, as "<partId>:<updatedAt>": both read from the
 * part the stream redirect resolves to (`/library/parts/<partId>/<updatedAt>/file.*`).
 * A new file at home (re-ripped, replaced, re-encoded) gets a new part id or a new
 * stamp, so a phone that kept the track can tell its copy is stale
 * (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.5).
 * Null when the metadata carries no such part. Pure; no Plex call.
 *
 * @module content-catalog/adapters/plex/plexFileVersion
 */
const PART_KEY = /^\/library\/parts\/(\d+)\/(\d+)\//;

/** @param {Object} item raw Plex metadata (with Media[].Part[]) */
export function plexFileVersion(item) {
  const part = item?.Media?.[0]?.Part?.[0];
  if (!part || typeof part.key !== 'string') return null;
  const m = PART_KEY.exec(part.key);
  if (!m) return null;
  // The key's id is the part's; when Plex also gives part.id it must agree.
  if (part.id !== undefined && String(part.id) !== m[1]) return null;
  return `${m[1]}:${m[2]}`;
}

export default plexFileVersion;
