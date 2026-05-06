import { describe, it, expect } from 'vitest';
import { safeClone } from './safeClone.mjs';

describe('safeClone', () => {
  it('returns null for null', () => {
    expect(safeClone(null)).toBe(null);
  });

  it('returns undefined for undefined', () => {
    expect(safeClone(undefined)).toBe(undefined);
  });

  it('returns primitives unchanged', () => {
    expect(safeClone(42)).toBe(42);
    expect(safeClone('hello')).toBe('hello');
    expect(safeClone(true)).toBe(true);
  });

  it('deep-clones plain objects', () => {
    const orig = { a: 1, nested: { b: 2 } };
    const cloned = safeClone(orig);
    expect(cloned).toEqual(orig);
    expect(cloned).not.toBe(orig);
    expect(cloned.nested).not.toBe(orig.nested);
  });

  it('deep-clones arrays', () => {
    const orig = [1, [2, 3]];
    const cloned = safeClone(orig);
    expect(cloned).toEqual(orig);
    expect(cloned[1]).not.toBe(orig[1]);
  });

  it('returns a string fallback for circular structures', () => {
    const a = {};
    a.self = a;
    const result = safeClone(a);
    expect(typeof result).toBe('string');
    expect(result).toContain('safeClone');
  });

  it('handles BigInt by string-fallback', () => {
    expect(typeof safeClone(BigInt(1))).toBe('string');
  });
});
