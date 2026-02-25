# Piano Module Architecture Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all 14 violations from the 2026-02-24 Piano Module Architecture Audit — eliminating DRY violations, consolidating activation systems, leveraging the game registry, decomposing the god component, fixing naming, and adding structured logging.

**Architecture:** Bottom-up approach — extract shared utilities first, then consolidate systems, then decompose PianoVisualizer. Each task is independently committable and preserves existing behavior (pure refactoring unless noted).

**Tech Stack:** React 18, Vitest, structured logging (`frontend/src/lib/logging/`)

**Test runner:** `npx vitest run <path>` from `frontend/` directory

**Audit reference:** `docs/_wip/audits/2026-02-24-piano-module-architecture-audit.md`

---

## Task 1: PianoKeyboard — Import from noteUtils (V4)

**Files:**
- Modify: `frontend/src/modules/Piano/components/PianoKeyboard.jsx`

**Why:** PianoKeyboard locally redefines `WHITE_KEY_NOTES`, `isWhiteKey`, `NOTE_NAMES`, and `getNoteLabel` — all identical to exports from `noteUtils.js`.

**Step 1: Replace local definitions with imports**

In `PianoKeyboard.jsx`, replace lines 1-14:

```jsx
import React, { useMemo } from 'react';
import './PianoKeyboard.scss';

// White keys in an octave (C, D, E, F, G, A, B)
const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const getNoteLabel = (note) => {
  const octave = Math.floor(note / 12) - 1;
  const name = NOTE_NAMES[note % 12];
  return `${name}${octave}`;
};
```

With:

```jsx
import React, { useMemo } from 'react';
import { isWhiteKey, getNoteName } from '../noteUtils.js';
import './PianoKeyboard.scss';
```

Then replace both calls to `getNoteLabel(note)` (lines 50 and 53) with `getNoteName(note)`.

**Step 2: Run existing tests to verify no regressions**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All existing tests pass (tetrisEngine, useStaffMatching, flashcardEngine).

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/components/PianoKeyboard.jsx
git commit -m "refactor(piano): import noteUtils in PianoKeyboard instead of local defs (V4)"
```

---

## Task 2: Fix useMemo-as-Ref Anti-pattern (V14)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx:34`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx:31`

**Why:** `useMemo(() => ({ current: game.phase }), [])` abuses useMemo as a ref factory. React doesn't guarantee memoization semantics. `useRef` is the correct tool.

**Step 1: Fix PianoTetris.jsx**

Replace line 34:
```jsx
  const prevPhase = useMemo(() => ({ current: game.phase }), []);
```
With:
```jsx
  const prevPhase = useRef(game.phase);
```

Update the import on line 1 — add `useRef`:
```jsx
import { useMemo, useEffect, useRef } from 'react';
```

**Step 2: Fix PianoFlashcards.jsx**

Replace line 31:
```jsx
  const phaseRef = useMemo(() => ({ prev: game.phase }), []);
```
With:
```jsx
  const phaseRef = useRef(game.phase);
```

Update the import on line 1 — add `useRef`:
```jsx
import { useMemo, useEffect, useRef } from 'react';
```

Also update line 33 and 37 since the ref shape changes from `phaseRef.prev` to `phaseRef.current`:

Replace lines 32-38:
```jsx
  useEffect(() => {
    if (phaseRef.prev === 'COMPLETE' && game.phase === 'IDLE') {
      logger.info('flashcards.auto-deactivate', {});
      onDeactivate?.();
    }
    phaseRef.prev = game.phase;
  }, [game.phase, onDeactivate, logger]);
```
With:
```jsx
  useEffect(() => {
    if (phaseRef.current === 'COMPLETE' && game.phase === 'IDLE') {
      logger.info('flashcards.auto-deactivate', {});
      onDeactivate?.();
    }
    phaseRef.current = game.phase;
  }, [game.phase, onDeactivate, logger]);
```

**Step 3: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx
git commit -m "refactor(piano): replace useMemo-as-ref with useRef (V14)"
```

---

## Task 3: Extract shuffle and buildNotePool to Shared Utils (V5, V6)

**Files:**
- Modify: `frontend/src/modules/Piano/noteUtils.js`
- Modify: `frontend/src/modules/Piano/PianoTetris/useStaffMatching.js`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`
- Create: `frontend/src/modules/Piano/noteUtils.test.js`

**Why:** Fisher-Yates `shuffle()` is copy-pasted in two files (V5). The "build pool → filter → shuffle" pattern is duplicated in `generateTargets` and `generateCardPitches` (V6).

**Step 1: Write tests for the new shared functions**

Create `frontend/src/modules/Piano/noteUtils.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { shuffle, buildNotePool, isWhiteKey, getNoteName } from './noteUtils.js';

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
```

**Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/modules/Piano/noteUtils.test.js
```

Expected: FAIL — `shuffle` and `buildNotePool` are not exported from noteUtils.js.

**Step 3: Add shuffle and buildNotePool to noteUtils.js**

Append to `frontend/src/modules/Piano/noteUtils.js` (after the `getNoteName` export):

```js

/**
 * Fisher-Yates shuffle (in-place). Returns the array.
 * @param {any[]} arr
 * @returns {any[]}
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build an array of MIDI notes within [low, high] inclusive,
 * optionally filtered to white keys only.
 *
 * @param {[number, number]} noteRange - [low, high] inclusive
 * @param {boolean} whiteKeysOnly
 * @returns {number[]}
 */
export function buildNotePool(noteRange, whiteKeysOnly = false) {
  const [low, high] = noteRange;
  const pool = [];
  for (let n = low; n <= high; n++) {
    if (whiteKeysOnly && !isWhiteKey(n)) continue;
    pool.push(n);
  }
  return pool;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/modules/Piano/noteUtils.test.js
```

Expected: All pass.

**Step 5: Update useStaffMatching.js to use shared functions**

In `frontend/src/modules/Piano/PianoTetris/useStaffMatching.js`:

Add import (line 3):
```js
import { isWhiteKey, shuffle, buildNotePool } from '../noteUtils.js';
```

Remove the old import of just `isWhiteKey`:
```js
import { isWhiteKey } from '../noteUtils.js';
```

Delete the local `shuffle` function (lines 17-26).

Replace `generateTargets` body (lines 36-67) — replace the pool-building logic with `buildNotePool`:

```js
export function generateTargets(noteRange, complexity = 'single', whiteKeysOnly = false) {
  const notesPerAction = { single: 1, dyad: 2, triad: 3 };
  let count = notesPerAction[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

  const totalNeeded = count * ACTIONS.length;

  if (available.length < totalNeeded) {
    count = 1;
  }

  const targets = {};
  for (let a = 0; a < ACTIONS.length; a++) {
    const start = a * count;
    const pitches = [];
    for (let i = 0; i < count; i++) {
      pitches.push(available[(start + i) % available.length]);
    }
    targets[ACTIONS[a]] = pitches;
  }

  return targets;
}
```

Note: `shuffle` is called on a copy (`[...buildNotePool()]`) to avoid mutating the pool.

**Step 6: Update flashcardEngine.js to use shared functions**

In `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`:

Replace line 1:
```js
import { isWhiteKey } from '../noteUtils.js';
```
With:
```js
import { shuffle, buildNotePool } from '../noteUtils.js';
```

Delete the local `shuffle` function (lines 6-12).

Replace `generateCardPitches` body (lines 22-38):

```js
export function generateCardPitches(noteRange, complexity = 'single', whiteKeysOnly = false) {
  const counts = { single: 1, dyad: 2, triad: 3 };
  let count = counts[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

  count = Math.min(count, available.length);

  return available.slice(0, count);
}
```

**Step 7: Run all Piano tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass (noteUtils, tetrisEngine, useStaffMatching, flashcardEngine).

**Step 8: Commit**

```bash
git add frontend/src/modules/Piano/noteUtils.js frontend/src/modules/Piano/noteUtils.test.js frontend/src/modules/Piano/PianoTetris/useStaffMatching.js frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js
git commit -m "refactor(piano): extract shuffle and buildNotePool to noteUtils (V5, V6)"
```

---

## Task 4: Extract computeKeyboardRange (V3)

**Files:**
- Modify: `frontend/src/modules/Piano/noteUtils.js`
- Modify: `frontend/src/modules/Piano/noteUtils.test.js`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`
- Modify: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`

**Why:** The "pad range, ensure 2-octave minimum, clamp to [21, 108]" algorithm is duplicated 3× with minor variations.

**Step 1: Write tests**

Append to `frontend/src/modules/Piano/noteUtils.test.js`:

```js

// ─── computeKeyboardRange ───────────────────────────────────────

describe('computeKeyboardRange', () => {
  // Need to import it
});
```

Actually, add the import at top of the test file and write the tests:

Add `computeKeyboardRange` to the import line, then add:

```js
describe('computeKeyboardRange', () => {
  it('pads range by ~1/3 of span on each side', () => {
    // Range [60, 72] = span 12, padding = 4
    const { startNote, endNote } = computeKeyboardRange([60, 72]);
    expect(startNote).toBe(56); // 60 - 4
    expect(endNote).toBe(76);   // 72 + 4
  });

  it('enforces minimum 2-octave (24 semitone) display span', () => {
    // Range [60, 64] = span 4, padded span = 4 + 2*1 = 6 < 24
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
```

**Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/modules/Piano/noteUtils.test.js
```

Expected: FAIL — `computeKeyboardRange` not exported.

**Step 3: Implement computeKeyboardRange in noteUtils.js**

Append to `frontend/src/modules/Piano/noteUtils.js`:

```js

/**
 * Compute display range for a piano keyboard given a game's note range.
 * Pads by ~1/3 of the span on each side, ensures minimum 2-octave display,
 * and clamps to the full piano range [21, 108].
 *
 * @param {[number, number]|null} noteRange - [low, high] or null for full range
 * @returns {{ startNote: number, endNote: number }}
 */
export function computeKeyboardRange(noteRange) {
  if (!noteRange) return { startNote: 21, endNote: 108 };

  const [low, high] = noteRange;
  const span = high - low;
  const padding = Math.max(4, Math.round(span / 3));
  const minSpan = 24;

  let displayStart = low - padding;
  let displayEnd = high + padding;
  const displaySpan = displayEnd - displayStart;

  if (displaySpan < minSpan) {
    const extra = minSpan - displaySpan;
    displayStart -= Math.floor(extra / 2);
    displayEnd += Math.ceil(extra / 2);
  }

  return {
    startNote: Math.max(21, displayStart),
    endNote: Math.min(108, displayEnd),
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/modules/Piano/noteUtils.test.js
```

Expected: All pass.

**Step 5: Update PianoVisualizer.jsx**

Add `computeKeyboardRange` to the import from `noteUtils.js`:

```jsx
import { isWhiteKey, computeKeyboardRange } from './noteUtils.js';
```

Replace lines 60-83 (the gameRange useMemo):

```jsx
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(gameRange || null),
    [gameRange]
  );
```

**Step 6: Update PianoTetris.jsx**

Add import:
```jsx
import { computeKeyboardRange } from '../noteUtils.js';
```

Replace lines 46-68 (the keyboard range useMemo):

```jsx
  const { startNote, endNote } = useMemo(() => {
    const noteRange = currentLevelConfig?.note_range ?? [60, 72];
    return computeKeyboardRange(noteRange);
  }, [currentLevelConfig]);
```

**Step 7: Update PianoFlashcards.jsx**

Add import:
```jsx
import { computeKeyboardRange } from '../noteUtils.js';
```

Replace lines 41-56 (the keyboard range useMemo):

```jsx
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(game.levelConfig?.note_range ?? null),
    [game.levelConfig]
  );
```

**Step 8: Run all Piano tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 9: Commit**

```bash
git add frontend/src/modules/Piano/noteUtils.js frontend/src/modules/Piano/noteUtils.test.js frontend/src/modules/Piano/PianoVisualizer.jsx frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx
git commit -m "refactor(piano): extract computeKeyboardRange to noteUtils (V3)"
```

---

## Task 5: Replace Raw console.* in PianoVisualizer (V10)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Why:** CLAUDE.md mandates structured logging. PianoVisualizer has 3 raw console.debug/warn calls.

**Step 1: Add logger import and instance**

Add import near the top of `PianoVisualizer.jsx` (after the other logging-using files' pattern):

```jsx
import { getChildLogger } from '../../lib/logging/singleton.js';
```

Inside the component function, add (near the top, after the hooks):

```jsx
  const logger = useMemo(() => getChildLogger({ component: 'piano-visualizer' }), []);
```

**Step 2: Replace console calls**

Replace line 132:
```js
.then(() => console.debug('[Piano] HA on_open script executed'))
```
With:
```js
.then(() => logger.debug('ha.on-open-executed', {}))
```

Replace line 133:
```js
.catch(err => console.warn('[Piano] HA on_open script failed:', err.message));
```
With:
```js
.catch(err => logger.warn('ha.on-open-failed', { error: err.message }));
```

Replace line 136:
```js
console.warn('[Piano] Config load failed — HDMI auto-switch disabled:', err.message);
```
With:
```js
logger.warn('config-load-failed', { error: err.message });
```

**Step 3: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): replace raw console.* with structured logger (V10)"
```

---

## Task 6: Add Logging to useFlashcardGame (V11)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js`

**Why:** Unlike useTetrisGame and useGameMode, useFlashcardGame has zero logging. Per CLAUDE.md: "New features must ship with logging."

**Step 1: Add logger**

Add import at top:
```js
import { getChildLogger } from '../../../lib/logging/singleton.js';
```

Add `useMemo` to the React import (it's already imported).

Inside `useFlashcardGame`, add logger:
```js
  const logger = useMemo(() => getChildLogger({ component: 'flashcard-game' }), []);
```

**Step 2: Add logging at key lifecycle points**

In `startGame` callback:
```js
  const startGame = useCallback(() => {
    logger.info('flashcards.game-started', {});
    setState({ ...createInitialState(), phase: 'PLAYING' });
  }, [logger]);
```

In the chord match evaluation effect, add logging to the three state transitions:

After the first-try correct branch (after `setState`):
```js
    if (result === 'correct' && !state.cardFailed) {
      logger.debug('flashcards.card-hit', { pitches: state.currentCard.pitches, firstTry: true });
      setState(prev => ({ ... }));
    } else if (result === 'correct' && state.cardFailed) {
      logger.debug('flashcards.card-hit', { pitches: state.currentCard.pitches, firstTry: false });
      setState(prev => ({ ... }));
    } else if (result === 'wrong') {
      logger.debug('flashcards.card-miss', { pitches: state.currentCard.pitches });
      setState(prev => ({ ... }));
    }
```

In the level-up logic inside the advance timer (inside the setTimeout callback in the `state.cardStatus === 'hit'` effect):

After the `if (newScore >= threshold)` check, add logging:
```js
        if (newScore >= threshold) {
          const nextLevel = prev.level + 1;
          if (nextLevel >= levels.length) {
            logger.info('flashcards.game-complete', { finalScore: newScore, level: prev.level });
            return { ...prev, phase: 'COMPLETE', currentCard: null, cardStatus: null };
          }
          logger.info('flashcards.level-advance', { from: prev.level, to: nextLevel, score: newScore });
          return { ...prev, level: nextLevel, score: 0, currentCard: null, cardStatus: null };
        }
```

Note: Since `logger` is now referenced inside the `startGame` callback, add it to the dependency array. For the effects that log inside `setState` updater functions, the logger ref is stable (useMemo with []) so it won't cause extra renders.

**Step 3: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js
git commit -m "feat(piano): add structured logging to useFlashcardGame (V11)"
```

---

## Task 7: Extract useAutoGameLifecycle Hook (V9)

**Files:**
- Create: `frontend/src/modules/Piano/useAutoGameLifecycle.js`
- Modify: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`

**Why:** Both PianoTetris and PianoFlashcards contain nearly identical auto-start-on-mount + auto-deactivate-on-completion logic.

**Step 1: Create the shared hook**

Create `frontend/src/modules/Piano/useAutoGameLifecycle.js`:

```js
import { useEffect, useRef } from 'react';

/**
 * Shared hook for fullscreen game lifecycle:
 * 1. Auto-starts the game on mount when phase is IDLE.
 * 2. Auto-deactivates when phase returns to IDLE after a terminal phase.
 *
 * @param {string} phase - Current game phase (e.g. 'IDLE', 'PLAYING', 'GAME_OVER', 'COMPLETE')
 * @param {function} startGame - Callback to start the game
 * @param {function} onDeactivate - Callback to exit the game
 * @param {Object} logger - Structured logger instance
 * @param {string} gameName - Game name for log events (e.g. 'tetris', 'flashcards')
 */
export function useAutoGameLifecycle(phase, startGame, onDeactivate, logger, gameName) {
  const prevPhaseRef = useRef(phase);

  // Auto-start on mount when IDLE
  useEffect(() => {
    if (phase === 'IDLE') {
      logger.info(`${gameName}.auto-start`, {});
      startGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional mount-only

  // Auto-deactivate when phase transitions back to IDLE from non-IDLE
  useEffect(() => {
    if (prevPhaseRef.current !== 'IDLE' && phase === 'IDLE') {
      logger.info(`${gameName}.auto-deactivate`, {});
      onDeactivate?.();
    }
    prevPhaseRef.current = phase;
  }, [phase, onDeactivate, logger, gameName]);
}
```

**Step 2: Update PianoTetris.jsx**

Add import:
```jsx
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
```

Remove the auto-start effect (lines 26-31), the prevPhase ref (line 34), and the auto-deactivate effect (lines 35-41). Replace all three with:

```jsx
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'tetris');
```

Also remove `useRef` from the React import if no longer needed (check if it's used elsewhere in PianoTetris — it's not, so remove it).

**Step 3: Update PianoFlashcards.jsx**

Add import:
```jsx
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
```

Remove the auto-start effect (lines 23-28), the phaseRef (line 31), and the auto-deactivate effect (lines 32-38). Replace with:

```jsx
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'flashcards');
```

Also remove `useRef` from the React import if no longer needed.

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/useAutoGameLifecycle.js frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx
git commit -m "refactor(piano): extract useAutoGameLifecycle hook (V9)"
```

---

## Task 8: Rename Rhythm Game Files (V8)

**Files:**
- Rename: `gameEngine.js` → `rhythmEngine.js`
- Rename: `components/GameOverlay.jsx` → `components/RhythmOverlay.jsx`
- Rename: `components/GameOverlay.scss` → `components/RhythmOverlay.scss`
- Rename: `useGameMode.js` → `useRhythmGame.js`
- Update all imports across the module

**Why:** `gameEngine.js`, `GameOverlay.jsx`, and `useGameMode.js` imply shared infrastructure but are rhythm-game-specific. Tetris has clearly-named `tetrisEngine.js` and `TetrisOverlay.jsx`.

**Step 1: Rename files using git mv**

```bash
cd frontend/src/modules/Piano
git mv gameEngine.js rhythmEngine.js
git mv components/GameOverlay.jsx components/RhythmOverlay.jsx
git mv components/GameOverlay.scss components/RhythmOverlay.scss
git mv useGameMode.js useRhythmGame.js
```

**Step 2: Update internal references**

In `rhythmEngine.js`: No changes needed (no internal imports to rename).

In `components/RhythmOverlay.jsx`: Update SCSS import:
```jsx
import './RhythmOverlay.scss';
```

In `useRhythmGame.js`: Update import path:
```js
} from './rhythmEngine.js';
```

Also update the export name at the bottom (line 354):
```js
export default useRhythmGame;
```

And rename the function:
```js
export function useRhythmGame(activeNotes, noteHistory, gameConfig) {
```

**Step 3: Update all importing files**

In `PianoVisualizer.jsx`:
- Line 9: `import { useRhythmGame } from './useRhythmGame.js';`
- Line 11: `import { TOTAL_HEALTH } from './rhythmEngine.js';`
- Line 12: `import { RhythmOverlay } from './components/RhythmOverlay';`
- Line 49: `const game = useRhythmGame(activeNotes, noteHistory, gameConfig);`
- Lines 339-346: `<RhythmOverlay` instead of `<GameOverlay`

In `useGameActivation.js`:
- Line 3: `import { isActivationComboHeld } from './rhythmEngine.js';`

In `gameRegistry.js`:
- Line 11: `component: () => import('./components/RhythmOverlay'),`
- Line 12: `hook: () => import('./useRhythmGame'),`

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 5: Commit**

```bash
git add -A frontend/src/modules/Piano/
git commit -m "refactor(piano): rename rhythm game files for clarity (V8)

gameEngine.js → rhythmEngine.js
GameOverlay.jsx → RhythmOverlay.jsx
useGameMode.js → useRhythmGame.js"
```

---

## Task 9: Standardize Config Prop Names (V13)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Why:** Each game uses a different prop name for the same concept: `tetrisConfig`, `flashcardsConfig`, `gameConfig`. Standardize to `gameConfig`.

**Step 1: Update PianoTetris.jsx**

Change function signature:
```jsx
export function PianoTetris({ activeNotes, gameConfig, onDeactivate }) {
```

Update reference on line 23:
```jsx
  const game = useTetrisGame(activeNotes, gameConfig);
```

And line 44:
```jsx
  const levels = gameConfig?.levels ?? [];
```

**Step 2: Update PianoFlashcards.jsx**

Change function signature:
```jsx
export function PianoFlashcards({ activeNotes, gameConfig, onDeactivate }) {
```

Update reference on line 20:
```jsx
  const game = useFlashcardGame(activeNotes, gameConfig);
```

**Step 3: Update PianoVisualizer.jsx call sites**

Replace (in the tetris rendering):
```jsx
<PianoTetris
  activeNotes={activeNotes}
  tetrisConfig={gamesConfig?.tetris}
  onDeactivate={activation.deactivate}
/>
```
With:
```jsx
<PianoTetris
  activeNotes={activeNotes}
  gameConfig={gamesConfig?.tetris}
  onDeactivate={activation.deactivate}
/>
```

Replace (in the flashcards rendering):
```jsx
<PianoFlashcards
  activeNotes={activeNotes}
  flashcardsConfig={gamesConfig?.flashcards}
  onDeactivate={activation.deactivate}
/>
```
With:
```jsx
<PianoFlashcards
  activeNotes={activeNotes}
  gameConfig={gamesConfig?.flashcards}
  onDeactivate={activation.deactivate}
/>
```

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): standardize config prop to gameConfig (V13)"
```

---

## Task 10: Consolidate Rhythm Activation + Config (V2)

**Files:**
- Modify: `data/household/config/piano.yml`
- Modify: `frontend/src/modules/Piano/useRhythmGame.js`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Why:** The rhythm game has its own combo detection + dev shortcut in `useRhythmGame` (lines 95-148), duplicating logic centralized in `useGameActivation`. The rhythm config lives under both `game.*` and `games.rhythm.*` — two sources of truth.

**Step 1: Migrate piano.yml config**

Move timing, scoring, and levels from `game:` into `games.rhythm:`. Remove the top-level `game:` section entirely.

The updated `piano.yml` should have this structure:

```yaml
# Piano app configuration

# ── Multi-game registry ──────────────────────────────────────────
games:
  rhythm:
    activation:
      notes: [30, 102]        # F#1 + F#7 — first and last F# keys on keyboard
      window_ms: 300

    timing:
      perfect_ms: 80
      good_ms: 200
      miss_threshold_ms: 400

    scoring:
      perfect_points: 100
      good_points: 50
      miss_penalty: 0
      combo_multiplier: 0.1

    levels:
      # (all existing levels unchanged)
      ...

  tetris:
    # (unchanged)
    ...

  flashcards:
    # (unchanged)
    ...
```

Keep all existing level definitions under `games.rhythm.levels` — just move them from `game.levels`.

**Step 2: Remove activation detection from useRhythmGame.js**

Delete the activation detection effect (lines 95-119 — the `useEffect` that checks `isActivationComboHeld`).

Delete the dev shortcut effect (lines 123-148 — the `useEffect` with backtick handler).

Delete the `activationCooldownRef` (line 41).

Remove `isActivationComboHeld` from the import on line 7.

Remove `activation` from the destructured config (line 59). The hook no longer cares about activation — it's handled by `useGameActivation`.

The hook's activation-related cleanup (lines 116-118: `cleanup(); setGameState(createInitialState());`) moves to PianoVisualizer.

**Step 3: Add external start/stop controls to useRhythmGame**

Add a `startGame` callback and a `deactivate` callback to the returned object, following the pattern established by `useFlashcardGame`:

```js
  const startGame = useCallback(() => {
    logger.info('piano.game.activated', {});
    startCountdown();
  }, [startCountdown, logger]);

  const deactivateGame = useCallback(() => {
    logger.info('piano.game.deactivated', {});
    cleanup();
    setGameState(createInitialState());
  }, [cleanup, logger]);
```

Add these to the return object:
```js
  return {
    ...existing fields,
    startGame,
    deactivate: deactivateGame,
  };
```

**Step 4: Update PianoVisualizer.jsx**

The visualizer currently loads two separate configs:
- `gameConfig` from `pianoAppConfig.parsed.game` (rhythm)
- `gamesConfig` from `pianoAppConfig.parsed.games` (all games)

After migration, everything is under `games`. Update the config loading:

Replace lines 118-124:
```jsx
        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gc = pianoAppConfig?.parsed?.game ?? null;
          setGameConfig(gc);
          const gamesC = pianoAppConfig?.parsed?.games ?? null;
          setGamesConfig(gamesC);
        } catch (err) {
```
With:
```jsx
        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gamesC = pianoAppConfig?.parsed?.games ?? null;
          setGamesConfig(gamesC);
        } catch (err) {
```

Remove the `gameConfig` state entirely (line 45): `const [gameConfig, setGameConfig] = useState(null);`

Update useRhythmGame call — pass the rhythm config from gamesConfig:
```jsx
  const rhythmConfig = activation.activeGameId === 'rhythm' ? gamesConfig?.rhythm : null;
  const game = useRhythmGame(activeNotes, noteHistory, rhythmConfig);
```

This ensures the rhythm game's hook only runs actively when rhythm is the active game. When rhythmConfig is null, useRhythmGame returns IDLE state (it already handles null config).

The rhythm game now starts/stops through useGameActivation. When `activation.activeGameId` changes to `'rhythm'`, the rhythmConfig becomes non-null. But we also need to trigger `game.startGame()` — add an effect:

```jsx
  // Auto-start rhythm game when activated
  useEffect(() => {
    if (activation.activeGameId === 'rhythm' && game.gameState === 'IDLE' && rhythmConfig) {
      game.startGame();
    }
  }, [activation.activeGameId, rhythmConfig]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Step 5: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 6: Manual verification**

Start the dev server and test:
1. Play F#1 + F#7 combo → rhythm game activates
2. Play G1 + G7 combo → tetris activates
3. Play F1 + F7 combo → flashcards activates
4. Dev shortcut (backtick) cycles through all three games

**Step 7: Commit**

```bash
git add data/household/config/piano.yml frontend/src/modules/Piano/useRhythmGame.js frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): consolidate rhythm activation into useGameActivation (V2)

Migrated rhythm game config from top-level 'game' to 'games.rhythm' in piano.yml.
Removed duplicate combo detection and dev-shortcut handler from useRhythmGame.
All three games now activate through the same useGameActivation system."
```

---

## Task 11: Dynamic Registry Rendering + Health Meter (V1, V12)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`
- Modify: `frontend/src/modules/Piano/gameRegistry.js`

**Why:** V1: PianoVisualizer hardcodes `PianoTetris` and `PianoFlashcards` with string checks, ignoring the registry's lazy loaders. V12: `TOTAL_HEALTH` is imported from rhythmEngine into the visualizer to render the rhythm game's life meter — coupling the generic visualizer to rhythm internals.

**Step 1: Add a GameRenderer component using the registry**

The rhythm game (layout: 'waterfall') overlays on the waterfall and is deeply integrated with PianoVisualizer's own rendering (falling notes in waterfall, keyboard highlights, header score). It cannot be dynamically loaded the same way. Only 'replace' layout games can be loaded via registry.

Update `gameRegistry.js` to export a `lazy` map:

```js
import { lazy } from 'react';

const GAME_REGISTRY = {
  rhythm: {
    component: () => import('./components/RhythmOverlay'),
    hook: () => import('./useRhythmGame'),
    layout: 'waterfall',
  },
  tetris: {
    component: () => import('./PianoTetris/PianoTetris'),
    hook: () => import('./PianoTetris/useTetrisGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoTetris/PianoTetris')),
  },
  flashcards: {
    component: () => import('./PianoFlashcards/PianoFlashcards'),
    hook: () => import('./PianoFlashcards/useFlashcardGame'),
    layout: 'replace',
    LazyComponent: lazy(() => import('./PianoFlashcards/PianoFlashcards')),
  },
};
```

**Step 2: Update PianoVisualizer to use registry for rendering**

Remove the static imports of PianoTetris and PianoFlashcards:
```jsx
// DELETE these lines:
import { PianoTetris } from './PianoTetris/PianoTetris.jsx';
import { PianoFlashcards } from './PianoFlashcards/PianoFlashcards.jsx';
```

Add Suspense import:
```jsx
import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
```

Replace the hardcoded game rendering block (lines 357-374):

```jsx
{isFullscreenGame && (
  <div className="tetris-fullscreen">
    {activation.activeGameId === 'tetris' && (
      <PianoTetris ... />
    )}
    {activation.activeGameId === 'flashcards' && (
      <PianoFlashcards ... />
    )}
  </div>
)}
```

With dynamic rendering:

```jsx
{isFullscreenGame && activeGameEntry?.LazyComponent && (
  <div className="tetris-fullscreen">
    <Suspense fallback={null}>
      <activeGameEntry.LazyComponent
        activeNotes={activeNotes}
        gameConfig={gamesConfig?.[activation.activeGameId]}
        onDeactivate={activation.deactivate}
      />
    </Suspense>
  </div>
)}
```

Now adding a new 'replace' layout game only requires adding it to `gameRegistry.js` — PianoVisualizer doesn't need to change.

**Step 3: Move life meter to the rhythm game's rendering scope**

The life meter (lines 311-324) depends on `TOTAL_HEALTH` from rhythmEngine. Move it so it's only rendered when the rhythm game is active, and source `TOTAL_HEALTH` from the game state instead of importing it.

First, update `useRhythmGame.js` to export `totalHealth` in its return value:

```js
  return {
    ...existing fields,
    totalHealth: TOTAL_HEALTH,
  };
```

Then in PianoVisualizer, remove the import:
```jsx
// DELETE:
import { TOTAL_HEALTH } from './rhythmEngine.js';
```

Update the life meter to use `game.totalHealth`:
```jsx
{game.isGameMode && game.gameState === 'PLAYING' && (
  <div className="life-meter" aria-hidden="true">
    <div className="life-meter__frame">
      {Array.from({ length: game.totalHealth }, (_, i) => (
        <div
          key={i}
          className={`life-meter__notch${i < Math.ceil(game.health) ? ' life-meter__notch--active' : ''}${
            i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 ? ' life-meter__notch--danger' : ''
          }`}
        />
      ))}
    </div>
  </div>
)}
```

**Step 4: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx frontend/src/modules/Piano/gameRegistry.js frontend/src/modules/Piano/useRhythmGame.js
git commit -m "refactor(piano): use registry for dynamic game rendering, move health meter (V1, V12)"
```

---

## Task 12: Decompose PianoVisualizer God Component (V7)

**Files:**
- Create: `frontend/src/modules/Piano/usePianoConfig.js`
- Create: `frontend/src/modules/Piano/useInactivityTimer.js`
- Create: `frontend/src/modules/Piano/useSessionTracking.js`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Why:** PianoVisualizer handles 10+ responsibilities in ~380 lines. Extract focused hooks to reduce it to pure layout composition.

**Step 1: Create usePianoConfig hook**

Create `frontend/src/modules/Piano/usePianoConfig.js`:

```js
import { useState, useEffect, useRef, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { DaylightAPI } from '../../lib/api.mjs';

/**
 * Loads piano config (device config + app config) and manages HA script lifecycle.
 *
 * @returns {{ gamesConfig: Object|null }}
 */
export function usePianoConfig() {
  const logger = useMemo(() => getChildLogger({ component: 'piano-config' }), []);
  const [gamesConfig, setGamesConfig] = useState(null);
  const pianoConfigRef = useRef(null);

  useEffect(() => {
    const initPiano = async () => {
      try {
        const devicesConfig = await DaylightAPI('api/v1/device/config');
        const pianoConfig = devicesConfig?.devices?.['office-tv']?.modules?.['piano-visualizer'] ?? {};
        pianoConfigRef.current = pianoConfig;

        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gamesC = pianoAppConfig?.parsed?.games ?? null;
          setGamesConfig(gamesC);
        } catch (err) {
          // Game mode unavailable
        }

        if (pianoConfig?.on_open) {
          DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST')
            .then(() => logger.debug('ha.on-open-executed', {}))
            .catch(err => logger.warn('ha.on-open-failed', { error: err.message }));
        }
      } catch (err) {
        logger.warn('config-load-failed', { error: err.message });
      }
    };
    initPiano();

    return () => {
      const config = pianoConfigRef.current;
      if (config?.on_close) {
        DaylightAPI(`/api/v1/home/ha/script/${config.on_close}`, {}, 'POST')
          .catch(err => logger.warn('ha.on-close-failed', { error: err.message }));
      }
    };
  }, [logger]);

  return { gamesConfig };
}
```

**Step 2: Create useInactivityTimer hook**

Create `frontend/src/modules/Piano/useInactivityTimer.js`:

```js
import { useState, useEffect, useRef } from 'react';

const GRACE_PERIOD_MS = 10000;
const COUNTDOWN_MS = 30000;

/**
 * Detects piano inactivity and triggers close after grace period + countdown.
 *
 * @param {Map} activeNotes
 * @param {Array} noteHistory
 * @param {boolean} isAnyGame - true if any game mode is active (suppresses timer)
 * @param {function} onClose - called when countdown reaches zero
 * @returns {{ inactivityState: string, countdownProgress: number }}
 */
export function useInactivityTimer(activeNotes, noteHistory, isAnyGame, onClose) {
  const [inactivityState, setInactivityState] = useState('active');
  const [countdownProgress, setCountdownProgress] = useState(100);
  const lastNoteOffRef = useRef(null);
  const timerRef = useRef(null);

  // Track when all notes are released
  useEffect(() => {
    if (activeNotes.size === 0 && noteHistory.length > 0) {
      lastNoteOffRef.current = Date.now();
    } else if (activeNotes.size > 0) {
      lastNoteOffRef.current = null;
      setInactivityState('active');
      setCountdownProgress(100);
    }
  }, [activeNotes.size, noteHistory.length]);

  // Inactivity detection
  useEffect(() => {
    const checkInactivity = () => {
      if (isAnyGame) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
      if (activeNotes.size > 0) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
      if (!lastNoteOffRef.current) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }

      const elapsed = Date.now() - lastNoteOffRef.current;
      if (elapsed < GRACE_PERIOD_MS) {
        setInactivityState('active');
        setCountdownProgress(100);
      } else if (elapsed < GRACE_PERIOD_MS + COUNTDOWN_MS) {
        setInactivityState('countdown');
        const countdownElapsed = elapsed - GRACE_PERIOD_MS;
        const progress = 100 - (countdownElapsed / COUNTDOWN_MS) * 100;
        setCountdownProgress(Math.max(0, progress));
      } else {
        if (onClose) onClose();
      }
    };

    timerRef.current = setInterval(checkInactivity, 100);
    return () => clearInterval(timerRef.current);
  }, [onClose, activeNotes.size, isAnyGame]);

  return { inactivityState, countdownProgress };
}
```

**Step 3: Create useSessionTracking hook**

Create `frontend/src/modules/Piano/useSessionTracking.js`:

```js
import { useState, useEffect, useRef } from 'react';

/**
 * Tracks piano session duration and note count.
 *
 * @param {Array} noteHistory
 * @returns {{ sessionDuration: number }}
 */
export function useSessionTracking(noteHistory) {
  const [sessionDuration, setSessionDuration] = useState(0);
  const sessionStartRef = useRef(null);

  // Track session start
  useEffect(() => {
    if (noteHistory.length > 0 && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
    }
  }, [noteHistory.length]);

  // Update duration every second
  useEffect(() => {
    const timer = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionDuration((Date.now() - sessionStartRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return { sessionDuration };
}
```

**Step 4: Rewrite PianoVisualizer to use extracted hooks**

The rewritten PianoVisualizer should be ~120 lines of pure layout composition. Here is the complete replacement:

```jsx
import { useState, useEffect, useMemo, Suspense } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { CurrentChordStaff } from './components/CurrentChordStaff';
import { useMidiSubscription } from './useMidiSubscription';
import { computeKeyboardRange } from './noteUtils.js';
import './PianoVisualizer.scss';
import { useRhythmGame } from './useRhythmGame.js';
import { useGameActivation } from './useGameActivation.js';
import { RhythmOverlay } from './components/RhythmOverlay';
import { getGameEntry } from './gameRegistry.js';
import { usePianoConfig } from './usePianoConfig.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { useSessionTracking } from './useSessionTracking.js';

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function PianoVisualizer({ onClose, onSessionEnd, initialGame = null }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const { gamesConfig } = usePianoConfig();

  const activation = useGameActivation(activeNotes, gamesConfig, initialGame);
  const activeGameEntry = activation.activeGameId ? getGameEntry(activation.activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';

  // Rhythm game — only active when rhythm is the selected game
  const rhythmConfig = activation.activeGameId === 'rhythm' ? gamesConfig?.rhythm : null;
  const game = useRhythmGame(activeNotes, noteHistory, rhythmConfig);
  const isAnyGame = game.isGameMode || isFullscreenGame;

  // Auto-start rhythm game when activated
  useEffect(() => {
    if (activation.activeGameId === 'rhythm' && game.gameState === 'IDLE' && rhythmConfig) {
      game.startGame();
    }
  }, [activation.activeGameId, rhythmConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const { inactivityState, countdownProgress } = useInactivityTimer(activeNotes, noteHistory, isAnyGame, onClose);
  const { sessionDuration } = useSessionTracking(noteHistory);

  const [screenFlash, setScreenFlash] = useState(false);

  // Keyboard range
  const gameRange = game.isGameMode && game.currentLevel?.range;
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(gameRange || null),
    [gameRange]
  );

  // Target notes for keyboard highlighting
  const targetNotes = useMemo(() => {
    if (!game.isGameMode) return null;
    const pitches = new Set();
    for (const fn of game.fallingNotes) {
      if (fn.state === 'falling') {
        for (const p of fn.pitches) pitches.add(p);
      }
    }
    return pitches;
  }, [game.isGameMode, game.fallingNotes]);

  const keyboardHeight = game.isGameMode ? '40%' : '25%';

  // Screen flash on wrong press
  useEffect(() => {
    if (game.wrongNotes.size > 0) {
      setScreenFlash(true);
      const timer = setTimeout(() => setScreenFlash(false), 200);
      return () => clearTimeout(timer);
    }
    setScreenFlash(false);
  }, [game.wrongNotes]);

  // Handle session end
  useEffect(() => {
    if (sessionInfo?.event === 'session_end' && onSessionEnd) {
      const timer = setTimeout(() => onSessionEnd(sessionInfo), 2000);
      return () => clearTimeout(timer);
    }
  }, [sessionInfo, onSessionEnd]);

  return (
    <div className={`piano-visualizer${game.isGameMode ? ' game-mode' : ''}${isFullscreenGame ? ' tetris-mode' : ''}`}>
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
                  <div className="timer-bar" style={{ width: `${countdownProgress}%` }} />
                </div>
              )}
            </div>
            <div className="header-center">
              <CurrentChordStaff activeNotes={activeNotes} />
            </div>
          </>
        )}
      </div>

      <div className="waterfall-container">
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          gameMode={game.isGameMode ? game : null}
          wrongColumns={game.isGameMode ? game.wrongNotes : null}
        />

        {game.isGameMode && game.gameState === 'PLAYING' && (
          <div className="life-meter" aria-hidden="true">
            <div className="life-meter__frame">
              {Array.from({ length: game.totalHealth }, (_, i) => (
                <div
                  key={i}
                  className={`life-meter__notch${i < Math.ceil(game.health) ? ' life-meter__notch--active' : ''}${
                    i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 ? ' life-meter__notch--danger' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="keyboard-container" style={{ height: keyboardHeight }}>
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={targetNotes}
          wrongNotes={game.wrongNotes}
        />
      </div>

      {game.isGameMode && (
        <RhythmOverlay
          gameState={game.gameState}
          countdown={game.countdown}
          score={game.score}
          currentLevel={game.currentLevel}
          levelProgress={game.levelProgress}
        />
      )}

      {sessionInfo?.event === 'session_end' && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}

      {screenFlash && <div className="wrong-flash" />}

      {isFullscreenGame && activeGameEntry?.LazyComponent && (
        <div className="tetris-fullscreen">
          <Suspense fallback={null}>
            <activeGameEntry.LazyComponent
              activeNotes={activeNotes}
              gameConfig={gamesConfig?.[activation.activeGameId]}
              onDeactivate={activation.deactivate}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
```

**Step 5: Run tests**

```bash
cd frontend && npx vitest run src/modules/Piano/
```

Expected: All pass.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/usePianoConfig.js frontend/src/modules/Piano/useInactivityTimer.js frontend/src/modules/Piano/useSessionTracking.js frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): decompose PianoVisualizer into focused hooks (V7)

Extracted usePianoConfig (device/app config + HA scripts),
useInactivityTimer (grace period + countdown),
useSessionTracking (duration tracking).
PianoVisualizer is now ~160 lines of layout composition."
```

---

## Task 13: Update Reference Documentation

**Files:**
- Modify: `docs/reference/piano/piano-games.md`

**Why:** The refactoring changed file names, shared utilities, config structure, and component architecture. Reference docs must stay current.

**Step 1: Update file references**

Update all references to renamed files:
- `gameEngine.js` → `rhythmEngine.js`
- `GameOverlay.jsx` → `RhythmOverlay.jsx`
- `useGameMode.js` → `useRhythmGame.js`

Update the shared utilities section to document new exports:
- `shuffle(arr)`, `buildNotePool(noteRange, whiteKeysOnly)`, `computeKeyboardRange(noteRange)`

Update the config section to reflect the consolidated `games.rhythm` structure (no more top-level `game` section).

Document new hooks: `usePianoConfig`, `useInactivityTimer`, `useSessionTracking`, `useAutoGameLifecycle`.

**Step 2: Commit**

```bash
git add docs/reference/piano/piano-games.md
git commit -m "docs(piano): update reference docs for architecture refactor"
```

---

## Summary

| Task | Violations | Effort | Key Changes |
|------|-----------|--------|-------------|
| 1 | V4 | 5 min | PianoKeyboard imports from noteUtils |
| 2 | V14 | 3 min | useMemo → useRef |
| 3 | V5, V6 | 15 min | Extract shuffle + buildNotePool |
| 4 | V3 | 15 min | Extract computeKeyboardRange |
| 5 | V10 | 5 min | Structured logging in PianoVisualizer |
| 6 | V11 | 10 min | Structured logging in useFlashcardGame |
| 7 | V9 | 10 min | Extract useAutoGameLifecycle |
| 8 | V8 | 10 min | Rename rhythm game files |
| 9 | V13 | 5 min | Standardize config prop names |
| 10 | V2 | 20 min | Consolidate rhythm activation + config |
| 11 | V1, V12 | 15 min | Registry rendering + health meter |
| 12 | V7 | 25 min | Decompose PianoVisualizer |
| 13 | — | 10 min | Update reference docs |

**Total: 13 tasks, ~150 minutes estimated**

All violations from the audit are addressed. Each task is independently committable and includes test verification.
