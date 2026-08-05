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
  // multi_select is the only OTHER item type an array is legal for (spec
  // §5.5) — every other type below still requires a single string.
  if (item.type === 'multi_select') {
    if (!Array.isArray(given) || given.length === 0) return 'multi_select answer must be a non-empty array of choice strings';
    if (given.some((v) => typeof v !== 'string' || v.length === 0)) return 'every multi_select answer entry must be a non-empty string';
    return null;
  }
  // true_false (spec §5.3): rendered/graded as A/B on the OMR card, but a
  // non-OMR caller may hand back the raw boolean instead — both are legal
  // `given` shapes, own dedicated branch (not the generic string check below,
  // which would reject a boolean outright).
  if (item.type === 'true_false') {
    if (given === true || given === false || given === 'A' || given === 'B') return null;
    return "true_false answer must be 'A', 'B', or a boolean";
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
  if (item.type === 'matching') {
    // all-or-nothing (spec §7 — partial credit has no agreed weighting).
    // `given` is untrusted (givenShapeError only guarantees element shape, not
    // uniqueness/coverage of `left`), so this must be a genuine bijection check
    // against item.pairs, not a length + per-pair lookup — a client who knows
    // only one correct pair could otherwise repeat it N times to fake a full
    // match (right length, every submitted pair individually correct).
    const want = new Map(item.pairs.map((p) => [p.left, p.right]));
    const seenLefts = new Set(given.map((p) => p.left));
    const correct = given.length === item.pairs.length
      && seenLefts.size === item.pairs.length
      && given.every((p) => want.has(p.left) && want.get(p.left) === p.right);
    return { correct, expected: item.pairs };
  }
  if (item.type === 'region_click' || item.type === 'asset_choice') {
    // Values are machine-generated ids (region codes / choice values), never
    // free text — strict equality, no normalization (see multiple_choice).
    return { correct: given === item.answer, expected: item.answer };
  }
  if (item.type === 'multi_select') {
    // Exact-set match: full credit or zero, no partial credit (spec §5.5) —
    // order-insensitive and duplicate-tolerant, since `given` is compared as
    // a SET against the answer set, not position-by-position.
    const wantSet = new Set(item.answers);
    const givenSet = new Set(given);
    const correct = givenSet.size === wantSet.size && [...wantSet].every((v) => givenSet.has(v));
    return { correct, expected: item.answers };
  }
  if (item.type === 'true_false') {
    // A='true', B='false' (spec §5.3's Ⓐ True / Ⓑ False card rendering); a
    // boolean `given` is used as-is. Strict equality against item.answer —
    // no fuzzing applies to a two-option item.
    const givenBool = given === 'A' ? true : given === 'B' ? false : given;
    return { correct: givenBool === item.answer, expected: item.answer };
  }
  throw new Error(`gradeAnswer: unrecognised item.type "${item.type}"`);
}
