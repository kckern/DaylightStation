# Piano Game Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Guitar Hero-style game mode to the existing Piano Visualizer where notes fall toward the keyboard and the player scores points by hitting them within timing windows.

**Architecture:** Game engine is pure functions in `gameEngine.js` (testable, no React). A `useGameMode` hook wraps the engine and integrates with React state/effects. `PianoVisualizer` loads game config via existing admin API and conditionally renders game UI. Falling game notes render in `NoteWaterfall` (downward, opposite of free-play). A new `GameOverlay` component handles score HUD, countdown, banners, and victory screen.

**Tech Stack:** React hooks, CSS custom properties (same pattern as existing waterfall), Web Animations API (for combo badge, per TVApp compatibility), structured logging framework, YAML config via `DaylightAPI`.

---

## Existing Code Reference

These files already exist and will be referenced throughout:

| File | Role |
|------|------|
| `frontend/src/modules/Piano/PianoVisualizer.jsx` | Main orchestrator — mounts hook, renders header/waterfall/keyboard |
| `frontend/src/modules/Piano/PianoVisualizer.scss` | Layout: 35% header, flex waterfall, 25% keyboard |
| `frontend/src/modules/Piano/useMidiSubscription.js` | Returns `{ activeNotes, sustainPedal, sessionInfo, noteHistory }` |
| `frontend/src/modules/Piano/components/NoteWaterfall.jsx` | DOM-based rising notes with 3D perspective, 16ms tick |
| `frontend/src/modules/Piano/components/NoteWaterfall.scss` | Perspective transform, glow effects, TRON grid |
| `frontend/src/modules/Piano/components/PianoKeyboard.jsx` | 88-key visual keyboard with velocity glow |
| `frontend/src/modules/Piano/components/CurrentChordStaff.jsx` | Music notation display (hidden during game mode) |
| `frontend/src/lib/logging/singleton.js` | `getChildLogger({ app })` for structured logging |
| `frontend/src/lib/api.mjs` | `DaylightAPI(path, data, method)` for config fetching |
| `backend/src/4_api/v1/routers/admin/apps.mjs` | `piano` already registered → `household/config/piano.yml` |

### Key Patterns You Must Follow

1. **Logging:** Never use raw `console.log`. Use `getChildLogger({ component: 'piano-game' })`. See `useMidiSubscription.js:3,35` for import pattern.
2. **Animation:** No CSS transitions in TV app context. Use `element.animate()` (Web Animations API) for any animated game elements. Existing waterfall uses `setInterval` ticks — that's fine.
3. **Note positioning:** Reuse `getNotePosition()`, `getNoteWidth()`, `getNoteHue()` from `NoteWaterfall.jsx:9-46`. Do NOT duplicate these functions — export them.
4. **Config loading:** Use `DaylightAPI('api/v1/admin/apps/piano/config')` which returns `{ parsed, raw }`. The `parsed.game` object is the game config.

---

## Task 1: Add Game Config to piano.yml

**Files:**
- Create: `data/household/config/piano.yml`

**Step 1: Create the config file**

```yaml
# Piano app configuration
game:
  activation:
    notes: [22, 108]       # A#0 + C8 — first and last black keys
    window_ms: 300          # Max time between the two presses

  timing:
    perfect_ms: 80          # +/-80ms from target = Perfect
    good_ms: 200            # +/-200ms from target = Good
    miss_threshold_ms: 400  # Beyond this = Miss

  scoring:
    perfect_points: 100
    good_points: 50
    miss_penalty: 0
    combo_multiplier: 0.1   # Each consecutive hit adds 10% bonus

  levels:
    - name: "White Keys"
      notes: [60, 62, 64, 65, 67]
      bpm: 60
      notes_per_beat: 1
      simultaneous: 1
      points_to_advance: 500
      max_misses: 10

    - name: "Full Octave"
      notes: [60, 62, 64, 65, 67, 69, 71]
      bpm: 80
      notes_per_beat: 1
      simultaneous: 1
      points_to_advance: 1000
      max_misses: 8

    - name: "Two Hands"
      notes: [48, 50, 52, 53, 55, 60, 62, 64, 65, 67]
      bpm: 70
      notes_per_beat: 1
      simultaneous: 2
      points_to_advance: 1500
      max_misses: 8

    - name: "Black Keys"
      notes: [61, 63, 66, 68, 70]
      bpm: 60
      notes_per_beat: 1
      simultaneous: 1
      points_to_advance: 800
      max_misses: 10

    - name: "Chords"
      notes: [60, 62, 64, 65, 67, 69, 71]
      bpm: 50
      notes_per_beat: 0.5
      simultaneous: 3
      chord_mode: true
      points_to_advance: 2000
      max_misses: 6
```

**Step 2: Verify the config loads via API**

Make sure the dev server is running, then:

```bash
curl -s http://localhost:3111/api/v1/admin/apps/piano/config | jq '.parsed.game.levels[0].name'
```

Expected: `"White Keys"`

**Step 3: Commit**

```bash
git add data/household/config/piano.yml
git commit -m "feat(piano): add game mode YAML config with levels and scoring"
```

---

## Task 2: Extract Note Positioning Utils from NoteWaterfall

The game needs the same note positioning functions that NoteWaterfall uses. Extract them so both can share.

**Files:**
- Create: `frontend/src/modules/Piano/noteUtils.js`
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.jsx`

**Step 1: Create shared utils module**

Create `frontend/src/modules/Piano/noteUtils.js`:

```js
// Shared note positioning utilities for waterfall and game mode
// Extracted from NoteWaterfall.jsx to avoid duplication

// White keys in an octave (C, D, E, F, G, A, B)
export const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

/**
 * Calculate horizontal position (%) for a MIDI note on the keyboard
 * White keys are centered on their key; black keys align with the left edge of the next white key
 */
export const getNotePosition = (note, startNote = 21, endNote = 108) => {
  let whiteKeysBefore = 0;
  let totalWhiteKeys = 0;

  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) {
      totalWhiteKeys++;
      if (n < note) whiteKeysBefore++;
    }
  }

  const keyWidth = 100 / totalWhiteKeys;

  if (isWhiteKey(note)) {
    return whiteKeysBefore * keyWidth + keyWidth / 2;
  } else {
    return whiteKeysBefore * keyWidth;
  }
};

/**
 * Calculate width (%) for a note bar
 * White keys: 90% of key width, black keys: 50%
 */
export const getNoteWidth = (note, startNote = 21, endNote = 108) => {
  let totalWhiteKeys = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) totalWhiteKeys++;
  }
  const keyWidth = 100 / totalWhiteKeys;
  return isWhiteKey(note) ? keyWidth * 0.9 : keyWidth * 0.5;
};

/**
 * Color hue (0-280) based on pitch. Low=red, mid=cyan, high=purple
 */
export const getNoteHue = (note, startNote = 21, endNote = 108) => {
  const range = endNote - startNote;
  const position = (note - startNote) / range;
  return Math.round(position * 280);
};
```

**Step 2: Update NoteWaterfall to import from shared utils**

In `frontend/src/modules/Piano/components/NoteWaterfall.jsx`, replace lines 1-46 (the local function definitions) with imports:

```js
import { useMemo, useState, useEffect } from 'react';
import { getNotePosition, getNoteWidth, getNoteHue } from '../noteUtils.js';
import './NoteWaterfall.scss';
```

Remove these local declarations from NoteWaterfall.jsx (they're now in noteUtils.js):
- `WHITE_KEY_NOTES` (line 4)
- `isWhiteKey` (line 5)
- `getNotePosition` (lines 8-28)
- `getNoteWidth` (lines 30-37)
- `getNoteHue` (lines 41-46)

Keep `DISPLAY_DURATION` and `TICK_INTERVAL` in NoteWaterfall.jsx — they're waterfall-specific.

**Step 3: Verify nothing broke**

Open the piano visualizer in the browser. Play some notes (dev keyboard: keys `1` through `=`). Notes should still rise with correct positioning and colors.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/noteUtils.js frontend/src/modules/Piano/components/NoteWaterfall.jsx
git commit -m "refactor(piano): extract note positioning utils to shared module"
```

---

## Task 3: Game Engine — Pure Functions

This is the core game logic with zero React dependencies. All functions are pure and take state in, return state out.

**Files:**
- Create: `frontend/src/modules/Piano/gameEngine.js`

**Step 1: Create the game engine module**

Create `frontend/src/modules/Piano/gameEngine.js`:

```js
/**
 * Piano Game Engine — Pure functions, no React
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

const FALL_DURATION_MS = 2500; // Notes visible for 2.5s before reaching hit line

// ─── State Factory ──────────────────────────────────────────────

export function createInitialState() {
  return {
    phase: 'IDLE',
    levelIndex: 0,
    fallingNotes: [],
    score: { points: 0, combo: 0, maxCombo: 0, perfects: 0, goods: 0, misses: 0 },
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
    countdown: null,
    nextNoteId: 1,
    lastSpawnTime: 0,
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
  const { notes: pool, simultaneous = 1, chord_mode = false } = level;

  if (simultaneous <= 1) {
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
  // Try each note in pool as root
  const shuffledRoots = [...pool].sort(() => Math.random() - 0.5);

  for (const root of shuffledRoots) {
    // Look for a 3rd (3 or 4 semitones above root, constrained to pool)
    const third = pool.find(
      n => n !== root && (n - root === 3 || n - root === 4)
    );
    // Look for a 5th (7 semitones above root, constrained to pool)
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
 * Possibly spawn a new falling note group based on BPM timing.
 * Returns updated state (with new note added) or same state if not time yet.
 */
export function maybeSpawnNote(state, level, now) {
  const spawnInterval = (60000 / level.bpm) / (level.notes_per_beat || 1);

  if (now - state.lastSpawnTime < spawnInterval) {
    return state;
  }

  const lastPitches = state.fallingNotes.length > 0
    ? state.fallingNotes[state.fallingNotes.length - 1].pitches
    : null;

  const pitches = generatePitches(level, lastPitches);
  const targetTime = now + FALL_DURATION_MS;

  const newNote = {
    id: state.nextNoteId,
    pitches,
    targetTime,
    state: 'falling',   // 'falling' | 'hit' | 'missed'
    hitResult: null,     // 'perfect' | 'good' | null
    hitPitches: new Set(), // Track which pitches in the group have been hit
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
 * @returns {{ state, result }} where result is 'perfect'|'good'|null
 */
export function processHit(state, pitch, now, timingConfig) {
  const { perfect_ms, good_ms } = timingConfig;

  // Find the oldest falling note group that contains this pitch and is still 'falling'
  let bestIdx = -1;
  let bestDelta = Infinity;

  for (let i = 0; i < state.fallingNotes.length; i++) {
    const fg = state.fallingNotes[i];
    if (fg.state !== 'falling') continue;
    if (!fg.pitches.includes(pitch)) continue;
    if (fg.hitPitches.has(pitch)) continue; // Already hit this pitch in the group

    const delta = Math.abs(now - fg.targetTime);
    if (delta <= good_ms && delta < bestDelta) {
      bestIdx = i;
      bestDelta = delta;
    }
  }

  if (bestIdx === -1) {
    // No matching falling note — ignore (noodling is OK)
    return { state, result: null };
  }

  const fg = state.fallingNotes[bestIdx];
  const delta = Math.abs(now - fg.targetTime);
  const hitQuality = delta <= perfect_ms ? 'perfect' : 'good';

  // Clone the note group with updated hitPitches
  const updatedHitPitches = new Set(fg.hitPitches);
  updatedHitPitches.add(pitch);

  // Check if all pitches in the group are now hit
  const allHit = fg.pitches.every(p => updatedHitPitches.has(p));

  const updatedNote = {
    ...fg,
    hitPitches: updatedHitPitches,
    // Only finalize when all pitches hit (for chords) or single notes
    state: allHit ? 'hit' : 'falling',
    hitResult: allHit ? hitQuality : fg.hitResult,
  };

  const updatedNotes = [...state.fallingNotes];
  updatedNotes[bestIdx] = updatedNote;

  if (!allHit) {
    // Partial chord hit — don't score yet
    return {
      state: { ...state, fallingNotes: updatedNotes },
      result: null,
    };
  }

  // Full hit — update score
  const newCombo = state.score.combo + 1;
  const multiplier = 1 + newCombo * (0.1); // combo_multiplier applied in hook with config
  // Note: actual multiplier comes from config; 0.1 is placeholder. The hook will use config value.

  return {
    state: {
      ...state,
      fallingNotes: updatedNotes,
    },
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
      return { ...fg, state: 'missed', hitResult: null };
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

const RESOLVED_DISPLAY_MS = 800; // Show hit/miss feedback for 800ms then remove

/**
 * Remove hit/missed notes that have been displayed long enough.
 */
export function cleanupResolvedNotes(state, now) {
  const filtered = state.fallingNotes.filter(fg => {
    if (fg.state === 'falling') return true;
    // Keep resolved notes for visual feedback
    const resolvedAt = fg.targetTime + (fg.state === 'missed' ? 400 : 0); // miss_threshold offset
    return now - resolvedAt < RESOLVED_DISPLAY_MS;
  });

  if (filtered.length === state.fallingNotes.length) return state;
  return { ...state, fallingNotes: filtered };
}

// ─── Level Evaluation ───────────────────────────────────────────

/**
 * Check if level is complete or failed.
 * @returns 'advance' | 'fail' | null
 */
export function evaluateLevel(score, levelConfig) {
  if (score.misses >= levelConfig.max_misses) return 'fail';
  if (score.points >= levelConfig.points_to_advance) return 'advance';
  return null;
}

// ─── Constants ──────────────────────────────────────────────────

export { FALL_DURATION_MS };
```

**Step 2: Verify file is syntactically valid**

```bash
node -e "import('./frontend/src/modules/Piano/gameEngine.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Note: This may fail due to ES module context, but the import parse will validate syntax. Alternatively, just run the dev server and check for build errors.

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/gameEngine.js
git commit -m "feat(piano): add game engine pure functions for state, spawning, hits, scoring"
```

---

## Task 4: useGameMode Hook

The React hook that wires the game engine to `activeNotes`/`noteHistory` and manages timers.

**Files:**
- Create: `frontend/src/modules/Piano/useGameMode.js`

**Step 1: Create the hook**

Create `frontend/src/modules/Piano/useGameMode.js`:

```js
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import {
  createInitialState,
  resetForLevel,
  isActivationComboHeld,
  maybeSpawnNote,
  processHit,
  applyScore,
  processMisses,
  cleanupResolvedNotes,
  evaluateLevel,
  FALL_DURATION_MS,
} from './gameEngine.js';

const TICK_INTERVAL = 16; // ~60fps
const COUNTDOWN_STEPS = [3, 2, 1, 0]; // 0 = "GO"
const COUNTDOWN_STEP_MS = 800;
const BANNER_DISPLAY_MS = 3000;

/**
 * Game mode hook — manages state machine, note spawning, hit detection, scoring.
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Array} noteHistory - From useMidiSubscription
 * @param {Object|null} gameConfig - Parsed game config from piano.yml, or null to disable
 * @returns {Object} Game mode state for rendering
 */
export function useGameMode(activeNotes, noteHistory, gameConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-game' }), []);
  const [gameState, setGameState] = useState(createInitialState);
  const gameStateRef = useRef(gameState);
  const lastNoteHistoryLen = useRef(0);
  const tickRef = useRef(null);
  const countdownRef = useRef(null);
  const bannerTimeoutRef = useRef(null);
  const activationCooldownRef = useRef(0);

  // Keep ref in sync with state (for use in intervals/callbacks)
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const levels = gameConfig?.levels ?? [];
  const activation = gameConfig?.activation ?? {};
  const timing = gameConfig?.timing ?? {};
  const scoring = gameConfig?.scoring ?? {};

  // ─── Activation Detection ───────────────────────────────────

  useEffect(() => {
    if (!gameConfig) return;
    if (Date.now() < activationCooldownRef.current) return;

    const comboHeld = isActivationComboHeld(
      activeNotes,
      activation.notes,
      activation.window_ms ?? 300
    );

    if (!comboHeld) return;

    // Cooldown to prevent rapid toggling
    activationCooldownRef.current = Date.now() + 2000;

    const current = gameStateRef.current;

    if (current.phase === 'IDLE') {
      logger.info('piano.game.activated', {});
      startCountdown();
    } else {
      // Exit game mode
      logger.info('piano.game.deactivated', { phase: current.phase });
      cleanup();
      setGameState(createInitialState());
    }
  }, [activeNotes, gameConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Dev shortcut: backtick toggles game mode (localhost only) ─

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    if (!gameConfig) return;

    const handleKey = (e) => {
      if (e.key !== '`') return;
      e.preventDefault();
      e.stopPropagation();

      if (Date.now() < activationCooldownRef.current) return;
      activationCooldownRef.current = Date.now() + 2000;

      const current = gameStateRef.current;
      if (current.phase === 'IDLE') {
        logger.info('piano.game.dev-activated', {});
        startCountdown();
      } else {
        logger.info('piano.game.dev-deactivated', {});
        cleanup();
        setGameState(createInitialState());
      }
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [gameConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Countdown ──────────────────────────────────────────────

  function startCountdown() {
    setGameState(prev => ({ ...prev, phase: 'STARTING', countdown: 3 }));

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setGameState(prev => ({ ...prev, countdown: COUNTDOWN_STEPS[step] }));
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        // Transition to PLAYING
        setGameState(prev => resetForLevel(prev, prev.levelIndex));
        logger.info('piano.game.started', { level: 0 });
      }
    }, COUNTDOWN_STEP_MS);
  }

  // ─── Game Tick (spawning + miss detection + cleanup) ────────

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') return;

    const level = levels[gameState.levelIndex];
    if (!level) return;

    tickRef.current = setInterval(() => {
      const now = Date.now();

      setGameState(prev => {
        if (prev.phase !== 'PLAYING') return prev;

        let next = prev;

        // 1. Spawn notes
        next = maybeSpawnNote(next, level, now);

        // 2. Detect misses
        next = processMisses(next, now, timing.miss_threshold_ms ?? 400);

        // 3. Cleanup old resolved notes
        next = cleanupResolvedNotes(next, now);

        // 4. Check level outcome
        const outcome = evaluateLevel(next.score, level);
        if (outcome === 'fail') {
          logger.info('piano.game.level-failed', {
            level: next.levelIndex,
            score: next.score.points,
            misses: next.score.misses,
          });
          return { ...next, phase: 'LEVEL_FAILED' };
        }
        if (outcome === 'advance') {
          logger.info('piano.game.level-complete', {
            level: next.levelIndex,
            score: next.score.points,
          });
          if (next.levelIndex + 1 >= levels.length) {
            return { ...next, phase: 'VICTORY' };
          }
          return { ...next, phase: 'LEVEL_COMPLETE' };
        }

        return next;
      });
    }, TICK_INTERVAL);

    return () => {
      clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [gameState.phase, gameState.levelIndex, levels, timing, logger]);

  // ─── Hit Detection (watch noteHistory for new note_on events) ─

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') {
      lastNoteHistoryLen.current = noteHistory.length;
      return;
    }

    // Process any new notes since last check
    for (let i = lastNoteHistoryLen.current; i < noteHistory.length; i++) {
      const entry = noteHistory[i];
      if (!entry || entry.endTime !== null) continue; // Only process note_on (endTime is null)

      const pitch = entry.note;
      const now = entry.startTime; // Use the note's actual timestamp

      setGameState(prev => {
        if (prev.phase !== 'PLAYING') return prev;

        const { state: newState, result } = processHit(prev, pitch, now, timing);

        if (result) {
          const newScore = applyScore(newState.score, result, scoring);
          logger.debug('piano.game.hit', { pitch, result, combo: newScore.combo, points: newScore.points });
          return { ...newState, score: newScore };
        }

        return newState;
      });
    }

    lastNoteHistoryLen.current = noteHistory.length;
  }, [noteHistory.length, gameState.phase, timing, scoring, logger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Banner Auto-Advance (LEVEL_COMPLETE / LEVEL_FAILED / VICTORY) ─

  useEffect(() => {
    if (gameState.phase === 'LEVEL_COMPLETE') {
      bannerTimeoutRef.current = setTimeout(() => {
        // Advance to next level
        const nextLevel = gameState.levelIndex + 1;
        logger.info('piano.game.next-level', { level: nextLevel });
        startCountdown();
        setGameState(prev => ({ ...prev, levelIndex: nextLevel }));
      }, BANNER_DISPLAY_MS);
      return () => clearTimeout(bannerTimeoutRef.current);
    }

    if (gameState.phase === 'LEVEL_FAILED') {
      bannerTimeoutRef.current = setTimeout(() => {
        // Retry same level
        logger.info('piano.game.retry-level', { level: gameState.levelIndex });
        startCountdown();
      }, BANNER_DISPLAY_MS);
      return () => clearTimeout(bannerTimeoutRef.current);
    }

    if (gameState.phase === 'VICTORY') {
      bannerTimeoutRef.current = setTimeout(() => {
        logger.info('piano.game.victory-dismiss', { finalScore: gameState.score.points });
        cleanup();
        setGameState(createInitialState());
      }, 8000); // Victory screen stays longer
      return () => clearTimeout(bannerTimeoutRef.current);
    }
  }, [gameState.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cleanup ────────────────────────────────────────────────

  function cleanup() {
    if (tickRef.current) clearInterval(tickRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    tickRef.current = null;
    countdownRef.current = null;
    bannerTimeoutRef.current = null;
  }

  // Cleanup on unmount
  useEffect(() => cleanup, []);

  // ─── Derived state for rendering ────────────────────────────

  const currentLevel = levels[gameState.levelIndex] ?? null;
  const levelProgress = currentLevel
    ? {
        pointsEarned: gameState.score.points,
        pointsNeeded: currentLevel.points_to_advance,
        missesUsed: gameState.score.misses,
        missesAllowed: currentLevel.max_misses,
      }
    : null;

  return {
    isGameMode: gameState.phase !== 'IDLE',
    gameState: gameState.phase,
    currentLevel,
    fallingNotes: gameState.fallingNotes,
    score: gameState.score,
    countdown: gameState.countdown,
    levelProgress,
    fallDuration: FALL_DURATION_MS,
  };
}

export default useGameMode;
```

**Step 2: Verify no syntax errors**

Start or check the dev server. The hook isn't wired yet, so just verify the module parses:

```bash
# Check for build errors in the Vite console
# If dev server is running, check dev.log for module parse errors
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/useGameMode.js
git commit -m "feat(piano): add useGameMode hook with state machine, spawning, hit detection"
```

---

## Task 5: PianoVisualizer Integration

Wire game mode into the main orchestrator component.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Step 1: Add game config loading and hook integration**

Make these changes to `PianoVisualizer.jsx`:

**Add import** (after line 5):
```js
import { useGameMode } from './useGameMode.js';
```

**Add game config state** (inside the component, after line 37 `const [showPlaceholder, setShowPlaceholder] = useState(false);`):
```js
const [gameConfig, setGameConfig] = useState(null);
```

**Load game config in the existing initPiano effect** (modify the `useEffect` starting at line 40). After the `pianoConfigRef.current = pianoConfig;` line (line 46), add:

```js
        // Load game config from piano app config
        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gc = pianoAppConfig?.parsed?.game ?? null;
          setGameConfig(gc);
        } catch (err) {
          // Game mode unavailable — that's fine
        }
```

**Add the hook call** (after the `useMidiSubscription` line, around line 29):
```js
  const game = useGameMode(activeNotes, noteHistory, gameConfig);
```

**Step 2: Add `game-mode` class to the root element**

Change the root div (line 149):
```jsx
    <div className={`piano-visualizer${game.isGameMode ? ' game-mode' : ''}`}>
```

**Step 3: Conditional header rendering**

Replace the `piano-header` div (lines 150-170) with:

```jsx
      <div className="piano-header">
        {game.isGameMode ? (
          <>
            <div className="header-left">
              <div className="game-score">
                <span className="score-value">{game.score.points}</span>
                {game.score.combo > 1 && (
                  <span className="combo-badge">x{game.score.combo}</span>
                )}
              </div>
            </div>
            <div className="header-center">
              {game.currentLevel && (
                <div className="level-info">
                  <span className="level-name">{game.currentLevel.name}</span>
                  {game.levelProgress && (
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(100, (game.levelProgress.pointsEarned / game.levelProgress.pointsNeeded) * 100)}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="header-right">
              {game.levelProgress && (
                <div className="miss-counter">
                  <span className="miss-count">{game.levelProgress.missesUsed}</span>
                  <span className="miss-separator">/</span>
                  <span className="miss-max">{game.levelProgress.missesAllowed}</span>
                  <span className="miss-label">misses</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="header-left">
              <div className="session-timer">
                <span className="timer-value">{formatDuration(sessionDuration)}</span>
                <span className="note-count">{noteHistory.length} notes</span>
              </div>
              {sustainPedal && <span className="pedal-indicator">Sustain</span>}
              {inactivityState === 'countdown' && (
                <div className="inactivity-timer">
                  <div
                    className="timer-bar"
                    style={{ width: `${countdownProgress}%` }}
                  />
                </div>
              )}
            </div>
            <div className="header-center">
              <CurrentChordStaff activeNotes={activeNotes} />
            </div>
          </>
        )}
      </div>
```

**Step 4: Pass game props to NoteWaterfall**

Change the NoteWaterfall usage (line 173):
```jsx
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          gameMode={game.isGameMode ? game : null}
        />
```

**Step 5: Add GameOverlay** (we'll create this component in Task 7, but add the import and usage now)

Add import at the top:
```js
import { GameOverlay } from './components/GameOverlay';
```

Add right before the closing `</div>` of piano-visualizer (before the session-summary block):
```jsx
      {game.isGameMode && (
        <GameOverlay
          gameState={game.gameState}
          countdown={game.countdown}
          score={game.score}
          currentLevel={game.currentLevel}
          levelProgress={game.levelProgress}
        />
      )}
```

**Step 6: Disable inactivity timer during game mode**

In the inactivity detection `useEffect` (around line 101), add at the top of `checkInactivity`:
```js
      // Don't auto-close during game mode
      if (gameStateRef?.current?.phase && gameStateRef.current.phase !== 'IDLE') {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
```

Wait — we don't have `gameStateRef` in PianoVisualizer. Simpler approach: check `game.isGameMode`:

Actually, add this to the beginning of the `checkInactivity` function body:
```js
      if (game.isGameMode) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
```

And add `game.isGameMode` to the effect's dependency array.

**Step 7: Verify the build compiles**

The GameOverlay component doesn't exist yet, so the build will fail. Create a placeholder:

```bash
# Create placeholder so the build works
```

Create `frontend/src/modules/Piano/components/GameOverlay.jsx`:
```jsx
export function GameOverlay() {
  return null; // Placeholder — implemented in Task 7
}
export default GameOverlay;
```

Now verify the dev server shows no errors.

**Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx frontend/src/modules/Piano/components/GameOverlay.jsx
git commit -m "feat(piano): integrate useGameMode into PianoVisualizer with conditional header"
```

---

## Task 6: NoteWaterfall — Falling Game Notes

Add falling game note rendering alongside the existing rising free-play notes.

**Files:**
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.jsx`
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.scss`

**Step 1: Update NoteWaterfall to accept and render game notes**

In `NoteWaterfall.jsx`, update the component signature to accept `gameMode`:

```jsx
export function NoteWaterfall({ noteHistory = [], activeNotes = new Map(), startNote = 21, endNote = 108, gameMode = null }) {
```

After the existing `visibleNotes` useMemo block (around line 133), add a new memo for game notes:

```js
  const gameNotes = useMemo(() => {
    if (!gameMode) return [];
    const now = Date.now();

    return gameMode.fallingNotes.map(fg => {
      // Calculate fall progress: 1.0 at spawn (top) → 0.0 at target (hit line)
      const elapsed = now - (fg.targetTime - gameMode.fallDuration);
      const progress = Math.min(1, elapsed / gameMode.fallDuration);

      // topPercent: 0% = at hit line (bottom of waterfall), 100% = top
      // Notes fall from top to bottom, so topPercent decreases over time
      const topPercent = Math.max(0, (1 - progress) * 100);

      return {
        ...fg,
        // Use the first pitch for positioning (chords will have multiple bars)
        notePositions: fg.pitches.map(pitch => ({
          pitch,
          x: getNotePosition(pitch, startNote, endNote),
          width: getNoteWidth(pitch, startNote, endNote),
          hue: getNoteHue(pitch, startNote, endNote),
        })),
        topPercent,
        progress,
      };
    });
  }, [gameMode, startNote, endNote, tick]);
```

**Step 2: Add game notes to the render output**

Inside the `.waterfall-perspective` div, after the existing `visibleNotes.map(...)` block, add:

```jsx
        {/* Game mode: falling target notes */}
        {gameNotes.map(gn => (
          gn.notePositions.map(pos => (
            <div
              key={`game-${gn.id}-${pos.pitch}`}
              className={`game-note game-note--${gn.state}${gn.hitResult ? ` game-note--${gn.hitResult}` : ''}`}
              style={{
                '--x': `${pos.x}%`,
                '--width': `${pos.width}%`,
                '--top': `${gn.topPercent}%`,
                '--hue': pos.hue,
                '--progress': gn.progress,
              }}
            />
          ))
        ))}
```

**Step 3: Add hit line element**

Inside the `.note-waterfall` div (but outside `.waterfall-perspective`), add:

```jsx
      {gameMode && <div className="hit-line" />}
```

The full return of the component should now look like:

```jsx
  return (
    <div className={`note-waterfall${gameMode ? ' note-waterfall--game' : ''}`}>
      <div className="waterfall-perspective">
        {/* Free-play rising notes (hidden during game mode via CSS) */}
        {visibleNotes.map((note, idx) => {
          const heldDuration = note.duration;
          const heightPercent = Math.min(95, Math.max(1, (heldDuration / DISPLAY_DURATION) * 100));

          return (
            <div
              key={`${note.note}-${note.startTime}-${idx}`}
              className={`waterfall-note ${note.isActive ? 'active' : ''}`}
              style={{
                '--x': `${note.x}%`,
                '--width': `${note.width}%`,
                '--height': `${heightPercent}%`,
                '--bottom': `${note.bottomPercent}%`,
                '--velocity': note.velocity / 127,
                '--hue': note.hue,
                '--progress': note.progress
              }}
            />
          );
        })}

        {/* Game mode: falling target notes */}
        {gameNotes.map(gn => (
          gn.notePositions.map(pos => (
            <div
              key={`game-${gn.id}-${pos.pitch}`}
              className={`game-note game-note--${gn.state}${gn.hitResult ? ` game-note--${gn.hitResult}` : ''}`}
              style={{
                '--x': `${pos.x}%`,
                '--width': `${pos.width}%`,
                '--top': `${gn.topPercent}%`,
                '--hue': pos.hue,
                '--progress': gn.progress,
              }}
            />
          ))
        ))}
      </div>

      {gameMode && <div className="hit-line" />}
    </div>
  );
```

**Step 4: Add game note styles to NoteWaterfall.scss**

Append to `NoteWaterfall.scss`:

```scss
// ─── Game Mode ──────────────────────────────────────────────────

// When in game mode, hide free-play rising notes
.note-waterfall--game .waterfall-note {
  display: none;
}

// Game notes fall from top to bottom (opposite of free-play)
.game-note {
  position: absolute;
  left: var(--x);
  width: var(--width);
  height: 20px;
  top: var(--top);
  transform: translateX(-50%);
  border-radius: 4px;
  pointer-events: none;
  z-index: 5;

  background: linear-gradient(
    to bottom,
    hsla(var(--hue), 100%, 70%, 1) 0%,
    hsla(var(--hue), 90%, 55%, 0.9) 100%
  );

  box-shadow:
    0 0 12px hsla(var(--hue), 100%, 60%, 0.6),
    0 0 24px hsla(var(--hue), 100%, 50%, 0.3);

  // ── Hit feedback states ──

  &.game-note--hit {
    opacity: 0; // Hide after hit (feedback shown separately)
  }

  &.game-note--hit.game-note--perfect {
    // Green burst
    background: hsl(130, 100%, 60%);
    box-shadow: 0 0 30px hsla(130, 100%, 60%, 0.8);
    opacity: 1;
  }

  &.game-note--hit.game-note--good {
    // Yellow burst
    background: hsl(50, 100%, 60%);
    box-shadow: 0 0 30px hsla(50, 100%, 60%, 0.8);
    opacity: 1;
  }

  &.game-note--missed {
    // Red X fade-out
    background: hsl(0, 80%, 50%);
    box-shadow: 0 0 20px hsla(0, 80%, 50%, 0.6);
    opacity: 0.5;
  }
}

// Hit line — glowing horizontal bar just above keyboard boundary
.hit-line {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 255, 200, 0.8) 10%,
    rgba(0, 255, 200, 1) 50%,
    rgba(0, 255, 200, 0.8) 90%,
    transparent 100%
  );
  box-shadow:
    0 0 10px rgba(0, 255, 200, 0.6),
    0 0 20px rgba(0, 255, 200, 0.3),
    0 0 40px rgba(0, 255, 200, 0.1);
  z-index: 20;
  pointer-events: none;
}
```

**Step 5: Verify in the browser**

1. Open the piano visualizer
2. Press backtick (`` ` ``) to activate game mode (localhost dev shortcut)
3. Confirm: countdown appears (if GameOverlay is wired), then notes start falling downward
4. Play dev keyboard notes and verify they interact with falling notes

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/components/NoteWaterfall.jsx frontend/src/modules/Piano/components/NoteWaterfall.scss
git commit -m "feat(piano): add falling game notes and hit line to NoteWaterfall"
```

---

## Task 7: GameOverlay Component

Full overlay UI for countdown, score HUD, level banners, and victory screen.

**Files:**
- Modify: `frontend/src/modules/Piano/components/GameOverlay.jsx` (replace placeholder)
- Create: `frontend/src/modules/Piano/components/GameOverlay.scss`

**Step 1: Implement GameOverlay component**

Replace the placeholder in `frontend/src/modules/Piano/components/GameOverlay.jsx`:

```jsx
import { useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import './GameOverlay.scss';

/**
 * Game mode overlay — countdown, banners, victory screen.
 * Score HUD is in the PianoVisualizer header, not here.
 */
export function GameOverlay({ gameState, countdown, score, currentLevel, levelProgress }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-game-overlay' }), []);

  // Countdown: 3, 2, 1, GO
  if (gameState === 'STARTING') {
    const label = countdown === 0 ? 'GO!' : countdown;
    return (
      <div className="game-overlay">
        <div className="countdown">
          <span className="countdown-number" key={countdown}>{label}</span>
        </div>
      </div>
    );
  }

  // Level complete banner
  if (gameState === 'LEVEL_COMPLETE') {
    return (
      <div className="game-overlay">
        <div className="banner banner--success">
          <h2>Level Complete!</h2>
          <div className="banner-stats">
            <div className="stat">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Score</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.maxCombo}x</span>
              <span className="stat-label">Max Combo</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.perfects}</span>
              <span className="stat-label">Perfects</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Level failed banner
  if (gameState === 'LEVEL_FAILED') {
    return (
      <div className="game-overlay">
        <div className="banner banner--fail">
          <h2>Try Again!</h2>
          <div className="banner-stats">
            <div className="stat">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Score</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.misses}</span>
              <span className="stat-label">Misses</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Victory screen
  if (gameState === 'VICTORY') {
    const totalHits = score.perfects + score.goods;
    const totalAttempts = totalHits + score.misses;
    const accuracy = totalAttempts > 0
      ? Math.round((totalHits / totalAttempts) * 100)
      : 0;

    return (
      <div className="game-overlay">
        <div className="victory">
          <h1>Victory!</h1>
          <div className="victory-stats">
            <div className="stat stat--large">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Final Score</span>
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-value">{accuracy}%</span>
                <span className="stat-label">Accuracy</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.maxCombo}x</span>
                <span className="stat-label">Max Combo</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.perfects}</span>
                <span className="stat-label">Perfects</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.goods}</span>
                <span className="stat-label">Goods</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PLAYING state — no overlay (HUD is in header)
  return null;
}

export default GameOverlay;
```

**Step 2: Create GameOverlay styles**

Create `frontend/src/modules/Piano/components/GameOverlay.scss`:

```scss
.game-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 50;
  pointer-events: none;
}

// ─── Countdown ──────────────────────────────────────────────────

.countdown {
  display: flex;
  justify-content: center;
  align-items: center;

  .countdown-number {
    font-size: 8rem;
    font-weight: 900;
    color: #fff;
    text-shadow:
      0 0 40px rgba(0, 255, 200, 0.8),
      0 0 80px rgba(0, 255, 200, 0.4);
    font-variant-numeric: tabular-nums;
  }
}

// ─── Banners (Level Complete / Level Failed) ────────────────────

.banner {
  background: rgba(0, 0, 0, 0.85);
  padding: 2rem 4rem;
  border-radius: 12px;
  text-align: center;
  color: #fff;

  h2 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 1.5rem 0;
  }

  &--success h2 {
    color: #00ffc8;
    text-shadow: 0 0 20px rgba(0, 255, 200, 0.5);
  }

  &--fail h2 {
    color: #ff4444;
    text-shadow: 0 0 20px rgba(255, 68, 68, 0.5);
  }

  .banner-stats {
    display: flex;
    gap: 3rem;
    justify-content: center;
  }
}

// ─── Victory Screen ─────────────────────────────────────────────

.victory {
  background: rgba(0, 0, 0, 0.9);
  padding: 3rem 5rem;
  border-radius: 16px;
  text-align: center;
  color: #fff;

  h1 {
    font-size: 4rem;
    font-weight: 900;
    color: #ffd700;
    text-shadow:
      0 0 30px rgba(255, 215, 0, 0.6),
      0 0 60px rgba(255, 215, 0, 0.3);
    margin: 0 0 2rem 0;
  }

  .victory-stats {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .stat-row {
    display: flex;
    gap: 3rem;
    justify-content: center;
  }
}

// ─── Shared Stat Display ────────────────────────────────────────

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;

  .stat-value {
    font-size: 1.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #888;
  }

  &--large .stat-value {
    font-size: 3rem;
    color: #ffd700;
  }
}
```

**Step 3: Verify in the browser**

1. Open piano visualizer
2. Press backtick to activate game mode
3. Confirm countdown appears (3, 2, 1, GO!)
4. Confirm game notes start falling after countdown
5. Play notes and watch the score update in the header

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/components/GameOverlay.jsx frontend/src/modules/Piano/components/GameOverlay.scss
git commit -m "feat(piano): add GameOverlay with countdown, banners, victory screen"
```

---

## Task 8: Game Mode Header Styles

Add CSS for the game mode header (score, level progress, miss counter).

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.scss`

**Step 1: Add game mode header styles**

Append inside the `.piano-visualizer` block in `PianoVisualizer.scss`:

```scss
  // ─── Game Mode Header ──────────────────────────────────────────

  &.game-mode .piano-header {
    background: rgba(20, 20, 30, 0.95);
    color: #fff;
    height: 12%;  // Shorter header during game mode
  }

  .header-right {
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 10;
  }

  .game-score {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;

    .score-value {
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #00ffc8;
      text-shadow: 0 0 10px rgba(0, 255, 200, 0.4);
    }

    .combo-badge {
      font-size: 1.2rem;
      font-weight: 700;
      color: #ffd700;
      text-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
    }
  }

  .level-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 300px;

    .level-name {
      font-size: 1rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #ccc;
    }

    .progress-bar-container {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;

      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #00ffc8, #00ddaa);
        border-radius: 4px;
        transition: width 0.15s ease-out;
      }
    }
  }

  .miss-counter {
    display: flex;
    align-items: baseline;
    gap: 0.2rem;
    font-variant-numeric: tabular-nums;

    .miss-count {
      font-size: 1.5rem;
      font-weight: 700;
      color: #ff6666;
    }

    .miss-separator {
      font-size: 1rem;
      color: #666;
    }

    .miss-max {
      font-size: 1rem;
      color: #666;
    }

    .miss-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      margin-left: 0.3rem;
    }
  }
```

**Step 2: Verify layout in the browser**

1. Activate game mode
2. Confirm: left = score + combo, center = level name + progress bar, right = miss counter
3. Play notes and see score/combo/misses update live

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.scss
git commit -m "feat(piano): add game mode header styles for score, level, misses"
```

---

## Task 9: Game Note Positioning Fix — Perspective Transform

The existing waterfall uses a 3D perspective with `rotateX(60deg)`. Game notes positioned with `top` inside `.waterfall-perspective` inherit this transform. We need game notes to fall in the same 3D space — `top: 0%` at the top of the perspective plane, `top: 100%` at the bottom (near the keyboard).

However, the perspective container has `height: 300%` (extended runway). Game notes should only use the visible portion. We need to adjust.

**Files:**
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.scss`

**Step 1: Scope game note positioning within visible area**

Update the `.game-note` rule in `NoteWaterfall.scss`. The `--top` variable represents position from 0% (hit line/bottom) to 100% (spawn/top) within the **visible** waterfall area. Since `.waterfall-perspective` is 300% tall, the visible portion maps to 67%-100% of the perspective height. We need to convert:

```scss
.game-note {
  position: absolute;
  left: var(--x);
  width: var(--width);
  height: 20px;
  // Map --top (0-100% of visible area) into the 300% tall perspective container
  // Visible area = bottom 1/3 of the 300% container = 67% to 100%
  // So: bottom = (1 - top/100) * 33.33%
  bottom: calc((1 - var(--top) / 100) * 33.33%);
  top: auto; // Override any previous top value
  transform: translateX(-50%);
  border-radius: 4px;
  pointer-events: none;
  z-index: 5;

  /* ... rest of styles unchanged ... */
}
```

Wait — this is getting complex. Let me reconsider the approach.

Actually, the simpler approach: render game notes **outside** the `.waterfall-perspective` div so they don't get the 3D transform. They can be absolute-positioned in the `.note-waterfall` container directly.

**Revised approach — Step 1: Move game notes outside perspective container**

In `NoteWaterfall.jsx`, move the game notes rendering to be a sibling of `.waterfall-perspective`, not inside it:

```jsx
  return (
    <div className={`note-waterfall${gameMode ? ' note-waterfall--game' : ''}`}>
      <div className="waterfall-perspective">
        {/* Free-play rising notes */}
        {visibleNotes.map((note, idx) => { /* ... existing code ... */ })}
      </div>

      {/* Game mode: falling target notes (outside perspective for clean positioning) */}
      {gameNotes.map(gn => (
        gn.notePositions.map(pos => (
          <div
            key={`game-${gn.id}-${pos.pitch}`}
            className={`game-note game-note--${gn.state}${gn.hitResult ? ` game-note--${gn.hitResult}` : ''}`}
            style={{
              '--x': `${pos.x}%`,
              '--width': `${pos.width}%`,
              '--top': `${gn.topPercent}%`,
              '--hue': pos.hue,
            }}
          />
        ))
      ))}

      {gameMode && <div className="hit-line" />}
    </div>
  );
```

**Step 2: Update game-note CSS to use top positioning in flat space**

```scss
.game-note {
  position: absolute;
  left: var(--x);
  width: var(--width);
  height: 20px;
  top: var(--top);  // 0% = top of waterfall, 100% = bottom (hit line)
  transform: translateX(-50%);
  border-radius: 4px;
  pointer-events: none;
  z-index: 15; // Above the perspective container

  /* ... gradient and glow styles unchanged ... */
}
```

This is much cleaner — game notes are flat 2D elements overlaying the waterfall, no perspective distortion.

**Step 3: Verify notes fall correctly**

1. Activate game mode
2. Notes should appear at the top and smoothly fall to the bottom
3. Notes should align with the correct keyboard keys horizontally

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/components/NoteWaterfall.jsx frontend/src/modules/Piano/components/NoteWaterfall.scss
git commit -m "fix(piano): render game notes outside perspective container for clean 2D fall"
```

---

## Task 10: Visual Polish — Hit Feedback Text and Combo Badge

Add floating "Perfect!" / "Good!" / "Miss!" text feedback and a scaling combo badge.

**Files:**
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.jsx`
- Modify: `frontend/src/modules/Piano/components/NoteWaterfall.scss`
- Modify: `frontend/src/modules/Piano/components/GameOverlay.jsx`
- Modify: `frontend/src/modules/Piano/components/GameOverlay.scss`

**Step 1: Add hit feedback text to game notes**

In `NoteWaterfall.jsx`, update the game note rendering to show feedback text for hit/missed notes:

```jsx
      {/* Game mode: falling target notes */}
      {gameNotes.map(gn => (
        <div key={`game-group-${gn.id}`}>
          {gn.notePositions.map(pos => (
            <div
              key={`game-${gn.id}-${pos.pitch}`}
              className={`game-note game-note--${gn.state}${gn.hitResult ? ` game-note--${gn.hitResult}` : ''}`}
              style={{
                '--x': `${pos.x}%`,
                '--width': `${pos.width}%`,
                '--top': `${gn.topPercent}%`,
                '--hue': pos.hue,
              }}
            />
          ))}
          {/* Hit/miss feedback text (show once per group, centered on first pitch) */}
          {gn.state !== 'falling' && (
            <div
              className={`hit-feedback hit-feedback--${gn.hitResult || 'miss'}`}
              style={{
                '--x': `${gn.notePositions[0]?.x ?? 50}%`,
                '--top': `${gn.topPercent}%`,
              }}
            >
              {gn.hitResult === 'perfect' ? 'Perfect!' : gn.hitResult === 'good' ? 'Good!' : 'Miss!'}
            </div>
          )}
        </div>
      ))}
```

**Step 2: Add feedback text styles**

Append to `NoteWaterfall.scss`:

```scss
// Hit/miss feedback text
.hit-feedback {
  position: absolute;
  left: var(--x);
  top: var(--top);
  transform: translate(-50%, -150%);
  font-size: 1rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  pointer-events: none;
  z-index: 16;
  white-space: nowrap;

  &--perfect {
    color: #00ff88;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.8);
  }

  &--good {
    color: #ffdd00;
    text-shadow: 0 0 10px rgba(255, 221, 0, 0.8);
  }

  &--miss {
    color: #ff4444;
    text-shadow: 0 0 10px rgba(255, 68, 68, 0.8);
  }
}
```

**Step 3: Add combo badge to GameOverlay**

In `GameOverlay.jsx`, add a combo display for the PLAYING state. Update the final return (for PLAYING state) from `return null` to:

```jsx
  // PLAYING state — show combo badge if combo > 5
  if (gameState === 'PLAYING' && score.combo > 5) {
    return (
      <div className="game-overlay game-overlay--playing">
        <div className="combo-display">
          <span className="combo-number">{score.combo}x</span>
          <span className="combo-label">COMBO</span>
        </div>
      </div>
    );
  }

  return null;
```

**Step 4: Add combo badge styles**

Append to `GameOverlay.scss`:

```scss
// ─── Combo Badge (during play) ──────────────────────────────────

.game-overlay--playing {
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 30%;
}

.combo-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;

  .combo-number {
    font-size: 3rem;
    font-weight: 900;
    color: #ffd700;
    text-shadow:
      0 0 20px rgba(255, 215, 0, 0.6),
      0 0 40px rgba(255, 215, 0, 0.3);
    font-variant-numeric: tabular-nums;
  }

  .combo-label {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: rgba(255, 215, 0, 0.7);
  }
}
```

**Step 5: Verify in browser**

1. Activate game mode
2. Hit notes — see "Perfect!" or "Good!" text appear
3. Let notes pass — see "Miss!" text
4. Build a combo > 5 — see combo badge appear
5. Miss a note — combo badge disappears

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/components/NoteWaterfall.jsx frontend/src/modules/Piano/components/NoteWaterfall.scss frontend/src/modules/Piano/components/GameOverlay.jsx frontend/src/modules/Piano/components/GameOverlay.scss
git commit -m "feat(piano): add hit feedback text and combo badge display"
```

---

## Task 11: Integration Testing

Verify the full game loop works end-to-end.

**Files:**
- No new files — manual testing checklist

**Step 1: Start the dev server**

```bash
lsof -i :3111  # Check if already running
# If not running:
npm run dev
```

**Step 2: Test the full game loop**

Open the piano visualizer in the browser and run through this checklist:

| # | Test | Expected |
|---|------|----------|
| 1 | Free-play mode works normally | Notes rise, keyboard lights up, chord staff shows |
| 2 | Press backtick to activate game mode | 3-2-1-GO countdown appears |
| 3 | After countdown, notes start falling | Notes fall from top toward hit line |
| 4 | Header shows game HUD | Score (left), level name + progress bar (center), misses (right) |
| 5 | Chord staff is hidden | Header center shows level info, not notation |
| 6 | Play matching notes on time | "Perfect!" or "Good!" text, score increases, combo increments |
| 7 | Let notes pass the hit line | "Miss!" text, combo resets to 0, miss counter increments |
| 8 | Reach max_misses | "Try Again!" banner for 3s, then countdown restarts same level |
| 9 | Reach points_to_advance | "Level Complete!" banner with stats, auto-advances to next level |
| 10 | Complete all levels | Victory screen with final score, accuracy %, max combo |
| 11 | Press backtick during game | Exits game mode, returns to free-play |
| 12 | Inactivity timer disabled during game | No countdown bar during game mode |
| 13 | Extra notes (noodling) | No penalty for playing non-target notes |

**Step 3: Check browser console for errors**

Open DevTools → Console. Look for:
- No React warnings about invalid hook calls
- No undefined property errors
- Structured log events appearing (piano.game.*)

**Step 4: Fix any issues found**

Address bugs discovered during testing. Each fix is a separate commit.

**Step 5: Final commit (if any fixes needed)**

```bash
git add -p  # Stage only the fixes
git commit -m "fix(piano): address game mode integration issues"
```

---

## Task 12: Update Module Exports

Make sure the Piano module's index.js exports the new files for potential reuse.

**Files:**
- Modify: `frontend/src/modules/Piano/index.js`

**Step 1: Check current exports**

Read `frontend/src/modules/Piano/index.js` to see current exports.

**Step 2: Add new exports**

Add exports for the new modules:

```js
export { useGameMode } from './useGameMode.js';
export { GameOverlay } from './components/GameOverlay';
```

Only add these if the existing index.js follows a pattern of re-exporting submodules. If it just exports `PianoVisualizer`, that's fine — leave it as-is since the game components are internal to the Piano module.

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/index.js
git commit -m "chore(piano): update module exports"
```

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `data/household/config/piano.yml` | Game YAML config with 5 levels |
| 2 | `noteUtils.js` + `NoteWaterfall.jsx` | Extract shared positioning functions |
| 3 | `gameEngine.js` | Pure functions: state, spawning, hits, scoring |
| 4 | `useGameMode.js` | React hook: state machine, timers, integration |
| 5 | `PianoVisualizer.jsx` + placeholder `GameOverlay.jsx` | Config loading, conditional header, hook wiring |
| 6 | `NoteWaterfall.jsx` + `.scss` | Falling game notes, hit line |
| 7 | `GameOverlay.jsx` + `.scss` | Countdown, banners, victory screen |
| 8 | `PianoVisualizer.scss` | Game mode header styles |
| 9 | `NoteWaterfall.jsx` + `.scss` | Fix positioning (flat 2D, outside perspective) |
| 10 | `NoteWaterfall.*` + `GameOverlay.*` | Hit feedback text, combo badge |
| 11 | — | Manual integration testing |
| 12 | `index.js` | Module exports cleanup |

**Total new files:** 4 (`piano.yml`, `noteUtils.js`, `gameEngine.js`, `useGameMode.js`, `GameOverlay.jsx`, `GameOverlay.scss`)
**Total modified files:** 4 (`PianoVisualizer.jsx`, `PianoVisualizer.scss`, `NoteWaterfall.jsx`, `NoteWaterfall.scss`)
