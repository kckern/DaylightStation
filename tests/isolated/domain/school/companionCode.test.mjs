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

  it('lists all 31 codes exactly once', () => {
    const spellings = new Set(ALL_CODES.map((code) => code.join('')));
    expect(spellings.size).toBe(31);
  });

  it('is frozen, so a caller cannot reshape the shared alphabet', () => {
    expect(() => { ALL_CODES.push(['A']); }).toThrow();
    expect(() => { ALL_CODES[0] = ['E']; }).toThrow();
    expect(() => { ALL_CODES[0].push('B'); }).toThrow();
    expect(() => { CODE_LETTERS.push('F'); }).toThrow();
    expect(ALL_CODES).toHaveLength(31);
    expect(ALL_CODES[0]).toEqual(['A']);
    expect(CODE_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('mintCode', () => {
  it('draws from the full set using the injected rng', () => {
    expect(mintCode({ rng: () => 0 })).toEqual(ALL_CODES[0]);
    expect(mintCode({ rng: () => 0.999999 })).toEqual(ALL_CODES[30]);
  });

  it('can reach every one of the 31 codes (D1)', () => {
    const minted = new Set();
    for (let i = 0; i < ALL_CODES.length; i += 1) {
      minted.add(formatCode(mintCode({ rng: () => (i + 0.5) / ALL_CODES.length })));
    }
    expect(minted.size).toBe(31);
  });

  it('never returns the same array instance twice', () => {
    const a = mintCode({ rng: () => 0 });
    const b = mintCode({ rng: () => 0 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('refuses an rng outside [0, 1) instead of silently minting ABCDE', () => {
    expect(() => mintCode({ rng: () => 1 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => 17 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => -0.5 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => NaN })).toThrow(/\[0, 1\)/);
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

  it('refuses a sparse array, whose holes `every` would otherwise skip', () => {
    expect(codesMatch(new Array(3), new Array(3))).toBe(false);
    expect(codesMatch([, 'A'], ['A'])).toBe(false); // eslint-disable-line no-sparse-arrays
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

  it('tolerates surrounding whitespace on typed or pasted input', () => {
    expect(parseCode(' ACE ')).toEqual(['A', 'C', 'E']);
    expect(parseCode('ACE\n')).toEqual(['A', 'C', 'E']);
    expect(parseCode('   ')).toBeNull();
  });

  it('answers null for anything unusable', () => {
    expect(parseCode('')).toBeNull();
    expect(parseCode('ABF')).toBeNull();
    expect(parseCode(null)).toBeNull();
  });

  it('refuses to print a blank gate row for a code it cannot read', () => {
    expect(formatCode(['F'])).toBeNull();
    expect(formatCode(['a', 'c'])).toBeNull();
    expect(formatCode('ACE')).toBeNull();
    expect(formatCode([])).toBeNull();
    expect(formatCode(null)).toBeNull();
  });
});
