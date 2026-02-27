import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  resetForLevel,
  isActivationComboHeld,
  generatePitches,
  getFallDuration,
  maybeSpawnNote,
  processHit,
  applyScore,
  processMisses,
  cleanupResolvedNotes,
  evaluateLevel,
  TOTAL_HEALTH,
} from './spaceInvadersEngine.js';

// ─── createInitialState ─────────────────────────────────────────

describe('createInitialState', () => {
  it('returns IDLE phase with full health', () => {
    const state = createInitialState();
    expect(state.phase).toBe('IDLE');
    expect(state.health).toBe(TOTAL_HEALTH);
    expect(state.fallingNotes).toEqual([]);
    expect(state.score.points).toBe(0);
  });
});

// ─── resetForLevel ──────────────────────────────────────────────

describe('resetForLevel', () => {
  it('sets phase to PLAYING and resets score/health', () => {
    const initial = createInitialState();
    const reset = resetForLevel(initial, 2);
    expect(reset.phase).toBe('PLAYING');
    expect(reset.levelIndex).toBe(2);
    expect(reset.health).toBe(TOTAL_HEALTH);
    expect(reset.score.points).toBe(0);
  });
});

// ─── isActivationComboHeld ──────────────────────────────────────

describe('isActivationComboHeld', () => {
  it('returns true when all combo notes are held within window', () => {
    const now = Date.now();
    const activeNotes = new Map([
      [30, { velocity: 100, timestamp: now }],
      [102, { velocity: 100, timestamp: now + 100 }],
    ]);
    expect(isActivationComboHeld(activeNotes, [30, 102], 300)).toBe(true);
  });

  it('returns false when a combo note is missing', () => {
    const activeNotes = new Map([
      [30, { velocity: 100, timestamp: Date.now() }],
    ]);
    expect(isActivationComboHeld(activeNotes, [30, 102], 300)).toBe(false);
  });

  it('returns false when window is exceeded', () => {
    const now = Date.now();
    const activeNotes = new Map([
      [30, { velocity: 100, timestamp: now }],
      [102, { velocity: 100, timestamp: now + 500 }],
    ]);
    expect(isActivationComboHeld(activeNotes, [30, 102], 300)).toBe(false);
  });
});

// ─── generatePitches ────────────────────────────────────────────

describe('generatePitches', () => {
  it('generates a single pitch from the pool', () => {
    const level = { notes: [60, 62, 64], simultaneous: 1 };
    const pitches = generatePitches(level, null);
    expect(pitches).toHaveLength(1);
    expect(level.notes).toContain(pitches[0]);
  });

  it('generates multiple simultaneous pitches', () => {
    const level = { notes: [60, 62, 64, 65, 67], simultaneous: 3 };
    const pitches = generatePitches(level, null);
    expect(pitches).toHaveLength(3);
    const unique = new Set(pitches);
    expect(unique.size).toBe(3);
  });

  it('sequential mode picks adjacent notes', () => {
    const level = { notes: [60, 62, 64], simultaneous: 1, sequential: true };
    const pitches = generatePitches(level, [62]);
    expect(pitches).toHaveLength(1);
    expect([60, 64]).toContain(pitches[0]); // must be adjacent to 62
  });
});

// ─── getFallDuration ────────────────────────────────────────────

describe('getFallDuration', () => {
  it('returns level-configured duration', () => {
    expect(getFallDuration({ fall_duration_ms: 5000 })).toBe(5000);
  });

  it('returns default when not configured', () => {
    expect(getFallDuration({})).toBe(2500);
  });

  it('handles null level', () => {
    expect(getFallDuration(null)).toBe(2500);
  });
});

// ─── processHit ─────────────────────────────────────────────────

describe('processHit', () => {
  it('returns perfect for invaders mode regardless of timing', () => {
    const state = {
      ...createInitialState(),
      fallingNotes: [{
        id: 1, pitches: [60], targetTime: 1000, state: 'falling',
        hitResult: null, hitPitches: new Set(),
      }],
    };
    const timing = { perfect_ms: 80, good_ms: 200 };
    const { result } = processHit(state, 60, 5000, timing, 'invaders');
    expect(result).toBe('perfect');
  });

  it('returns null when pitch does not match any falling note', () => {
    const state = {
      ...createInitialState(),
      fallingNotes: [{
        id: 1, pitches: [60], targetTime: 1000, state: 'falling',
        hitResult: null, hitPitches: new Set(),
      }],
    };
    const timing = { perfect_ms: 80, good_ms: 200 };
    const { result } = processHit(state, 62, 1000, timing, 'invaders');
    expect(result).toBeNull();
  });
});

// ─── applyScore ─────────────────────────────────────────────────

describe('applyScore', () => {
  it('awards points with combo multiplier', () => {
    const score = { points: 0, combo: 2, maxCombo: 2, perfects: 0, goods: 0, misses: 0 };
    const config = { perfect_points: 100, good_points: 50, combo_multiplier: 0.1 };
    const result = applyScore(score, 'perfect', config);
    expect(result.combo).toBe(3);
    expect(result.points).toBeGreaterThan(100); // multiplied
    expect(result.perfects).toBe(1);
  });
});

// ─── evaluateLevel ──────────────────────────────────────────────

describe('evaluateLevel', () => {
  const levelConfig = { points_to_advance: 1000, max_misses: 5 };

  it('returns advance when points threshold met', () => {
    const score = { points: 1000, misses: 0 };
    expect(evaluateLevel(score, levelConfig, TOTAL_HEALTH)).toBe('advance');
  });

  it('returns fail when health is 0', () => {
    const score = { points: 0, misses: 0 };
    expect(evaluateLevel(score, levelConfig, 0)).toBe('fail');
  });

  it('returns fail when misses exceed max', () => {
    const score = { points: 0, misses: 5 };
    expect(evaluateLevel(score, levelConfig, TOTAL_HEALTH)).toBe('fail');
  });

  it('returns null when game is still in progress', () => {
    const score = { points: 500, misses: 2 };
    expect(evaluateLevel(score, levelConfig, TOTAL_HEALTH)).toBeNull();
  });
});
