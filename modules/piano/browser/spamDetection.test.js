import { describe, it, expect } from 'vitest';
import {
  detectNoteCountSpam,
  detectDenseClusterSpam,
  detectRapidFireSpam,
} from './spamDetection.js';

// Helper: build a Map from an array of MIDI note numbers
function notesMap(pitches) {
  const map = new Map();
  for (const p of pitches) map.set(p, { startTime: 0 });
  return map;
}

// ─── detectNoteCountSpam ──────────────────────────────────────

describe('detectNoteCountSpam', () => {
  it('returns false for empty Map', () => {
    expect(detectNoteCountSpam(new Map())).toBe(false);
  });

  it('returns false for 10 notes (full chord with all fingers)', () => {
    expect(detectNoteCountSpam(notesMap([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]))).toBe(false);
  });

  it('returns false for 14 notes (sustain pedal held)', () => {
    const pitches = Array.from({ length: 14 }, (_, i) => 48 + i);
    expect(detectNoteCountSpam(notesMap(pitches))).toBe(false);
  });

  it('returns true for exactly 15 notes (at threshold)', () => {
    const pitches = Array.from({ length: 15 }, (_, i) => 48 + i);
    expect(detectNoteCountSpam(notesMap(pitches))).toBe(true);
  });

  it('returns true for 20 notes (above threshold)', () => {
    const pitches = Array.from({ length: 20 }, (_, i) => 36 + i);
    expect(detectNoteCountSpam(notesMap(pitches))).toBe(true);
  });
});

// ─── detectDenseClusterSpam ───────────────────────────────────

describe('detectDenseClusterSpam', () => {
  it('returns false for empty Map', () => {
    expect(detectDenseClusterSpam(new Map())).toBe(false);
  });

  it('returns false for small chord [60,61,62] — below 10 minimum', () => {
    expect(detectDenseClusterSpam(notesMap([60, 61, 62]))).toBe(false);
  });

  it('returns false for 6 chromatic notes — below 10 minimum', () => {
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 64, 65]))).toBe(false);
  });

  it('returns false for 9 notes even if dense — below 10 minimum', () => {
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 64, 65, 66, 67, 68]))).toBe(false);
  });

  // ── SPAM cases ──

  it('detects forearm smash — 12 chromatic notes, density 1.0', () => {
    // 12 notes, range 11, density = 12/12 = 1.0
    const pitches = Array.from({ length: 12 }, (_, i) => 60 + i);
    expect(detectDenseClusterSpam(notesMap(pitches))).toBe(true);
  });

  it('detects two-fist smash — 10 adjacent notes, density 1.0', () => {
    // 10 notes, range 9, density = 10/10 = 1.0
    const pitches = Array.from({ length: 10 }, (_, i) => 55 + i);
    expect(detectDenseClusterSpam(notesMap(pitches))).toBe(true);
  });

  // ── SAFE cases ──

  it('passes legit big chord [48,52,55,60,64,67,71,72,76,79] — density 0.32', () => {
    // 10 notes, range 31, density = 10/32 = 0.31
    expect(detectDenseClusterSpam(notesMap([48, 52, 55, 60, 64, 67, 71, 72, 76, 79]))).toBe(false);
  });

  it('passes 10 pentatonic notes spread across octaves', () => {
    // C pentatonic across 3 octaves — wide spacing
    expect(detectDenseClusterSpam(notesMap([48, 50, 52, 55, 57, 60, 62, 64, 67, 69]))).toBe(false);
  });

  it('detects spam in a subset window even if overall density is low', () => {
    // 14 notes total, but notes 60-69 form a dense 10-note cluster
    const pitches = [36, 40, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 84, 96];
    expect(detectDenseClusterSpam(notesMap(pitches))).toBe(true);
  });
});

// ─── detectRapidFireSpam ──────────────────────────────────────

describe('detectRapidFireSpam', () => {
  it('returns false for empty history', () => {
    expect(detectRapidFireSpam([], 10000)).toBe(false);
  });

  it('returns false for 30 notes in window (fast scale run, below threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 30 }, (_, i) => ({
      startTime: now - 100 * i,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('returns true for 40 notes in window (at threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 40 }, (_, i) => ({
      startTime: now - 70 * i, // 0ms to 2730ms ago — all within 3s
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('returns true for 50 notes in window (above threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 50 }, (_, i) => ({
      startTime: now - 50 * i,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('ignores old notes outside the 3-second window', () => {
    const now = 10000;
    // 50 notes total, but only 20 within the window
    const oldNotes = Array.from({ length: 30 }, (_, i) => ({
      startTime: 1000 + i * 50, // very old
    }));
    const recentNotes = Array.from({ length: 20 }, (_, i) => ({
      startTime: now - 100 * i, // 0-1900ms ago
    }));
    const history = [...oldNotes, ...recentNotes];
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('returns true when exactly 40 notes at boundary of 3-second window', () => {
    const now = 10000;
    const history = Array.from({ length: 40 }, (_, i) => ({
      startTime: now - Math.floor((2999 / 39) * i), // all within 2999ms
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('returns false when only 39 notes fall within 3-second window', () => {
    const now = 10000;
    // 39 recent notes within window + 10 old notes outside
    const recentNotes = Array.from({ length: 39 }, (_, i) => ({
      startTime: now - Math.floor((2999 / 38) * i),
    }));
    const oldNotes = Array.from({ length: 10 }, (_, i) => ({
      startTime: now - 5000 - i * 100,
    }));
    const history = [...oldNotes, ...recentNotes];
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('breaks early on old notes for efficiency', () => {
    const now = 10000;
    // 1000 old notes, then 5 recent — should not iterate all 1000
    const oldNotes = Array.from({ length: 1000 }, (_, i) => ({
      startTime: i, // all very old
    }));
    const recentNotes = Array.from({ length: 5 }, (_, i) => ({
      startTime: now - i * 100,
    }));
    const history = [...oldNotes, ...recentNotes];
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });
});
