import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  generateTargets,
  isActionMatched,
  computeProgression,
  assignChordSizes,
  DEFAULT_PROGRESSION,
} from './useStaffMatching.js';

// multiset helper: count occurrences of each value
function counts(arr) {
  const m = {};
  for (const v of arr) m[v] = (m[v] || 0) + 1;
  return m;
}

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

// ─── computeProgression ─────────────────────────────────────────

describe('computeProgression', () => {
  const T = DEFAULT_PROGRESSION.thresholds; // { treble:1, bass:2, dyad:3, triad:5, accidentals:7 }

  it('baseline (0 lines): treble range, single only, white keys only', () => {
    const p = computeProgression(0);
    expect(p.noteRange).toEqual(DEFAULT_PROGRESSION.treble_range);
    expect(p.unlockedChordSizes).toEqual([1]);
    expect(p.whiteKeysOnly).toBe(true);
  });

  it('below bass threshold keeps treble range', () => {
    const p = computeProgression(T.bass - 1);
    expect(p.noteRange).toEqual(DEFAULT_PROGRESSION.treble_range);
  });

  it('at bass threshold switches to bass range', () => {
    const p = computeProgression(T.bass);
    expect(p.noteRange).toEqual(DEFAULT_PROGRESSION.bass_range);
  });

  it('below dyad threshold has only singles', () => {
    const p = computeProgression(T.dyad - 1);
    expect(p.unlockedChordSizes).toEqual([1]);
  });

  it('at dyad threshold unlocks dyads', () => {
    const p = computeProgression(T.dyad);
    expect(p.unlockedChordSizes).toEqual([1, 2]);
  });

  it('below triad threshold has no triads', () => {
    const p = computeProgression(T.triad - 1);
    expect(p.unlockedChordSizes).not.toContain(3);
  });

  it('at triad threshold unlocks triads', () => {
    const p = computeProgression(T.triad);
    expect(p.unlockedChordSizes).toEqual([1, 2, 3]);
  });

  it('below accidentals threshold stays white keys only', () => {
    const p = computeProgression(T.accidentals - 1);
    expect(p.whiteKeysOnly).toBe(true);
  });

  it('at accidentals threshold enables sharps/flats', () => {
    const p = computeProgression(T.accidentals);
    expect(p.whiteKeysOnly).toBe(false);
  });

  it('honors custom thresholds from config', () => {
    const config = { thresholds: { bass: 4, dyad: 6, triad: 8, accidentals: 10 } };
    expect(computeProgression(3, config).noteRange).toEqual(DEFAULT_PROGRESSION.treble_range);
    expect(computeProgression(4, config).noteRange).toEqual(DEFAULT_PROGRESSION.bass_range);
    expect(computeProgression(5, config).unlockedChordSizes).toEqual([1]);
    expect(computeProgression(6, config).unlockedChordSizes).toEqual([1, 2]);
    expect(computeProgression(9, config).whiteKeysOnly).toBe(true);
    expect(computeProgression(10, config).whiteKeysOnly).toBe(false);
  });

  it('honors custom ranges from config, merging partial config with defaults', () => {
    const config = { treble_range: [64, 76], bass_range: [40, 76] };
    expect(computeProgression(0, config).noteRange).toEqual([64, 76]);
    expect(computeProgression(2, config).noteRange).toEqual([40, 76]);
    // thresholds fall back to defaults when not provided
    expect(computeProgression(2, config).noteRange).toEqual([40, 76]);
    expect(computeProgression(1, config).noteRange).toEqual([64, 76]);
  });
});

// ─── assignChordSizes ───────────────────────────────────────────

describe('assignChordSizes', () => {
  it('returns one size per staff', () => {
    expect(assignChordSizes([1, 2, 3], 6)).toHaveLength(6);
  });

  it('all singles when only single is unlocked', () => {
    expect(assignChordSizes([1], 6)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('only ever emits sizes from the unlocked set (additive mix, not forced)', () => {
    const sizes = assignChordSizes([1, 3], 6);
    for (const s of sizes) expect([1, 3]).toContain(s);
  });

  it('every unlocked size is reachable in the random mix', () => {
    // Large sample so all unlocked sizes appear with overwhelming probability
    const c = counts(assignChordSizes([1, 2, 3], 300));
    expect(Object.keys(c).map(Number).sort()).toEqual([1, 2, 3]);
  });
});

// ─── generateTargets with per-staff size array ──────────────────

describe('generateTargets (per-staff sizes)', () => {
  it('gives each staff the count from the array', () => {
    const sizes = [1, 2, 3, 1, 2, 3];
    const targets = generateTargets([48, 84], sizes);
    ACTIONS.forEach((action, i) => {
      expect(targets[action].length).toBe(sizes[i]);
    });
  });

  it('no duplicate notes across mixed-size staves on a wide range', () => {
    const targets = generateTargets([48, 84], [1, 2, 3, 1, 2, 3]);
    const all = ACTIONS.flatMap((a) => targets[a]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps every dyad/triad within one octave (span <= 12 semitones), even on a 3-octave range', () => {
    const sizes = [2, 3, 2, 3, 2, 3];
    // Many trials: random selection must NEVER produce an out-of-octave chord.
    for (let trial = 0; trial < 100; trial++) {
      const targets = generateTargets([48, 84], sizes); // C3..C6, 3 octaves
      ACTIONS.forEach((action) => {
        const pitches = targets[action];
        if (pitches.length >= 2) {
          const span = Math.max(...pitches) - Math.min(...pitches);
          expect(span).toBeLessThanOrEqual(12);
        }
      });
    }
  });

  it('octave-clustered chords still respect whiteKeysOnly', () => {
    const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (let trial = 0; trial < 20; trial++) {
      const targets = generateTargets([48, 84], [3, 3, 3, 3, 3, 3], true);
      const all = ACTIONS.flatMap((a) => targets[a]);
      for (const p of all) expect(WHITE.has(((p % 12) + 12) % 12)).toBe(true);
    }
  });

  it('still gives each staff its requested count when the range has room', () => {
    const sizes = [1, 2, 3, 1, 2, 3];
    const targets = generateTargets([48, 84], sizes);
    ACTIONS.forEach((action, i) => {
      expect(targets[action].length).toBe(sizes[i]);
    });
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
