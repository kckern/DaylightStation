import { describe, it, expect } from 'vitest';
import {
  CODE_LETTERS, ALL_CODES, mintCode, codesMatch, formatCode, parseCode,
} from '#domains/school/companionCode.mjs';

describe('the finish-code alphabet', () => {
  it('offers every non-empty combination of five letters (D1)', () => {
    expect(CODE_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(ALL_CODES).toHaveLength(31);
  });

  it('includes singles and the all-five code, and excludes the empty set', () => {
    expect(ALL_CODES).toContainEqual(['A']);
    expect(ALL_CODES).toContainEqual(['A', 'B', 'C', 'D', 'E']);
    expect(ALL_CODES.every((code) => code.length > 0)).toBe(true);
  });

  it('keeps every code in alphabet order so a stored code has one spelling', () => {
    for (const code of ALL_CODES) {
      expect(code).toEqual([...code].sort());
    }
  });
});

describe('mintCode', () => {
  it('draws from the full set using the injected rng', () => {
    expect(mintCode({ rng: () => 0 })).toEqual(ALL_CODES[0]);
    expect(mintCode({ rng: () => 0.999999 })).toEqual(ALL_CODES[30]);
  });

  it('never returns the same array instance twice', () => {
    const a = mintCode({ rng: () => 0 });
    const b = mintCode({ rng: () => 0 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('codesMatch', () => {
  it('is exact set equality, order- and duplicate-insensitive', () => {
    expect(codesMatch(['A', 'C'], ['C', 'A'])).toBe(true);
    expect(codesMatch(['A', 'C', 'A'], ['A', 'C'])).toBe(true);
  });

  it('refuses a subset, a superset, and a disjoint set', () => {
    expect(codesMatch(['A'], ['A', 'C'])).toBe(false);
    expect(codesMatch(['A', 'C', 'E'], ['A', 'C'])).toBe(false);
    expect(codesMatch(['B'], ['A'])).toBe(false);
  });

  it('refuses anything that is not a non-empty array of letters', () => {
    expect(codesMatch([], ['A'])).toBe(false);
    expect(codesMatch(null, ['A'])).toBe(false);
    expect(codesMatch(['a'], ['A'])).toBe(false);
    expect(codesMatch(['F'], ['F'])).toBe(false);
  });
});

describe('formatCode / parseCode', () => {
  it('round-trips through the printed spelling', () => {
    expect(formatCode(['A', 'C', 'E'])).toBe('ACE');
    expect(parseCode('ACE')).toEqual(['A', 'C', 'E']);
  });

  it('normalises case and order on the way in', () => {
    expect(parseCode('eca')).toEqual(['A', 'C', 'E']);
  });

  it('answers null for anything unusable', () => {
    expect(parseCode('')).toBeNull();
    expect(parseCode('ABF')).toBeNull();
    expect(parseCode(null)).toBeNull();
  });
});
