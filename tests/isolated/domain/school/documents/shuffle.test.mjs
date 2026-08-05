/**
 * Seeded shuffle primitive (spec §4.3) — pure: derives a Fisher-Yates
 * permutation from `(seed, variant, key)` via the shared `mulberry32` +
 * `hashSeed` PRNG (same primitives `generatedBanks/distractors.mjs` uses for
 * distractor sampling), and applies a permutation to an items array without
 * touching the input.
 */
import { describe, it, expect } from 'vitest';
import { deriveShuffle, applyShuffle, SHUFFLE_KEY_PATTERN } from '#domains/school/documents/shuffle.mjs';

describe('deriveShuffle', () => {
  it('is deterministic across repeated calls with the same inputs', () => {
    const first = deriveShuffle(91242, 0, 'wb1', 5);
    const second = deriveShuffle(91242, 0, 'wb1', 5);
    expect(second).toEqual(first);
  });

  it('pins the exact permutation for fixed inputs', () => {
    expect(deriveShuffle(91242, 0, 'wb1', 5)).toEqual([2, 3, 0, 1, 4]);
  });

  it('produces a different permutation when only variant changes', () => {
    expect(deriveShuffle(91242, 1, 'wb1', 5)).toEqual([4, 0, 3, 2, 1]);
  });

  it('produces a different permutation when only key changes', () => {
    expect(deriveShuffle(91242, 0, 'wb2', 5)).toEqual([4, 2, 0, 1, 3]);
  });

  it('produces a different permutation when only seed changes', () => {
    const baseline = deriveShuffle(91242, 0, 'wb1', 5);
    const differentSeed = deriveShuffle(91243, 0, 'wb1', 5);
    expect(differentSeed).not.toEqual(baseline);
  });

  it('returns an empty array for length 0', () => {
    expect(deriveShuffle(1, 0, 'k', 0)).toEqual([]);
  });

  it('returns a single-element identity array for length 1', () => {
    expect(deriveShuffle(1, 0, 'k', 1)).toEqual([0]);
  });

  it('returns a frozen array', () => {
    const permutation = deriveShuffle(91242, 0, 'wb1', 5);
    expect(Object.isFrozen(permutation)).toBe(true);
  });

  it('is a permutation of every index for larger lengths', () => {
    const permutation = deriveShuffle(91242, 0, 'wb1', 10);
    expect([...permutation].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('throws on a negative length', () => {
    expect(() => deriveShuffle(1, 0, 'k', -1)).toThrow();
  });

  it('throws on a non-integer length', () => {
    expect(() => deriveShuffle(1, 0, 'k', 1.5)).toThrow();
  });
});

describe('applyShuffle', () => {
  it('reorders items according to the permutation', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const permutation = deriveShuffle(91242, 0, 'wb1', 5);
    expect(applyShuffle(items, permutation)).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('does not mutate the input items array', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const snapshot = [...items];
    applyShuffle(items, deriveShuffle(91242, 0, 'wb1', 5));
    expect(items).toEqual(snapshot);
  });

  it('returns a new array, not the same reference', () => {
    const items = ['a', 'b'];
    const permutation = deriveShuffle(1, 0, 'k', 2);
    expect(applyShuffle(items, permutation)).not.toBe(items);
  });

  it('is stable regardless of item content — indices only', () => {
    const permutation = deriveShuffle(91242, 0, 'wb1', 5);
    const letters = applyShuffle(['a', 'b', 'c', 'd', 'e'], permutation);
    const numbers = applyShuffle([0, 1, 2, 3, 4], permutation);
    expect(letters.map((letter) => letter.charCodeAt(0) - 97)).toEqual(numbers);
  });

  it('handles an empty permutation', () => {
    expect(applyShuffle([], [])).toEqual([]);
  });
});

describe('SHUFFLE_KEY_PATTERN', () => {
  it('accepts short lowercase-alphanumeric-hyphen keys starting with an alphanumeric', () => {
    expect(SHUFFLE_KEY_PATTERN.test('wb1')).toBe(true);
    expect(SHUFFLE_KEY_PATTERN.test('word-bank-1')).toBe(true);
    expect(SHUFFLE_KEY_PATTERN.test('a')).toBe(true);
  });

  it('rejects keys starting with a hyphen', () => {
    expect(SHUFFLE_KEY_PATTERN.test('-wb1')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(SHUFFLE_KEY_PATTERN.test('WB1')).toBe(false);
  });

  it('rejects keys longer than 32 characters', () => {
    expect(SHUFFLE_KEY_PATTERN.test('a'.repeat(33))).toBe(false);
  });

  it('accepts a key exactly 32 characters long', () => {
    expect(SHUFFLE_KEY_PATTERN.test('a'.repeat(32))).toBe(true);
  });
});
