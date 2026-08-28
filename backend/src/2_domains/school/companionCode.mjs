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
 * NOTHING UNUSABLE IS EVER RENDERED AS BLANK. `formatCode` answers null, not `''`,
 * for input it cannot read — `''` is the printed spelling of "no code at all", and
 * a worksheet whose gate row printed blank is a gate no child can pass. Callers
 * must treat null as a bug in the caller, not as an empty code.
 *
 * CASE-SENSITIVITY INVARIANT: `parseCode` is case-insensitive and normalises, but
 * `codesMatch` is case-SENSITIVE and compares only canonical upper-case letters —
 * `codesMatch(['a'], ['A'])` is false. Anything arriving from outside this module
 * (an OMR read, a YAML field, a typed lookup) must go through `parseCode` FIRST;
 * feeding raw letters straight to `codesMatch` fails the gate silently.
 *
 * Pure: no clock, no I/O, no randomness of its own — `mintCode` takes an rng.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const CODE_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E']);

/**
 * The itemId the gate row prints under, and the id its synthesized bank item
 * carries (Task 8). A worksheet has exactly one gate, so one fixed id is
 * enough — and a fixed id is what lets `questionItemIds`, the row planner and
 * the scan-back resolver all name the same row without passing it around.
 *
 * Double-underscored so it cannot collide with an authored bank item id: every
 * real item id in this codebase is a slug, and nothing mints this shape.
 */
export const COMPANION_GATE_ITEM_ID = '__companion_gate';

/**
 * What a scanned gate row can say (Task 10). Three states, not two, because a
 * BLANK row and a WRONG one are different facts about the child — one never
 * played the companion, the other played it and mis-copied the letters — and
 * they earn different instructions on the receipt even though both block the
 * pass. `satisfied` is the ONLY value that clears the gate: `evaluateOutcome`
 * treats anything else non-null as a veto, so an unrecognised status fails
 * closed rather than waving a sheet through.
 *
 * Deliberately NOT the row grading vocabulary (`correct`/`incorrect`/
 * `blank`/`ambiguous`). The gate is not a question and never scores; naming
 * its states after the score's would invite exactly the folding-in this
 * feature exists to prevent.
 */
export const GATE_SATISFIED = 'satisfied';
export const GATE_BLANK = 'blank';
export const GATE_WRONG = 'wrong';
/**
 * A FOURTH, AND IT IS A FACT ABOUT THE PAPER, NOT ABOUT THE CHILD (Task 11).
 *
 * A wrong code is repairable: the child fills in the letters they were missing
 * and feeds the same sheet again. Paper is append-only, so those repairs walk a
 * chain of supersets — A, AB, ABC, ABCD, ABCDE — and once every bubble in the
 * row is filled there is no mark left to add. A full row that is still wrong
 * can never become right, on this sheet, ever.
 *
 * It earns its own status rather than folding into `wrong` because the two owe
 * the child opposite instructions: `wrong` says "check the letters and scan
 * this again", which is precisely the advice that cannot work here. This one
 * says "ask for a new sheet" — and it is what lets the repair lane stop
 * inviting a sixth attempt without keeping a counter of its own.
 */
export const GATE_EXHAUSTED = 'exhausted';
export const GATE_STATUSES = Object.freeze([GATE_SATISFIED, GATE_BLANK, GATE_WRONG, GATE_EXHAUSTED]);

const LETTER_INDEX = new Map(CODE_LETTERS.map((letter, index) => [letter, index]));

/** Every non-empty subset, ordered by bitmask so the list is stable across runs. */
export const ALL_CODES = Object.freeze(
  Array.from({ length: 2 ** CODE_LETTERS.length - 1 }, (_, i) => {
    const mask = i + 1;
    return Object.freeze(CODE_LETTERS.filter((_letter, bit) => (mask & (1 << bit)) !== 0));
  }),
);

/**
 * Spread first: `Array.prototype.every` SKIPS holes, so a sparse array would
 * otherwise pass this check without any of its slots being a real letter.
 */
const isCode = (value) => Array.isArray(value)
  && value.length > 0
  && [...value].every((letter) => LETTER_INDEX.has(letter));

/** Alphabet order, duplicates dropped. Returns null for anything unusable. */
const normalise = (value) => {
  if (!isCode(value)) return null;
  return [...new Set(value)].sort((a, b) => LETTER_INDEX.get(a) - LETTER_INDEX.get(b));
};

/**
 * Draws one of the 31 codes.
 *
 * The draw is validated rather than clamped. A clamp is silent exactly where it
 * must not be: `Math.random` can never return negative or >= 1, so clamping only
 * guards cases the contract already excludes — while a seeded PRNG handed in with
 * the common `0..n` integer signature would clamp to `ABCDE` on EVERY call, minting
 * the one shotgun-shaped code forever with no error. Loud on both ends instead.
 *
 * @param {{rng?: () => number}} [opts] - injected so tests are deterministic
 * @returns {string[]} a fresh array, alphabet-ordered
 * @throws {ValidationError} if rng() is not a finite number in [0, 1)
 */
export function mintCode({ rng = Math.random } = {}) {
  const draw = rng();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new ValidationError('Companion finish-code rng must return a number in [0, 1)', {
      code: 'COMPANION_CODE_RNG_OUT_OF_RANGE', details: { value: draw },
    });
  }
  return [...ALL_CODES[Math.floor(draw * ALL_CODES.length)]];
}

/** Exact set equality. A subset, a superset and a disjoint set are all false. */
export function codesMatch(given, expected) {
  const a = normalise(given);
  const b = normalise(expected);
  if (!a || !b) return false;
  return a.length === b.length && a.every((letter, i) => letter === b[i]);
}

/**
 * The spelling a child reads on the completion card: `['A','C','E']` -> `'ACE'`.
 * Null — never `''` — for input this cannot read, so a bad code refuses to print
 * instead of printing a blank gate row. See the header.
 */
export function formatCode(code) {
  const normalised = normalise(code);
  return normalised ? normalised.join('') : null;
}

/**
 * The inverse. Case-insensitive and whitespace-tolerant (typed and pasted codes
 * routinely carry it); null for anything that is not a real code.
 */
export function parseCode(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return normalise(trimmed.toUpperCase().split(''));
}

export default {
  CODE_LETTERS, COMPANION_GATE_ITEM_ID, ALL_CODES, GATE_STATUSES,
  GATE_SATISFIED, GATE_BLANK, GATE_WRONG, GATE_EXHAUSTED,
  mintCode, codesMatch, formatCode, parseCode,
};
