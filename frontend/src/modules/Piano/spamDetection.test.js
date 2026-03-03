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

  it('returns false for 9 notes (below threshold)', () => {
    expect(detectNoteCountSpam(notesMap([60, 61, 62, 63, 64, 65, 66, 67, 68]))).toBe(false);
  });

  it('returns true for exactly 10 notes (at threshold)', () => {
    expect(detectNoteCountSpam(notesMap([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]))).toBe(true);
  });

  it('returns true for 12 notes (above threshold)', () => {
    const pitches = Array.from({ length: 12 }, (_, i) => 48 + i);
    expect(detectNoteCountSpam(notesMap(pitches))).toBe(true);
  });
});

// ─── detectDenseClusterSpam ───────────────────────────────────

describe('detectDenseClusterSpam', () => {
  it('returns false for empty Map', () => {
    expect(detectDenseClusterSpam(new Map())).toBe(false);
  });

  it('returns false for small chord [60,61,62] — below 6 minimum', () => {
    expect(detectDenseClusterSpam(notesMap([60, 61, 62]))).toBe(false);
  });

  it('returns false for 5 black keys [61,63,66,68,70] — below 6 minimum', () => {
    expect(detectDenseClusterSpam(notesMap([61, 63, 66, 68, 70]))).toBe(false);
  });

  // ── SPAM cases ──

  it('detects fist smash [60,61,62,63,64,65] — density 1.0', () => {
    // 6 notes, range 5, density = 6/6 = 1.0
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 64, 65]))).toBe(true);
  });

  it('detects two-fist smash [60,61,62,63,66,68,70,73] — density 0.57', () => {
    // 8 notes, range 13, density = 8/14 = 0.57
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 66, 68, 70, 73]))).toBe(true);
  });

  it('detects 7 chromatic [60,61,62,63,64,65,66] — density 1.0', () => {
    // 7 notes, range 6, density = 7/7 = 1.0
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 64, 65, 66]))).toBe(true);
  });

  // ── SAFE cases ──

  it('passes legit chord [48,52,55,60,64,67,71,72] — density 0.32', () => {
    // 8 notes, range 24, density = 8/25 = 0.32
    expect(detectDenseClusterSpam(notesMap([48, 52, 55, 60, 64, 67, 71, 72]))).toBe(false);
  });

  it('passes 8 black keys spread [61,63,66,68,70,73,75,78] — density never > 0.5', () => {
    // Pentatonic-like spacing means no 6-note window hits 0.5
    expect(detectDenseClusterSpam(notesMap([61, 63, 66, 68, 70, 73, 75, 78]))).toBe(false);
  });

  it('returns false for exactly 5 notes even if dense', () => {
    // 5 chromatic notes: below the 6-note minimum
    expect(detectDenseClusterSpam(notesMap([60, 61, 62, 63, 64]))).toBe(false);
  });

  it('detects spam in a subset window even if overall density is low', () => {
    // 10 notes total, but notes 60-65 form a dense cluster
    const pitches = [36, 40, 44, 60, 61, 62, 63, 64, 65, 96];
    expect(detectDenseClusterSpam(notesMap(pitches))).toBe(true);
  });
});

// ─── detectRapidFireSpam ──────────────────────────────────────

describe('detectRapidFireSpam', () => {
  it('returns false for empty history', () => {
    expect(detectRapidFireSpam([], 10000)).toBe(false);
  });

  it('returns false for 15 notes in window (below threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 15 }, (_, i) => ({
      startTime: now - 100 * i,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('returns true for 20 notes in window (at threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 20 }, (_, i) => ({
      startTime: now - 100 * i, // 0ms to 1900ms ago — all within 3s
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('returns true for 25 notes in window (above threshold)', () => {
    const now = 10000;
    const history = Array.from({ length: 25 }, (_, i) => ({
      startTime: now - 50 * i,
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('ignores old notes outside the 3-second window', () => {
    const now = 10000;
    // 30 notes total, but only 10 within the window
    const oldNotes = Array.from({ length: 20 }, (_, i) => ({
      startTime: 1000 + i * 50, // 5000-9000ms ago
    }));
    const recentNotes = Array.from({ length: 10 }, (_, i) => ({
      startTime: now - 100 * i, // 0-900ms ago
    }));
    const history = [...oldNotes, ...recentNotes];
    expect(detectRapidFireSpam(history, now)).toBe(false);
  });

  it('returns true when exactly 20 notes at boundary of 3-second window', () => {
    const now = 10000;
    // 20 notes evenly spaced across exactly 3000ms (inclusive)
    const history = Array.from({ length: 20 }, (_, i) => ({
      startTime: now - Math.floor((2999 / 19) * i), // all within 2999ms
    }));
    expect(detectRapidFireSpam(history, now)).toBe(true);
  });

  it('returns false when 20 notes span just beyond 3-second window', () => {
    const now = 10000;
    // Oldest note is exactly 3001ms ago — outside the window
    const history = Array.from({ length: 20 }, (_, i) => ({
      startTime: now - Math.floor((3001 / 19) * i),
    }));
    // The oldest note at index 0 is 3001ms ago, so only 19 fit in window
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
