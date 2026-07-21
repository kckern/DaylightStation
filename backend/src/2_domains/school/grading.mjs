/**
 * Pure per-type grading (spec §7). Normalisation is deliberately conservative:
 * trim, collapse internal whitespace, casefold — NO stemming, NO fuzzy
 * distance, NO punctuation stripping. "St. Paul" vs "St Paul" is an explicit
 * `accept` entry's job, not a clever matcher's. No clock, no I/O.
 */
const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

export function givenShapeError(item, given) {
  if (item.type === 'matching') {
    if (!Array.isArray(given)) return 'matching answer must be an array of {left, right} pairs';
    if (given.some((p) => !p || typeof p.left !== 'string' || typeof p.right !== 'string')) {
      return 'every matching pair needs string left and right';
    }
    return null;
  }
  if (typeof given !== 'string' || given.length === 0) return 'answer must be a non-empty string';
  return null;
}

export function gradeAnswer(item, given) {
  if (item.type === 'multiple_choice') {
    return { correct: given === item.answer, expected: item.answer };
  }
  if (item.type === 'short_answer' || item.type === 'cloze') {
    const accepted = [item.answer, ...(item.accept || [])].map(norm);
    return { correct: accepted.includes(norm(given)), expected: item.answer };
  }
  // matching: all-or-nothing (spec §7 — partial credit has no agreed weighting)
  const want = new Map(item.pairs.map((p) => [p.left, p.right]));
  const correct = given.length === item.pairs.length
    && given.every((p) => want.get(p.left) === p.right);
  return { correct, expected: item.pairs };
}
