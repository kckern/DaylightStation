/**
 * Validate a single path segment supplied by an untrusted caller.
 * Rejects anything that could escape the intended directory (traversal,
 * slashes, empties, non-strings). Security-critical: every user-supplied
 * path component in the emulator router must pass through this guard.
 *
 * @param {string} s   The segment to validate
 * @param {object} [opts]
 * @param {boolean} [opts.dot=false]  Allow dots (for filenames with extensions)
 * @returns {string} The validated segment (unchanged)
 * @throws {Error} If the segment is unsafe
 */
export function safeSegment(s, { dot = false } = {}) {
  if (typeof s !== 'string' || s === '') throw new Error('unsafe path segment');
  if (s.includes('..')) throw new Error('unsafe path segment');
  const re = dot ? /^[a-z0-9_.-]+$/i : /^[a-z0-9_-]+$/i;
  if (!re.test(s)) throw new Error('unsafe path segment');
  return s;
}
