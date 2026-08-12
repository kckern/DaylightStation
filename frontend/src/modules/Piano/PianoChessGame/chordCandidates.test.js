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

  it('maintains monotonicity: candidates form nested subsets as notes are added', () => {
    // Property test: for any sequence of held-note prefixes, each step's candidate
    // set must be a subset of the previous step's. Tests varied interval shapes to
    // ensure the invariant holds across different harmonic contexts.

    const testShapes = [
      // Major triad (root-position): 0, 4, 7 semitones
      { name: 'major triad', intervals: [0, 4, 7], bases: [60, 64, 67] },
      // Seventh chord: 0, 4, 7, 10 semitones
      { name: 'seventh chord', intervals: [0, 4, 7, 10], bases: [60, 64, 67, 70] },
      // Major second + perfect fourth: 0, 2, 5 semitones (critical case from reviewer)
      { name: 'second+fourth', intervals: [0, 2, 5], bases: [60, 62, 65] },
      // Tritone + major third: 0, 6, 10 semitones (wide intervals)
      { name: 'tritone+third', intervals: [0, 6, 10], bases: [60, 66, 70] },
      // Dense seconds and fourths: 0, 2, 5, 7 semitones
      { name: 'complex cluster', intervals: [0, 2, 5, 7], bases: [60, 62, 65, 67] },
    ];

    for (const shape of testShapes) {
      // Build prefixes of this shape and test monotonicity at every step
      for (let prefixLen = 1; prefixLen < shape.bases.length; prefixLen++) {
        const prefix = shape.bases.slice(0, prefixLen);
        const extended = shape.bases.slice(0, prefixLen + 1);

        const candidatesAtPrefix = candidateSquares(prefix, S);
        const candidatesAtExtended = candidateSquares(extended, S);

        // The invariant: extending the note set must not light new squares
        const newSquares = candidatesAtExtended.filter((sq) => !candidatesAtPrefix.includes(sq));
        expect(newSquares, `${shape.name} at prefix [${prefix}]: new squares lit: ${newSquares}`).toEqual([]);

        // Also check size decreases or stays equal
        expect(candidatesAtExtended.length).toBeLessThanOrEqual(candidatesAtPrefix.length);
      }
    }
  });
});
