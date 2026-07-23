import { describe, it, expect } from 'vitest';
import { sampleDistractors, hashSeed, mulberry32 } from './distractors.mjs';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(hashSeed('x')); const b = mulberry32(hashSeed('x'));
    expect(a()).toBe(b());
  });
});

describe('sampleDistractors', () => {
  const pool = ['A', 'B', 'C', 'D', 'E', 'F'];
  it('returns count values, none equal to exclude, all from pool', () => {
    const out = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    expect(out).toHaveLength(3);
    expect(out).not.toContain('A');
    out.forEach((v) => expect(pool).toContain(v));
    expect(new Set(out).size).toBe(3); // unique
  });
  it('is deterministic for a fixed seed', () => {
    const one = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    const two = sampleDistractors({ pool, exclude: 'A', count: 3, seed: 'deck:A' });
    expect(one).toEqual(two);
  });
  it('caps at available pool size when count exceeds it', () => {
    const out = sampleDistractors({ pool: ['A', 'B'], exclude: 'A', count: 5, seed: 's' });
    expect(out).toEqual(['B']);
  });
});
