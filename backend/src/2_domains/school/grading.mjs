/**
 * Pure per-type grading (spec §7). Normalisation is deliberately conservative:
 * trim, collapse internal whitespace, casefold — NO stemming, NO fuzzy
 * distance, NO punctuation stripping. "St. Paul" vs "St Paul" is an explicit
 * `accept` entry's job, not a clever matcher's. No clock, no I/O.
 */
import { codesMatch } from './companionCode.mjs';

const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

export function givenShapeError(item, given) {
  if (item.type === 'matching') {
    if (!Array.isArray(given)) return 'matching answer must be an array of {left, right} pairs';
    if (given.some((p) => !p || typeof p.left !== 'string' || typeof p.right !== 'string')) {
      return 'every matching pair needs string left and right';
    }
    return null;
  }
  // multi_select and companion_code are the other two item types an array is
  // legal for (spec §5.5) — every type below still requires a single string.
  if (item.type === 'multi_select') {
    if (!Array.isArray(given) || given.length === 0) return 'multi_select answer must be a non-empty array of choice strings';
    if (given.some((v) => typeof v !== 'string' || v.length === 0)) return 'every multi_select answer entry must be a non-empty string';
    return null;
  }
  // companion_code: the gate row. An array like multi_select's, but its own
  // type — see the gradeAnswer branch for why it is not one. Letter VALIDITY is
  // not checked here: a bubble outside A–E is a wrong code, not a malformed
  // submission, and `codesMatch` already fails it closed. Rejecting it as a
  // shape error would turn a mis-scan into a 400 instead of a failed gate,
  // which loses the child's attempt rather than marking it.
  if (item.type === 'companion_code') {
    if (!Array.isArray(given)) return 'companion_code answer must be an array of letters, one per filled bubble in the gate row';
    if (given.length === 0) return 'companion_code answer must be a non-empty array of letters — a blank gate row is unanswered, not empty';
    if (given.some((v) => typeof v !== 'string' || v.length === 0)) return 'every companion_code answer entry must be a non-empty letter string';
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
  if (item.type === 'companion_code') {
    // The gate row: exact-set match against the finish code, delegated to
    // `codesMatch` so the code alphabet has exactly one comparator.
    //
    // Deliberately NOT multi_select, which grades identically. Three reasons it
    // cannot be folded in. (1) The expected value lives on `item.code`, minted
    // with the companion, not in `item.answers` from a question bank — the item
    // carries its own answer. (2) It is never question-bank validated, so
    // reusing the type would drag it under `questionBankValidation`'s rules for
    // choices it does not have. (3) Chief among those is the two-answer minimum
    // there, which would make `['A']` an illegal item — but a single-letter
    // finish code is one of the 31 legal codes and must grade like any other.
    return { correct: codesMatch(given, item.code), expected: item.code };
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
