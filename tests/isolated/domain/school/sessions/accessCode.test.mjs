import { describe, it, expect } from 'vitest';
import {
  SCHOOL_ACCESS_CODE_DIGITS,
  SCHOOL_ACCESS_CODE_SPACE,
  mintAccessCode,
  normalizeAccessCode,
} from '#domains/school/sessions/accessCode.mjs';

const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const free = () => false;

/** Capture rather than match a message: the code is the contract, the prose is not. */
const thrownBy = (fn) => {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected the call to throw, but it returned');
};

describe('constants', () => {
  it('derives the space from the digit width so the two cannot drift', () => {
    expect(SCHOOL_ACCESS_CODE_SPACE).toBe(10 ** SCHOOL_ACCESS_CODE_DIGITS);
  });
});

describe('normalizeAccessCode', () => {
  it('accepts exactly six digits, zero-padded included', () => {
    expect(normalizeAccessCode('000042')).toBe('000042');
  });

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['letters', 'abc123'],
    ['empty', ''],
    ['null', null],
    ['a number, not a string', 123456],
    ['surrounding whitespace', ' 000042 '],
    ['trailing space', '000042 '],
    ['trailing newline', '000042\n'],
  ])('rejects %s', (_label, bad) => {
    const error = thrownBy(() => normalizeAccessCode(bad));
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('INVALID_SCHOOL_ACCESS_CODE');
  });
});

describe('mintAccessCode', () => {
  it('is six digits wide', () => {
    const code = mintAccessCode({ rng: () => 0.5, taken: free });
    expect(code).toHaveLength(SCHOOL_ACCESS_CODE_DIGITS);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('zero-pads a small draw rather than emitting a short code', () => {
    expect(mintAccessCode({ rng: () => 0, taken: free })).toBe('000000');
  });

  it('maps a draw onto the space exactly', () => {
    expect(mintAccessCode({ rng: () => 0.5, taken: free })).toBe('500000');
  });

  it('clamps a misbehaving rng to the top of the space instead of overflowing', () => {
    expect(mintAccessCode({ rng: () => 1, taken: free })).toBe('999999');
  });

  it('retries until it draws a code that is not taken', () => {
    const code = mintAccessCode({
      rng: seq(0.111111, 0.222222), taken: (c) => c === '111111',
    });
    expect(code).toBe('222222');
  });

  it('gives up rather than looping forever when the space is exhausted', () => {
    const error = thrownBy(() => mintAccessCode({ rng: () => 0.5, taken: () => true }));
    expect(error.name).toBe('DomainInvariantError');
    expect(error.code).toBe('SCHOOL_ACCESS_CODE_SPACE_EXHAUSTED');
    expect(error.details.attempts).toBeGreaterThan(0);
    expect(error.message).toContain(String(error.details.attempts));
  });

  it('requires an injected rng', () => {
    const error = thrownBy(() => mintAccessCode({ taken: free }));
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('INVALID_SCHOOL_ACCESS_CODE_MINT');
  });

  it('requires an injected taken predicate, so a forgetful caller cannot mint duplicates', () => {
    const error = thrownBy(() => mintAccessCode({ rng: () => 0.5 }));
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('INVALID_SCHOOL_ACCESS_CODE_MINT');
  });

  it.each([
    ['NaN', NaN],
    ['undefined', undefined],
    ['Infinity', Infinity],
    ['null', null],
    ['an object', {}],
  ])('refuses to mint from a non-finite draw (%s) rather than degrading to 000000', (_label, draw) => {
    const error = thrownBy(() => mintAccessCode({ rng: () => draw, taken: free }));
    expect(error.name).toBe('DomainInvariantError');
    expect(error.code).toBe('SCHOOL_ACCESS_CODE_RNG_INVALID');
  });

  it('always mints something normalizeAccessCode accepts', () => {
    [0, 0.5, 1, 0.999999, 0.0000001].forEach((draw) => {
      const code = mintAccessCode({ rng: () => draw, taken: free });
      expect(normalizeAccessCode(code)).toBe(code);
    });
  });
});
