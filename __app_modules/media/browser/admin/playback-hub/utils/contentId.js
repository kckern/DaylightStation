/**
 * Content ID utilities for the playback-hub admin.
 *
 * The hub deals with content IDs in two shapes:
 *  - String form:   "plex:670208" or "audiobookshelf:abc/def"
 *  - Object form:   { source: 'plex', id: '670208' } (used by QueueRef VO)
 *
 * These helpers convert between the two and provide a "default to plex"
 * shorthand for bare numeric IDs (commonly seen in legacy YAML).
 */

/**
 * Split a "source:id" string into its components. Splits only on the FIRST
 * colon so colons embedded in IDs (e.g. audiobookshelf paths) are preserved.
 * Returns null for empty / non-string input.
 *
 * @param {string} value
 * @returns {{ source: string, id: string } | null}
 */
export function splitContentId(value) {
  if (!value || typeof value !== 'string') return null;
  const idx = value.indexOf(':');
  if (idx < 0) return { source: 'plex', id: value };
  return { source: value.slice(0, idx), id: value.slice(idx + 1) };
}

/**
 * Join a source and id into "source:id" string form.
 *
 * @param {string} source
 * @param {string} id
 * @returns {string}
 */
export function toContentId(source, id) {
  return `${source}:${id}`;
}

/**
 * Return just the id portion of a content ID (drops the source prefix).
 * Returns null for empty / non-string input.
 *
 * @param {string} value
 * @returns {string | null}
 */
export function plexIdOnly(value) {
  const parts = splitContentId(value);
  return parts?.id ?? null;
}
