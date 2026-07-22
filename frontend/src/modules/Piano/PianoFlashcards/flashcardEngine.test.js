import { describe, it, expect } from 'vitest';
import { isWhiteKey } from '../noteUtils.js';
import {
  generateCardPitches,
  evaluateMatch,
  CHORD_QUALITIES,
  generateChordCard,
  evaluateChordMatch,
  rootPositionVoicing,
  resolveStartLevel,
} from './flashcardEngine.js';

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

// ─── generateChordCard ──────────────────────────────────────────

describe('generateChordCard', () => {
  it('returns a chord card with quality from the allowed list', () => {
    for (let i = 0; i < 30; i++) {
      const card = generateChordCard(['major', 'minor7']);
      expect(card.type).toBe('chord');
      expect(['major', 'minor7']).toContain(card.quality);
      expect(card.root).toBeGreaterThanOrEqual(0);
      expect(card.root).toBeLessThanOrEqual(11);
    }
  });

  it('pitch classes are the quality template transposed to the root', () => {
    for (let i = 0; i < 30; i++) {
      const card = generateChordCard(['dominant7']);
      const expected = CHORD_QUALITIES.dominant7.intervals.map(iv => (card.root + iv) % 12);
      expect([...card.pitchClasses].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    }
  });

  it('builds display labels from sharp root name + quality suffix', () => {
    for (let i = 0; i < 30; i++) {
      const card = generateChordCard(['minor']);
      expect(card.label).toBe(`${card.rootName}m`);
    }
  });

  it('never repeats the exact previous (root, quality) card', () => {
    let prev = generateChordCard(['major']);
    for (let i = 0; i < 50; i++) {
      const card = generateChordCard(['major'], prev);
      expect(card.root === prev.root && card.quality === prev.quality).toBe(false);
      prev = card;
    }
  });
});

// ─── evaluateChordMatch ─────────────────────────────────────────

describe('evaluateChordMatch', () => {
  const makeNotes = (...notes) => new Map(notes.map(n => [n, { velocity: 100, timestamp: 0 }]));
  const cMajor = { type: 'chord', root: 0, quality: 'major', pitchClasses: new Set([0, 4, 7]) };
  const cMinor = { type: 'chord', root: 0, quality: 'minor', pitchClasses: new Set([0, 3, 7]) };

  it('returns idle for empty/null input', () => {
    expect(evaluateChordMatch(new Map(), cMajor)).toBe('idle');
    expect(evaluateChordMatch(null, cMajor)).toBe('idle');
    expect(evaluateChordMatch(makeNotes(60), null)).toBe('idle');
  });

  it('correct for root-position C major at any octave', () => {
    expect(evaluateChordMatch(makeNotes(60, 64, 67), cMajor)).toBe('correct');
    expect(evaluateChordMatch(makeNotes(48, 52, 55), cMajor)).toBe('correct');
  });

  it('correct with doubled tones as long as bass is the root', () => {
    expect(evaluateChordMatch(makeNotes(48, 60, 64, 67, 72), cMajor)).toBe('correct');
  });

  it('correct for open voicings when bass is the root', () => {
    // C2 bass, chord tones spread above
    expect(evaluateChordMatch(makeNotes(36, 55, 64, 72), cMajor)).toBe('correct');
  });

  it('wrong when complete but bass is not the root (Cm/Eb is not Cm)', () => {
    // Eb3 in the bass under C4 + G4 — all tones of Cm present, bass = Eb
    expect(evaluateChordMatch(makeNotes(51, 60, 67), cMinor)).toBe('wrong');
    // First inversion C major: E in the bass
    expect(evaluateChordMatch(makeNotes(52, 60, 67), cMajor)).toBe('wrong');
  });

  it('wrong when any non-chord-tone is held', () => {
    expect(evaluateChordMatch(makeNotes(60, 64, 66), cMajor)).toBe('wrong');
    expect(evaluateChordMatch(makeNotes(60, 64, 67, 70), cMajor)).toBe('wrong');
  });

  it('partial for an incomplete subset of chord tones with no extras', () => {
    expect(evaluateChordMatch(makeNotes(60), cMajor)).toBe('partial');
    expect(evaluateChordMatch(makeNotes(60, 67), cMajor)).toBe('partial');
  });
});

// ─── rootPositionVoicing ────────────────────────────────────────

describe('rootPositionVoicing', () => {
  it('voices C major in root position from C4', () => {
    const card = { root: 0, quality: 'major' };
    expect(rootPositionVoicing(card)).toEqual([60, 64, 67]);
  });

  it('voices A minor 7 from A4', () => {
    const card = { root: 9, quality: 'minor7' };
    expect(rootPositionVoicing(card)).toEqual([69, 72, 76, 79]);
  });
});

// ─── resolveStartLevel ──────────────────────────────────────────

describe('resolveStartLevel', () => {
  const levels = [
    { name: 'White Keys' },
    { name: 'All Keys' },
    { name: 'Major Chords' },
  ];

  it('resolves a named start level for a known user', () => {
    expect(resolveStartLevel(levels, { kckern: 'Major Chords' }, 'kckern')).toBe(2);
  });

  it('falls back to 0 for unknown users, missing maps, or unknown level names', () => {
    expect(resolveStartLevel(levels, { kckern: 'Major Chords' }, 'milo')).toBe(0);
    expect(resolveStartLevel(levels, { kckern: 'Major Chords' }, null)).toBe(0);
    expect(resolveStartLevel(levels, undefined, 'kckern')).toBe(0);
    expect(resolveStartLevel(levels, { kckern: 'No Such Level' }, 'kckern')).toBe(0);
  });
});
