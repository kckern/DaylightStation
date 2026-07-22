/**
 * Transcription comparison for the typing rungs (design §3). Pure.
 *
 * **This never gates anything.** A wrong dictation still graduates the sentence
 * — accuracy is recorded so the learner can see their own diff on the Review
 * surface, not so the scheduler can act on it. That is deliberate and matches
 * School's "No second gate anywhere": only sequential courses lock.
 *
 * Normalisation is deliberately conservative, the same call School's
 * short-answer grading makes: trim, collapse whitespace, casefold. Nothing
 * clever. A near-miss that a smarter matcher would forgive is exactly what the
 * learner should see in their diff.
 */

/**
 * Casefolding is a no-op for Hangul and every other unicameral script; it is
 * here for source-language (`interpretation`) responses, which are typically
 * Latin. Harmless where it does not apply.
 */
export function normalize(text) {
  return String(text ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

/**
 * Levenshtein distance, two-row rolling table.
 *
 * Operates on code POINTS, not UTF-16 code units — `[...str]` rather than
 * indexing. Hangul syllables are BMP so they are safe either way, but emoji
 * and other astral characters are not, and a learner typing one into an answer
 * box must not corrupt the distance.
 */
export function editDistance(a, b) {
  const s = [...a];
  const t = [...b];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let curr = new Array(t.length + 1);

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,          // deletion
        prev[j - 1] + cost,   // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/**
 * Similarity of a response to the expected text, in [0, 1].
 *
 * Two empty strings score 1 — vacuously identical. An empty response against
 * non-empty expected scores 0 rather than dividing by zero.
 *
 * @param {string} given
 * @param {string} expected
 * @returns {number} rounded to 3 decimals
 */
export function accuracy(given, expected) {
  const a = normalize(given);
  const b = normalize(expected);
  if (a.length === 0 && b.length === 0) return 1;
  const longest = Math.max([...a].length, [...b].length);
  if (longest === 0) return 1;
  const score = 1 - editDistance(a, b) / longest;
  return Math.round(Math.max(0, score) * 1000) / 1000;
}

/**
 * Whether a response is close enough to call "got it" in the UI.
 *
 * Presentation only — nothing in the ladder reads this. Exposed so the
 * threshold lives with the comparison logic instead of being re-invented in a
 * component, where it would silently drift from what the diff shows.
 */
export const CLOSE_ENOUGH = 0.9;

export function isCloseEnough(given, expected) {
  return accuracy(given, expected) >= CLOSE_ENOUGH;
}
