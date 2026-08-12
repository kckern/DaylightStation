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

  it('resolves a complete chord to exactly one square', () => {
    const lit = candidateSquares([60, 64, 67], S); // C major triad
    expect(lit).toHaveLength(1);
  });

  it('is octave- and order-free', () => {
    expect(candidateSquares([60, 64, 67], S)).toEqual(candidateSquares([67, 76, 48], S));
  });

  it('lights nothing when no square can contain what is held', () => {
    expect(candidateSquares([60, 61, 62], S)).toEqual([]); // a semitone cluster
  });
});
