/**
 * The finish code: a set of letters from A–E, minted when a required companion's
 * worksheet is issued and answered on the sheet's gate row.
 *
 * ALL 31 NON-EMPTY COMBINATIONS ARE MINTABLE (requirements D1) — singles, pairs,
 * triples, quads, and all five. Only the empty set is excluded, because a blank
 * row is already how the sheet says "not answered" and the gate has to tell a
 * missing code from a wrong one.
 *
 * Two exclusions were considered and rejected. Refusing single letters would have
 * matched `questionBankValidation`'s two-answer minimum for `multi_select` — but
 * the gate row is not a bank item and is not validated there (D2). Refusing the
 * all-five code would have made a fully shotgunned row always wrong — but it is
 * only one outcome in 31, the same odds as any other guess, and §8 of the
 * requirements is explicit that guessing is not the threat model.
 *
 * A code is ALWAYS stored and compared in alphabet order, so one code has exactly
 * one spelling everywhere it is written down.
 *
 * Pure: no clock, no I/O, no randomness of its own — `mintCode` takes an rng.
 */
export const CODE_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E']);

const LETTER_INDEX = new Map(CODE_LETTERS.map((letter, index) => [letter, index]));

/** Every non-empty subset, ordered by bitmask so the list is stable across runs. */
export const ALL_CODES = Object.freeze(
  Array.from({ length: 2 ** CODE_LETTERS.length - 1 }, (_, i) => {
    const mask = i + 1;
    return Object.freeze(CODE_LETTERS.filter((_letter, bit) => (mask & (1 << bit)) !== 0));
  }),
);

const isCode = (value) => Array.isArray(value)
  && value.length > 0
  && value.every((letter) => LETTER_INDEX.has(letter));

/** Alphabet order, duplicates dropped. Returns null for anything unusable. */
const normalise = (value) => {
  if (!isCode(value)) return null;
  return [...new Set(value)].sort((a, b) => LETTER_INDEX.get(a) - LETTER_INDEX.get(b));
};

/**
 * @param {{rng?: () => number}} [opts] - injected so tests are deterministic
 * @returns {string[]} a fresh array, alphabet-ordered
 */
export function mintCode({ rng = Math.random } = {}) {
  const index = Math.min(ALL_CODES.length - 1, Math.floor(rng() * ALL_CODES.length));
  return [...ALL_CODES[index]];
}

/** Exact set equality. A subset, a superset and a disjoint set are all false. */
export function codesMatch(given, expected) {
  const a = normalise(given);
  const b = normalise(expected);
  if (!a || !b) return false;
  return a.length === b.length && a.every((letter, i) => letter === b[i]);
}

/** The spelling a child reads on the completion card: `['A','C','E']` -> `'ACE'`. */
export function formatCode(code) {
  const normalised = normalise(code);
  return normalised ? normalised.join('') : '';
}

/** The inverse. Case-insensitive; null for anything that is not a real code. */
export function parseCode(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  return normalise(text.toUpperCase().split(''));
}

export default { CODE_LETTERS, ALL_CODES, mintCode, codesMatch, formatCode, parseCode };
