import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  generateTargets,
  isActionMatched,
} from './useStaffMatching.js';

// ─── generateTargets ────────────────────────────────────────────

describe('generateTargets', () => {
  it('generates targets for all 4 actions', () => {
    const targets = generateTargets([60, 80]);
    expect(Object.keys(targets)).toEqual(ACTIONS);
    for (const action of ACTIONS) {
      expect(Array.isArray(targets[action])).toBe(true);
      expect(targets[action].length).toBeGreaterThan(0);
    }
  });

  it('single-note targets with complexity=single (each array length 1)', () => {
    const targets = generateTargets([60, 80], 'single');
    for (const action of ACTIONS) {
      expect(targets[action].length).toBe(1);
    }
  });

  it('dyad targets with complexity=dyad (each array length 2)', () => {
    const targets = generateTargets([60, 80], 'dyad');
    for (const action of ACTIONS) {
      expect(targets[action].length).toBe(2);
    }
  });

  it('triad targets with complexity=triad (each array length 3)', () => {
    const targets = generateTargets([48, 84], 'triad');
    for (const action of ACTIONS) {
      expect(targets[action].length).toBe(3);
    }
  });

  it('no duplicate notes across targets', () => {
    const targets = generateTargets([60, 80], 'dyad');
    const allNotes = [];
    for (const action of ACTIONS) {
      allNotes.push(...targets[action]);
    }
    const unique = new Set(allNotes);
    expect(unique.size).toBe(allNotes.length);
  });

  it('all notes stay within note range', () => {
    const low = 60;
    const high = 72;
    const targets = generateTargets([low, high], 'single');
    for (const action of ACTIONS) {
      for (const note of targets[action]) {
        expect(note).toBeGreaterThanOrEqual(low);
        expect(note).toBeLessThanOrEqual(high);
      }
    }
  });

  it('falls back to single note if not enough notes for requested complexity', () => {
    // Range of only 4 notes, triad needs 12 — should fall back to single (1 each)
    const targets = generateTargets([60, 63], 'triad');
    for (const action of ACTIONS) {
      expect(targets[action].length).toBe(1);
    }
  });
});

// ─── isActionMatched ────────────────────────────────────────────

describe('isActionMatched', () => {
  it('returns true when all target pitches are active', () => {
    const activeNotes = new Map([
      [60, { velocity: 100, timestamp: 1000 }],
      [64, { velocity: 80, timestamp: 1001 }],
      [67, { velocity: 90, timestamp: 1002 }],
    ]);
    expect(isActionMatched(activeNotes, [60, 64])).toBe(true);
  });

  it('returns false when some pitches missing', () => {
    const activeNotes = new Map([
      [60, { velocity: 100, timestamp: 1000 }],
    ]);
    expect(isActionMatched(activeNotes, [60, 64])).toBe(false);
  });

  it('returns true for single-note match', () => {
    const activeNotes = new Map([
      [72, { velocity: 100, timestamp: 1000 }],
    ]);
    expect(isActionMatched(activeNotes, [72])).toBe(true);
  });

  it('returns false for empty activeNotes', () => {
    const activeNotes = new Map();
    expect(isActionMatched(activeNotes, [60])).toBe(false);
  });

  it('returns true for empty target pitches (vacuously true)', () => {
    const activeNotes = new Map();
    expect(isActionMatched(activeNotes, [])).toBe(true);
  });
});
