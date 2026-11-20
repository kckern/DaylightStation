/**
 * The slug a score is filed under: practice records and the score's Learn file
 * share it, so the two always name the same piece. Server and kiosk both use
 * this one function. Lowercase, runs of anything but letters and digits become
 * one '-', trimmed, at most 120 characters; null or undefined gives ''.
 *
 * The slug satisfies the backend's /^[a-z0-9-]{1,120}$/ (dots would corrupt YAML
 * filenames, since FileIO appends .yml by inspecting the trailing extension).
 *
 * The 120-character truncation means two very long ids that agree in their first
 * 120 slug characters share a key, and so share one practice record and one
 * Learn file. Practice records have always had this.
 */
export const practiceKeyOfScore = (id) => String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

/**
 * The media-relative path of a library score (`files:docs/sheet-music/…`), or
 * null for anything else: a bare id, another folder, or a '..', '.' or empty
 * path segment. Every server path built from a score id goes through this.
 */
export const libraryScoreLocalPath = (scoreId) => {
  const id = String(scoreId || '');
  if (!id.startsWith('files:docs/sheet-music/')) return null;
  const local = id.slice('files:'.length);
  if (local.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return local;
};
