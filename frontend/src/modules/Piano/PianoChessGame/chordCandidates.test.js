import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME } from './chordAddress.js';
import { candidateSquares } from './chordCandidates.js';

const S = DEFAULT_CHORD_SCHEME;

describe('candidateSquares', () => {
  it('lights nothing when no keys are down', () => {
    expect(candidateSquares([], S)).toEqual([]);
  });

  it('lights many squares for a single note, spanning more than one file and rank', () => {
    const lit = candidateSquares([60], S); // middle C
    expect(lit.length).toBeGreaterThan(1);
    expect(new Set(lit.map((sq) => sq[0])).size).toBeGreaterThan(1); // several files
    expect(new Set(lit.map((sq) => sq[1])).size).toBeGreaterThan(1); // several ranks
  });

  it('narrows as notes are added', () => {
    const one = candidateSquares([60], S);
    const two = candidateSquares([60, 64], S);
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((sq) => one.includes(sq))).toBe(true); // strictly a subset
  });

  it('leaves the triad and its extensions lit, all rooted on the same file', () => {
    const lit = candidateSquares([60, 64, 67], S); // C major triad
    expect(lit).toEqual(['c1', 'c4', 'c5', 'c6', 'c7']);
    expect(new Set(lit.map((sq) => sq[0]))).toEqual(new Set(['c']));
  });

  it('is octave- and order-free', () => {
    expect(candidateSquares([60, 64, 67], S)).toEqual(candidateSquares([67, 76, 48], S));
  });

  it('lights nothing when no square can contain what is held', () => {
    expect(candidateSquares([60, 61, 62], S)).toEqual([]); // a semitone cluster
  });

  it('maintains monotonicity: adding notes never lights new squares', () => {
    // Test several starting notes to verify the monotonicity invariant
    const starts = [60, 61, 64, 67];
    for (const start of starts) {
      const one = candidateSquares([start], S);
      const two = candidateSquares([start, start + 4], S);
      const three = candidateSquares([start, start + 4, start + 7], S);

      // Each step should be a subset of the previous
      expect(two.every((sq) => one.includes(sq))).toBe(true);
      expect(three.every((sq) => two.includes(sq))).toBe(true);

      // Sizes should monotonically decrease or stay equal
      expect(two.length).toBeLessThanOrEqual(one.length);
      expect(three.length).toBeLessThanOrEqual(two.length);
    }
  });
});
