import { describe, it, expect } from 'vitest';
import { shuffle, buildNotePool, isWhiteKey, getNoteName } from './noteUtils.js';

// ─── shuffle ────────────────────────────────────────────────────

describe('shuffle', () => {
  it('returns the same array (in-place)', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toBe(arr);
  });

  it('preserves all elements', () => {
    const arr = [10, 20, 30, 40, 50];
    shuffle(arr);
    expect(arr.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });

  it('handles single-element array', () => {
    const arr = [42];
    expect(shuffle(arr)).toEqual([42]);
  });

  it('handles empty array', () => {
    expect(shuffle([])).toEqual([]);
  });
});

// ─── buildNotePool ─────────────────────────────────────────────

describe('buildNotePool', () => {
  it('returns all notes in range', () => {
    const pool = buildNotePool([60, 64]);
    expect(pool).toEqual([60, 61, 62, 63, 64]);
  });

  it('filters to white keys only', () => {
    const pool = buildNotePool([60, 72], true);
    for (const note of pool) {
      expect(isWhiteKey(note)).toBe(true);
    }
    // C4-C5 white keys: C D E F G A B C = 8 notes
    expect(pool).toHaveLength(8);
  });

  it('includes black keys by default', () => {
    const pool = buildNotePool([60, 72]);
    // C4-C5 = 13 notes (all chromatic)
    expect(pool).toHaveLength(13);
  });

  it('returns empty array for invalid range', () => {
    expect(buildNotePool([72, 60])).toEqual([]);
  });
});

// ─── getNoteName ────────────────────────────────────────────────

describe('getNoteName', () => {
  it('returns correct name for middle C', () => {
    expect(getNoteName(60)).toBe('C4');
  });

  it('returns correct name for sharps', () => {
    expect(getNoteName(61)).toBe('C#4');
  });
});
