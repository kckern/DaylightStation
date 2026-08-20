import { describe, it, expect } from 'vitest';
import {
  SCHOOL_ACCESS_CODE_DIGITS, mintAccessCode, normalizeAccessCode,
} from '#domains/school/sessions/accessCode.mjs';

const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

describe('normalizeAccessCode', () => {
  it('accepts exactly six digits, zero-padded included', () => {
    expect(normalizeAccessCode('000042')).toBe('000042');
  });
  it('rejects anything else', () => {
    ['12345', '1234567', 'abc123', '', null, 123456].forEach((bad) => {
      expect(() => normalizeAccessCode(bad)).toThrow(/six decimal digits/);
    });
  });
});

describe('mintAccessCode', () => {
  it('is six digits wide', () => {
    const code = mintAccessCode({ random: () => 0.5 });
    expect(code).toHaveLength(SCHOOL_ACCESS_CODE_DIGITS);
    expect(code).toMatch(/^\d{6}$/);
  });
  it('zero-pads a small draw rather than emitting a short code', () => {
    expect(mintAccessCode({ random: () => 0 })).toBe('000000');
  });
  it('clamps a misbehaving rng instead of overflowing', () => {
    expect(mintAccessCode({ random: () => 1 })).toMatch(/^\d{6}$/);
  });
  it('retries until it draws a code that is not taken', () => {
    const code = mintAccessCode({ random: seq(0.111111, 0.222222), taken: (c) => c === '111111' });
    expect(code).toBe('222222');
  });
  it('gives up rather than looping forever when the space is exhausted', () => {
    expect(() => mintAccessCode({ random: () => 0.5, taken: () => true }))
      .toThrow(/could not mint/);
  });
  it('requires an injected random function', () => {
    expect(() => mintAccessCode({})).toThrow(/random function is required/);
  });
});
