/**
 * Space Invaders Game Engine — Pure functions, no React
 *
 * State shape:
 * {
 *   phase: 'IDLE' | 'STARTING' | 'PLAYING' | 'LEVEL_COMPLETE' | 'LEVEL_FAILED' | 'VICTORY',
 *   levelIndex: number,
 *   fallingNotes: Array<{ id, pitches, targetTime, state, hitResult }>,
 *   score: { points, combo, maxCombo, perfects, goods, misses },
 *   countdown: number | null,  // 3, 2, 1, 0(GO), null
 *   nextNoteId: number,
 *   lastSpawnTime: number,
 * }
 */

const DEFAULT_FALL_DURATION_MS = 2500; // Default; overridable per level via fall_duration_ms
export const TOTAL_HEALTH = 28; // Mega Man life meter notch count

// ─── State Factory ──────────────────────────────────────────────

export function createInitialState() {
  return {
    phase: 'IDLE',
    levelIndex: 0,
    fallingNotes: [],
    score: { points: 0, combo: 0, maxCombo: 0, perfects: 0, goods: 0, misses: 0 },
    health: TOTAL_HEALTH,
    wrongStreak: 0,
    countdown: null,
    nextNoteId: 1,
    lastSpawnTime: 0,
  };
}

export function resetForLevel(state, levelIndex) {
  return {
    ...state,
    phase: 'PLAYING',
    levelIndex,
    fallingNotes: [],
    score: { points: 0, combo: 0, maxCombo: 0, perfects: 0, goods: 0, misses: 0 },
    health: TOTAL_HEALTH,
    wrongStreak: 0,
    countdown: null,
    nextNoteId: 1,
    lastSpawnTime: Date.now(),
  };
}

// ─── Activation Detection ───────────────────────────────────────

/**
 * Check if the activation combo is currently held.
 * @param {Map} activeNotes - Current active notes map
 * @param {number[]} comboNotes - MIDI notes that form the activation combo
 * @param {number} windowMs - Max time between first and last note press
 * @returns {boolean}
 */
export function isActivationComboHeld(activeNotes, comboNotes, windowMs) {
  if (!comboNotes || comboNotes.length === 0) return false;

  const timestamps = [];
  for (const note of comboNotes) {
    const active = activeNotes.get(note);
    if (!active) return false;
    timestamps.push(active.timestamp);
  }

  const span = Math.max(...timestamps) - Math.min(...timestamps);
  return span <= windowMs;
}

// ─── Note Generation ────────────────────────────────────────────

/**
 * Generate a chord (set of simultaneous pitches) for the current level.
 * Avoids repeating the same root as the previous spawn when possible.
 */
export function generatePitches(level, lastPitches) {
  const { notes: pool, simultaneous = 1, chord_mode = false, sequential = false } = level;

  if (simultaneous <= 1) {
    // Sequential mode — next note must be adjacent in the pool
    if (sequential && lastPitches?.length === 1) {
      const lastPitch = lastPitches[0];
      const lastIndex = pool.indexOf(lastPitch);
      if (lastIndex !== -1) {
        const candidates = [];
        if (lastIndex > 0) candidates.push(pool[lastIndex - 1]);
        if (lastIndex < pool.length - 1) candidates.push(pool[lastIndex + 1]);
        if (candidates.length > 0) {
          return [candidates[Math.floor(Math.random() * candidates.length)]];
        }
      }
    }

    // Single note — avoid immediate repeat
    let pick;
    let attempts = 0;
    do {
      pick = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    } while (
      lastPitches &&
      lastPitches.length === 1 &&
      lastPitches[0] === pick &&
      pool.length > 1 &&
      attempts < 10
    );
    return [pick];
  }

  if (chord_mode && simultaneous >= 3) {
    return generateChord(pool);
  }

  // Random distinct notes
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(simultaneous, shuffled.length));
}

/**
 * Build a musically valid triad from the note pool.
 * Root + major/minor 3rd (3-4 semitones) + perfect 5th (7 semitones).
 * Falls back to random distinct notes if no valid triad exists.
 */
function generateChord(pool) {
  const shuffledRoots = [...pool].sort(() => Math.random() - 0.5);

  for (const root of shuffledRoots) {
    const third = pool.find(
      n => n !== root && (n - root === 3 || n - root === 4)
    );
    const fifth = pool.find(
      n => n !== root && n !== third && (n - root === 7)
    );

    if (third !== undefined && fifth !== undefined) {
      return [root, third, fifth];
    }
  }

  // Fallback: random 3 distinct notes
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(3, shuffled.length));
}

/**
 * Get the fall duration for a level (ms).
 */
export function getFallDuration(level) {
  return level?.fall_duration_ms ?? DEFAULT_FALL_DURATION_MS;
}

/**
 * Possibly spawn a new falling note group based on timing config.
 * Respects spawn_delay_ms (or BPM fallback) and max_visible.
 * Returns updated state (with new note added) or same state if not time yet.
 */
export function maybeSpawnNote(state, level, now) {
  const spawnInterval = level.spawn_delay_ms
    ?? (60000 / level.bpm) / (level.notes_per_beat || 1);

  if (now - state.lastSpawnTime < spawnInterval) {
    return state;
  }

  // Respect max_visible — don't spawn if too many notes are still falling
  if (level.max_visible != null) {
    const activeFalling = state.fallingNotes.filter(n => n.state === 'falling').length;
    if (activeFalling >= level.max_visible) return state;
  }

  const lastPitches = state.fallingNotes.length > 0
    ? state.fallingNotes[state.fallingNotes.length - 1].pitches
    : null;

  const pitches = generatePitches(level, lastPitches);
  const fallDuration = getFallDuration(level);
  const targetTime = now + fallDuration;

  const newNote = {
    id: state.nextNoteId,
    pitches,
    targetTime,
    state: 'falling',
    hitResult: null,
    hitPitches: new Set(),
  };

  return {
    ...state,
    fallingNotes: [...state.fallingNotes, newNote],
    nextNoteId: state.nextNoteId + 1,
    lastSpawnTime: now,
  };
}

// ─── Hit Detection ──────────────────────────────────────────────

/**
 * Process a note_on event. Find the best matching falling note group
 * and evaluate timing.
 *
 * In "invaders" mode, any falling note matching the pitch is blasted
 * instantly — timing doesn't matter, just hit the right key while
 * the note is on screen. Every hit counts as "perfect".
 *
 * In "hero" mode (default), timing windows apply.
 *
 * @param {string} mode - 'invaders' | 'hero' (default 'hero')
 * @returns {{ state, result }} where result is 'perfect'|'good'|null
 */
export function processHit(state, pitch, now, timingConfig, mode = 'hero') {
  const { perfect_ms, good_ms } = timingConfig;

  let bestIdx = -1;
  let bestDelta = Infinity;

  for (let i = 0; i < state.fallingNotes.length; i++) {
    const fg = state.fallingNotes[i];
    if (fg.state !== 'falling') continue;
    if (!fg.pitches.includes(pitch)) continue;
    if (fg.hitPitches.has(pitch)) continue;

    if (mode === 'invaders') {
      // Invaders mode: any visible falling note is hittable — pick the closest to bottom
      const delta = Math.abs(now - fg.targetTime);
      if (delta < bestDelta) {
        bestIdx = i;
        bestDelta = delta;
      }
    } else {
      // Hero mode: must be within timing window
      const delta = Math.abs(now - fg.targetTime);
      if (delta <= good_ms && delta < bestDelta) {
        bestIdx = i;
        bestDelta = delta;
      }
    }
  }

  if (bestIdx === -1) {
    return { state, result: null };
  }

  const fg = state.fallingNotes[bestIdx];
  const delta = Math.abs(now - fg.targetTime);

  // Invaders: always perfect. Hero: timing-based quality.
  const hitQuality = mode === 'invaders'
    ? 'perfect'
    : delta <= perfect_ms ? 'perfect' : 'good';

  const updatedHitPitches = new Set(fg.hitPitches);
  updatedHitPitches.add(pitch);

  const allHit = fg.pitches.every(p => updatedHitPitches.has(p));

  const updatedNote = {
    ...fg,
    hitPitches: updatedHitPitches,
    state: allHit ? 'hit' : 'falling',
    hitResult: allHit ? hitQuality : fg.hitResult,
    resolvedTime: allHit ? now : fg.resolvedTime,
  };

  const updatedNotes = [...state.fallingNotes];
  updatedNotes[bestIdx] = updatedNote;

  if (!allHit) {
    return {
      state: { ...state, fallingNotes: updatedNotes },
      result: null,
    };
  }

  return {
    state: { ...state, fallingNotes: updatedNotes },
    result: hitQuality,
  };
}

/**
 * Apply scoring for a completed hit.
 * Separated from processHit so the hook can inject config values.
 */
export function applyScore(score, hitQuality, scoringConfig) {
  const { perfect_points, good_points, combo_multiplier } = scoringConfig;
  const basePoints = hitQuality === 'perfect' ? perfect_points : good_points;
  const newCombo = score.combo + 1;
  const multiplier = 1 + newCombo * combo_multiplier;
  const earnedPoints = Math.round(basePoints * multiplier);

  return {
    points: score.points + earnedPoints,
    combo: newCombo,
    maxCombo: Math.max(score.maxCombo, newCombo),
    perfects: score.perfects + (hitQuality === 'perfect' ? 1 : 0),
    goods: score.goods + (hitQuality === 'good' ? 1 : 0),
    misses: score.misses,
  };
}

// ─── Miss Detection (called on every tick) ──────────────────────

/**
 * Check for missed notes (past the miss threshold).
 * Returns updated state with missed notes tagged and combo reset if needed.
 */
export function processMisses(state, now, missThresholdMs) {
  let missOccurred = false;
  let missCount = 0;

  const updatedNotes = state.fallingNotes.map(fg => {
    if (fg.state !== 'falling') return fg;
    if (now > fg.targetTime + missThresholdMs) {
      missOccurred = true;
      missCount++;
      return { ...fg, state: 'missed', hitResult: null, resolvedTime: now };
    }
    return fg;
  });

  if (!missOccurred) return state;

  return {
    ...state,
    fallingNotes: updatedNotes,
    score: {
      ...state.score,
      combo: 0,
      misses: state.score.misses + missCount,
    },
  };
}

// ─── Cleanup (remove old resolved notes) ────────────────────────

const RESOLVED_DISPLAY_MS = 1200;

/**
 * Remove hit/missed notes that have been displayed long enough.
 */
export function cleanupResolvedNotes(state, now) {
  const filtered = state.fallingNotes.filter(fg => {
    if (fg.state === 'falling') return true;
    const resolvedAt = fg.resolvedTime ?? fg.targetTime;
    return now - resolvedAt < RESOLVED_DISPLAY_MS;
  });

  if (filtered.length === state.fallingNotes.length) return state;
  return { ...state, fallingNotes: filtered };
}

// ─── Level Evaluation ───────────────────────────────────────────

/**
 * Check if level is complete or failed.
 * @param {Object} score - Current score state
 * @param {Object} levelConfig - Level configuration
 * @param {number} health - Current health (0 = dead)
 * @returns 'advance' | 'fail' | null
 */
export function evaluateLevel(score, levelConfig, health) {
  if (health <= 0) return 'fail';
  if (score.misses >= levelConfig.max_misses) return 'fail';
  if (score.points >= levelConfig.points_to_advance) return 'advance';
  return null;
}

// ─── Constants ──────────────────────────────────────────────────

export { DEFAULT_FALL_DURATION_MS };
