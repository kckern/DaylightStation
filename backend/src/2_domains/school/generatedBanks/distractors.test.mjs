import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, sampleDistractors } from './distractors.mjs';

describe('generated-bank distractors', () => {
  it('is deterministic, excludes the answer, and de-duplicates the pool', () => {
    const first = sampleDistractors({ pool: ['A', 'B', 'B', 'C', 'D'], exclude: 'A', count: 3, seed: 'x' });
    const second = sampleDistractors({ pool: ['A', 'B', 'B', 'C', 'D'], exclude: 'A', count: 3, seed: 'x' });
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first).not.toContain('A');
    expect(new Set(first).size).toBe(3);
    expect(mulberry32(hashSeed('x'))()).toBe(mulberry32(hashSeed('x'))());
  });
});
