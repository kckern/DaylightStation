import { describe, it, expect } from 'vitest';
import { isWhiteKey } from '../noteUtils.js';
import { generateCardPitches, evaluateMatch } from './flashcardEngine.js';

// ─── generateCardPitches ────────────────────────────────────────

describe('generateCardPitches', () => {
  it('returns 1 pitch for single complexity', () => {
    const pitches = generateCardPitches([60, 72], 'single');
    expect(pitches).toHaveLength(1);
    expect(pitches[0]).toBeGreaterThanOrEqual(60);
    expect(pitches[0]).toBeLessThanOrEqual(72);
  });

  it('returns 2 pitches for dyad', () => {
    const pitches = generateCardPitches([60, 72], 'dyad');
    expect(pitches).toHaveLength(2);
  });

  it('returns 3 pitches for triad', () => {
    const pitches = generateCardPitches([48, 84], 'triad');
    expect(pitches).toHaveLength(3);
  });

  it('returns unique pitches', () => {
    const pitches = generateCardPitches([60, 72], 'triad');
    expect(new Set(pitches).size).toBe(pitches.length);
  });

  it('respects white_keys_only filter', () => {
    for (let i = 0; i < 30; i++) {
      const pitches = generateCardPitches([60, 72], 'single', true);
      for (const p of pitches) {
        expect(isWhiteKey(p)).toBe(true);
      }
    }
  });

  it('respects note range bounds', () => {
    for (let i = 0; i < 30; i++) {
      const pitches = generateCardPitches([65, 70], 'single');
      for (const p of pitches) {
        expect(p).toBeGreaterThanOrEqual(65);
        expect(p).toBeLessThanOrEqual(70);
      }
    }
  });

  it('falls back to fewer notes if range too small', () => {
    const pitches = generateCardPitches([60, 61], 'triad');
    expect(pitches.length).toBeLessThanOrEqual(2);
    expect(pitches.length).toBeGreaterThan(0);
  });
});

// ─── evaluateMatch ──────────────────────────────────────────────

describe('evaluateMatch', () => {
  const makeNotes = (...notes) => new Map(notes.map(n => [n, { velocity: 100, timestamp: 0 }]));

  it('returns idle when no notes pressed', () => {
    const result = evaluateMatch(new Map(), [60]);
    expect(result).toBe('idle');
  });

  it('returns correct when single target matched', () => {
    expect(evaluateMatch(makeNotes(60), [60])).toBe('correct');
  });

  it('returns wrong when non-target note pressed alone', () => {
    expect(evaluateMatch(makeNotes(62), [60])).toBe('wrong');
  });

  it('returns correct when all chord notes held (with extras)', () => {
    expect(evaluateMatch(makeNotes(60, 64, 67, 72), [60, 64, 67])).toBe('correct');
  });

  it('returns partial when some chord notes held, no wrong notes', () => {
    expect(evaluateMatch(makeNotes(60, 64), [60, 64, 67])).toBe('partial');
  });

  it('returns wrong when mix of correct and wrong notes, chord incomplete', () => {
    expect(evaluateMatch(makeNotes(60, 63), [60, 64, 67])).toBe('wrong');
  });

  it('returns idle for null/empty inputs', () => {
    expect(evaluateMatch(null, [60])).toBe('idle');
    expect(evaluateMatch(new Map(), [])).toBe('idle');
    expect(evaluateMatch(new Map(), null)).toBe('idle');
  });
});
