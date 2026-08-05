/**
 * Seeded shuffle primitive (spec §4.3 "Shuffle derivation and post-issue
 * immutability"). Every shuffling block (`wordbank`, `matching`, bank-`select`
 * questions) carries an author-assigned `key`; the shuffle for that block is
 * derived from `(seed, variant, key)` so it's stable under document edits,
 * insertions, and reordering — unlike positional paths.
 *
 * Pure: no I/O, no Date. Reuses the same `mulberry32`/`hashSeed` PRNG
 * `generatedBanks/distractors.mjs` uses for distractor sampling, so both
 * subsystems derive determinism the same way.
 */
import { hashSeed, mulberry32 } from '#domains/school/generatedBanks/distractors.mjs';

/** Author-assigned block keys: short, lowercase, alphanumeric-and-hyphen. */
export const SHUFFLE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Derive a frozen Fisher-Yates permutation of `[0, length)` from
 * `(seed, variant, key)`.
 *
 * @param {number} seed - document seed (existing rule: mandatory integer)
 * @param {number} variant - non-negative integer variant
 * @param {string} key - block key (see SHUFFLE_KEY_PATTERN)
 * @param {number} length - number of items to permute (non-negative integer)
 * @returns {ReadonlyArray<number>} frozen array of indices into an items array
 */
export function deriveShuffle(seed, variant, key, length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`deriveShuffle: length must be a non-negative integer, got ${length}`);
  }

  const permutation = Array.from({ length }, (_, index) => index);
  const random = mulberry32(hashSeed(`${seed}:${variant}:${key}`));
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [permutation[index], permutation[swap]] = [permutation[swap], permutation[index]];
  }
  return Object.freeze(permutation);
}

/**
 * Apply a permutation to `items`, returning a new array — `items` is never
 * mutated. `permutation[i]` is the source index placed at output position `i`.
 *
 * @param {Array} items
 * @param {ReadonlyArray<number>} permutation
 * @returns {Array} new array, same length as `permutation`
 */
export function applyShuffle(items, permutation) {
  return permutation.map((sourceIndex) => items[sourceIndex]);
}
