import { describe, it, expect } from 'vitest';
import { shuffle, buildNotePool, isWhiteKey, getNoteName, computeKeyboardRange } from './noteUtils.js';

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

// ─── computeKeyboardRange ───────────────────────────────────────

describe('computeKeyboardRange', () => {
  it('pads range by ~1/3 of span on each side', () => {
    // Range [60, 72] = span 12, padding = max(4, round(12/3)) = 4
    // displayStart=56, displayEnd=76, displaySpan=20 < 24, extra=4, adjust -2/+2
    const { startNote, endNote } = computeKeyboardRange([60, 72]);
    expect(startNote).toBe(54); // 60 - 4 - 2 (min-span adjustment)
    expect(endNote).toBe(78);   // 72 + 4 + 2 (min-span adjustment)
  });

  it('enforces minimum 2-octave (24 semitone) display span', () => {
    // Range [60, 64] = span 4, padding = max(4, round(4/3)) = 4
    // displayStart=56, displayEnd=68, span=12 < 24, extra=12, adjust ±6
    const { startNote, endNote } = computeKeyboardRange([60, 64]);
    const span = endNote - startNote;
    expect(span).toBeGreaterThanOrEqual(24);
  });

  it('clamps to piano range [21, 108]', () => {
    const { startNote, endNote } = computeKeyboardRange([22, 30]);
    expect(startNote).toBeGreaterThanOrEqual(21);
    expect(endNote).toBeLessThanOrEqual(108);
  });

  it('clamps high end to 108', () => {
    const { startNote, endNote } = computeKeyboardRange([96, 108]);
    expect(endNote).toBe(108);
  });

  it('returns full piano range when noteRange is null', () => {
    const { startNote, endNote } = computeKeyboardRange(null);
    expect(startNote).toBe(21);
    expect(endNote).toBe(108);
  });
});
