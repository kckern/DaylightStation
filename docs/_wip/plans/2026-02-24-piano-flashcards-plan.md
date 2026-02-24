# Piano Flashcards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an untimed flashcard game that trains note-reading on a MIDI keyboard, with progressive difficulty mirroring Piano Tetris levels (single → dyad → triad, white → chromatic → wide range).

**Architecture:** New `PianoFlashcards/` directory under `Piano/` with its own game hook and engine, following the same pattern as `PianoTetris/` (pure engine + React hook + layout component). Reuses `ActionStaff` (moved to shared `Piano/components/`) and `PianoKeyboard`. Integrates via the existing `gameRegistry` + `useGameActivation` system.

**Tech Stack:** React 18, Vitest, SCSS, MIDI Web API (via existing `useMidiSubscription`)

**Design doc:** `docs/_wip/plans/2026-02-24-piano-flashcards-design.md`

---

### Task 1: Move ActionStaff to shared Piano/components/

Both Tetris and Flashcards use ActionStaff. Move it from the Tetris subdirectory to the shared components level.

**Files:**
- Move: `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.jsx` → `frontend/src/modules/Piano/components/ActionStaff.jsx`
- Move: `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.scss` → `frontend/src/modules/Piano/components/ActionStaff.scss`
- Modify: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx:6` (update import path)
- Modify: `frontend/src/modules/Piano/components/ActionStaff.jsx:144` (make icon conditional)
- Modify: `frontend/src/modules/Piano/components/ActionStaff.jsx:174` (render all notes, not just first)

**Step 1: Move ActionStaff files**

```bash
git mv frontend/src/modules/Piano/PianoTetris/components/ActionStaff.jsx frontend/src/modules/Piano/components/ActionStaff.jsx
git mv frontend/src/modules/Piano/PianoTetris/components/ActionStaff.scss frontend/src/modules/Piano/components/ActionStaff.scss
```

**Step 2: Update import in PianoTetris.jsx**

In `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`, line 6, change:

```jsx
// OLD
import { ActionStaff } from './components/ActionStaff.jsx';
// NEW
import { ActionStaff } from '../components/ActionStaff.jsx';
```

**Step 3: Update import path in ActionStaff.jsx**

In `frontend/src/modules/Piano/components/ActionStaff.jsx`, line 2, change:

```jsx
// OLD
import { getNoteName } from '../../noteUtils.js';
// NEW
import { getNoteName } from '../noteUtils.js';
```

**Step 4: Make icon area conditional**

In `frontend/src/modules/Piano/components/ActionStaff.jsx`, lines 144-149, change:

```jsx
// OLD
      <div className="action-staff__icon">
        {ACTION_ICONS[action]}
        {action === 'hold' && heldPiece && (
          <span className="action-staff__held-type">{heldPiece}</span>
        )}
      </div>
// NEW
      {action && (
        <div className="action-staff__icon">
          {ACTION_ICONS[action]}
          {action === 'hold' && heldPiece && (
            <span className="action-staff__held-type">{heldPiece}</span>
          )}
        </div>
      )}
```

**Step 5: Render all notes instead of only first**

In `frontend/src/modules/Piano/components/ActionStaff.jsx`, line 174, change:

```jsx
// OLD
        {notePositions.slice(0, 1).map((np) => {
// NEW
        {notePositions.map((np) => {
```

**Step 6: Run existing Tetris staff matching tests to verify no breakage**

```bash
npx vitest run frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js
```

Expected: All tests pass (these test pure functions, not the component, but confirm imports still resolve).

**Step 7: Commit**

```bash
git add frontend/src/modules/Piano/components/ActionStaff.jsx \
       frontend/src/modules/Piano/components/ActionStaff.scss \
       frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx
git commit -m "refactor: move ActionStaff to shared Piano/components, render all notes"
```

---

### Task 2: Create flashcardEngine.js with pure functions (TDD)

Pure functions for card generation and chord match evaluation. No React dependencies.

**Files:**
- Create: `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`
- Create: `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js`

**Step 1: Write failing tests**

Create `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js`:

```js
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
    // Range [60, 61] only has 2 notes — can't make a triad
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
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js
```

Expected: FAIL — `flashcardEngine.js` doesn't exist yet.

**Step 3: Implement flashcardEngine.js**

Create `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`:

```js
import { isWhiteKey } from '../noteUtils.js';

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate random pitches for a flashcard.
 *
 * @param {[number, number]} noteRange - [low, high] inclusive MIDI range
 * @param {'single'|'dyad'|'triad'} complexity
 * @param {boolean} whiteKeysOnly
 * @returns {number[]} array of MIDI pitches
 */
export function generateCardPitches(noteRange, complexity = 'single', whiteKeysOnly = false) {
  const counts = { single: 1, dyad: 2, triad: 3 };
  let count = counts[complexity] || 1;

  const [low, high] = noteRange;
  const available = [];
  for (let n = low; n <= high; n++) {
    if (whiteKeysOnly && !isWhiteKey(n)) continue;
    available.push(n);
  }
  shuffle(available);

  // Clamp count to available notes
  count = Math.min(count, available.length);

  return available.slice(0, count);
}

/**
 * Evaluate a chord match attempt.
 *
 * @param {Map<number, object>|null} activeNotes - currently held MIDI notes
 * @param {number[]|null} targetPitches - pitches the player must press
 * @returns {'idle'|'correct'|'wrong'|'partial'}
 *   - idle:    no notes pressed (or null inputs)
 *   - correct: all target pitches are held
 *   - partial: some target pitches held, no wrong notes (player rolling a chord)
 *   - wrong:   at least one non-target note pressed without completing the chord
 */
export function evaluateMatch(activeNotes, targetPitches) {
  if (!activeNotes || activeNotes.size === 0 || !targetPitches?.length) {
    return 'idle';
  }

  const targetSet = new Set(targetPitches);
  let correctCount = 0;
  let hasWrong = false;

  for (const [note] of activeNotes) {
    if (targetSet.has(note)) correctCount++;
    else hasWrong = true;
  }

  // All targets held — match regardless of extra notes
  if (correctCount === targetPitches.length) {
    return 'correct';
  }

  // Wrong note pressed without completing the chord
  if (hasWrong) {
    return 'wrong';
  }

  // Some correct notes held, no wrong notes — player is rolling the chord
  if (correctCount > 0) {
    return 'partial';
  }

  return 'idle';
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js \
       frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js
git commit -m "feat(piano): add flashcard engine with card generation and match evaluation"
```

---

### Task 3: Add flashcards config to piano.yml

**Files:**
- Modify: `data/household/config/piano.yml` (append after tetris section, line 176)

**Step 1: Add flashcards config**

Append to `data/household/config/piano.yml` after the tetris section (after line 176):

```yaml

  flashcards:
    activation:
      notes: [33, 105]      # A1 + A7
      window_ms: 300
    chord_window_ms: 300
    score_per_card: 10
    levels:
      # --- Singles: learn to read notes ---
      - name: "White Keys"
        complexity: single
        note_range: [60, 72]      # C4–C5
        white_keys_only: true
        score_to_advance: 100
      - name: "All Keys"
        complexity: single
        note_range: [60, 72]      # C4–C5
        score_to_advance: 120
      - name: "Wide Range"
        complexity: single
        note_range: [48, 84]      # C3–C6
        score_to_advance: 140
      # --- Dyads: two-note chords ---
      - name: "White Dyads"
        complexity: dyad
        note_range: [60, 72]      # C4–C5
        white_keys_only: true
        score_to_advance: 160
      - name: "All Dyads"
        complexity: dyad
        note_range: [60, 72]      # C4–C5
        score_to_advance: 180
      - name: "Wide Dyads"
        complexity: dyad
        note_range: [48, 84]      # C3–C6
        score_to_advance: 200
      # --- Triads: three-note chords ---
      - name: "White Triads"
        complexity: triad
        note_range: [60, 72]      # C4–C5
        white_keys_only: true
        score_to_advance: 220
      - name: "All Triads"
        complexity: triad
        note_range: [60, 72]      # C4–C5
        score_to_advance: 240
      - name: "Wide Triads"
        complexity: triad
        note_range: [48, 84]      # C3–C6
        score_to_advance: 260
```

**Step 2: Commit**

```bash
git add data/household/config/piano.yml
git commit -m "feat(piano): add flashcards game config with 9 progressive levels"
```

---

### Task 4: Add flashcards to game registry

**Files:**
- Modify: `frontend/src/modules/Piano/gameRegistry.js:9-20`

**Step 1: Add flashcards entry**

In `frontend/src/modules/Piano/gameRegistry.js`, add after the tetris entry (after line 19):

```js
// OLD (line 18-20)
    layout: 'replace',
  },
};
// NEW
    layout: 'replace',
  },
  flashcards: {
    component: () => import('./PianoFlashcards/PianoFlashcards'),
    hook: () => import('./PianoFlashcards/useFlashcardGame'),
    layout: 'replace',
  },
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/gameRegistry.js
git commit -m "feat(piano): register flashcards game in game registry"
```

---

### Task 5: Create useFlashcardGame hook

The game state machine hook. Manages phase, score, level, card lifecycle, and chord matching.

**Files:**
- Create: `frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js`

**Step 1: Create the hook**

Create `frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js`:

```js
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { generateCardPitches, evaluateMatch } from './flashcardEngine.js';

const CARD_ADVANCE_DELAY_MS = 400;
const COMPLETE_DISPLAY_MS = 5000;

function createInitialState() {
  return {
    phase: 'IDLE',       // IDLE | PLAYING | COMPLETE
    level: 0,
    score: 0,
    currentCard: null,   // { pitches: number[] }
    cardStatus: null,    // null | 'hit' | 'miss'
    cardFailed: false,   // true if missed on current card (no points even if corrected)
    attempts: [],        // [{ hit: boolean }] rolling history
  };
}

/**
 * Flashcard game state machine.
 *
 * @param {Map} activeNotes - from useMidiSubscription
 * @param {Object} flashcardsConfig - games.flashcards from piano.yml
 * @returns game state + controls
 */
export function useFlashcardGame(activeNotes, flashcardsConfig) {
  const [state, setState] = useState(createInitialState);
  const advanceTimerRef = useRef(null);
  const completeTimerRef = useRef(null);

  const levels = flashcardsConfig?.levels ?? [];
  const levelConfig = levels[state.level] ?? null;
  const scorePerCard = flashcardsConfig?.score_per_card ?? 10;
  const scoreNeeded = levelConfig?.score_to_advance ?? 100;

  // ─── Generate a new card ──────────────────────────────────────
  const nextCard = useCallback(() => {
    if (!levelConfig) return;
    const pitches = generateCardPitches(
      levelConfig.note_range,
      levelConfig.complexity,
      levelConfig.white_keys_only,
    );
    setState(prev => ({
      ...prev,
      currentCard: { pitches },
      cardStatus: null,
      cardFailed: false,
    }));
  }, [levelConfig]);

  // ─── Chord match evaluation ───────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'PLAYING' || !state.currentCard) return;
    if (state.cardStatus === 'hit') return; // already matched, waiting for advance

    const result = evaluateMatch(activeNotes, state.currentCard.pitches);

    if (result === 'correct' && !state.cardFailed) {
      // First-try correct — award points
      setState(prev => ({
        ...prev,
        cardStatus: 'hit',
        score: prev.score + scorePerCard,
        attempts: [...prev.attempts, { hit: true }],
      }));
    } else if (result === 'correct' && state.cardFailed) {
      // Correct after a miss — no points, but advance
      setState(prev => ({
        ...prev,
        cardStatus: 'hit',
        attempts: [...prev.attempts, { hit: false }],
      }));
    } else if (result === 'wrong') {
      setState(prev => ({
        ...prev,
        cardStatus: 'miss',
        cardFailed: true,
      }));
    }
    // 'partial' and 'idle' — no state change, player is still working
  }, [activeNotes, state.phase, state.currentCard, state.cardFailed, state.cardStatus, scorePerCard]);

  // ─── Clear miss status when all notes released ────────────────
  useEffect(() => {
    if (state.cardStatus !== 'miss') return;
    if (!activeNotes || activeNotes.size === 0) {
      setState(prev => ({ ...prev, cardStatus: null }));
    }
  }, [activeNotes, state.cardStatus]);

  // ─── Advance to next card after hit ───────────────────────────
  useEffect(() => {
    if (state.cardStatus !== 'hit') return;

    advanceTimerRef.current = setTimeout(() => {
      setState(prev => {
        const newScore = prev.score;
        const threshold = levels[prev.level]?.score_to_advance ?? 100;

        // Level up?
        if (newScore >= threshold) {
          const nextLevel = prev.level + 1;
          if (nextLevel >= levels.length) {
            // All levels complete
            return { ...prev, phase: 'COMPLETE', currentCard: null, cardStatus: null };
          }
          return { ...prev, level: nextLevel, score: 0, currentCard: null, cardStatus: null };
        }

        return { ...prev, currentCard: null, cardStatus: null };
      });
    }, CARD_ADVANCE_DELAY_MS);

    return () => clearTimeout(advanceTimerRef.current);
  }, [state.cardStatus, levels]);

  // ─── Generate card when currentCard is null during PLAYING ────
  useEffect(() => {
    if (state.phase === 'PLAYING' && !state.currentCard) {
      nextCard();
    }
  }, [state.phase, state.currentCard, nextCard]);

  // ─── Auto-dismiss COMPLETE after delay ────────────────────────
  useEffect(() => {
    if (state.phase !== 'COMPLETE') return;

    completeTimerRef.current = setTimeout(() => {
      setState(createInitialState());
    }, COMPLETE_DISPLAY_MS);

    return () => clearTimeout(completeTimerRef.current);
  }, [state.phase]);

  // ─── Controls ─────────────────────────────────────────────────
  const startGame = useCallback(() => {
    setState({ ...createInitialState(), phase: 'PLAYING' });
  }, []);

  const deactivate = useCallback(() => {
    clearTimeout(advanceTimerRef.current);
    clearTimeout(completeTimerRef.current);
    setState(createInitialState());
  }, []);

  // ─── Derived values ───────────────────────────────────────────
  const accuracy = useMemo(() => {
    const recent = state.attempts.slice(-20);
    if (recent.length === 0) return 0;
    return Math.round((recent.filter(a => a.hit).length / recent.length) * 100);
  }, [state.attempts]);

  return {
    phase: state.phase,
    level: state.level,
    score: state.score,
    scoreNeeded,
    levelConfig,
    currentCard: state.currentCard,
    cardStatus: state.cardStatus,
    attempts: state.attempts,
    accuracy,
    startGame,
    deactivate,
  };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js
git commit -m "feat(piano): add useFlashcardGame state machine hook"
```

---

### Task 6: Create AttemptHistory component

Small component showing recent attempts as colored dots + accuracy percentage.

**Files:**
- Create: `frontend/src/modules/Piano/PianoFlashcards/components/AttemptHistory.jsx`

**Step 1: Create the component**

Create `frontend/src/modules/Piano/PianoFlashcards/components/AttemptHistory.jsx`:

```jsx
import { useMemo } from 'react';

const WINDOW = 20;

/**
 * Shows recent attempt results as colored dots and rolling accuracy.
 *
 * @param {{ attempts: { hit: boolean }[], accuracy: number }} props
 */
export function AttemptHistory({ attempts = [], accuracy = 0 }) {
  const recent = useMemo(() => attempts.slice(-WINDOW), [attempts]);

  if (recent.length === 0) return null;

  return (
    <div className="attempt-history">
      <div className="attempt-history__dots">
        {recent.map((a, i) => (
          <div
            key={i}
            className={`attempt-history__dot ${a.hit ? 'attempt-history__dot--hit' : 'attempt-history__dot--miss'}`}
          />
        ))}
      </div>
      <div className="attempt-history__accuracy">{accuracy}%</div>
      <div className="attempt-history__label">accuracy</div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoFlashcards/components/AttemptHistory.jsx
git commit -m "feat(piano): add AttemptHistory component for flashcard stats"
```

---

### Task 7: Create PianoFlashcards layout + styles

Main layout component: three-column (stats | card | history) + keyboard.

**Files:**
- Create: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`
- Create: `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.scss`

**Step 1: Create PianoFlashcards.jsx**

Create `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`:

```jsx
import { useMemo, useEffect } from 'react';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useFlashcardGame } from './useFlashcardGame.js';
import { AttemptHistory } from './components/AttemptHistory.jsx';
import './PianoFlashcards.scss';

/**
 * Piano Flashcards — untimed note-reading trainer.
 *
 * @param {Object} props
 * @param {Map} props.activeNotes - live MIDI note state
 * @param {Object} props.flashcardsConfig - games.flashcards from piano.yml
 * @param {function} props.onDeactivate - called to exit the game
 */
export function PianoFlashcards({ activeNotes, flashcardsConfig, onDeactivate }) {
  const game = useFlashcardGame(activeNotes, flashcardsConfig);

  // Auto-start on mount
  useEffect(() => {
    if (game.phase === 'IDLE') game.startGame();
  }, []);

  // Auto-deactivate when game returns to IDLE after COMPLETE
  const phaseRef = useMemo(() => ({ prev: game.phase }), []);
  useEffect(() => {
    if (phaseRef.prev === 'COMPLETE' && game.phase === 'IDLE') {
      onDeactivate?.();
    }
    phaseRef.prev = game.phase;
  }, [game.phase, onDeactivate]);

  // Keyboard range from current level config
  const { startNote, endNote } = useMemo(() => {
    const range = game.levelConfig?.note_range;
    if (!range) return { startNote: 48, endNote: 84 };
    const span = range[1] - range[0];
    const pad = Math.max(Math.round(span / 3), 6);
    const rawStart = range[0] - pad;
    const rawEnd = range[1] + pad;
    // Ensure at least 2 octaves
    const minSpan = 24;
    const actualSpan = rawEnd - rawStart;
    if (actualSpan < minSpan) {
      const extra = Math.ceil((minSpan - actualSpan) / 2);
      return { startNote: Math.max(21, rawStart - extra), endNote: Math.min(108, rawEnd + extra) };
    }
    return { startNote: Math.max(21, rawStart), endNote: Math.min(108, rawEnd) };
  }, [game.levelConfig]);

  // Target pitches for keyboard highlighting
  const targetNotes = useMemo(() => {
    if (!game.currentCard?.pitches) return null;
    return new Set(game.currentCard.pitches);
  }, [game.currentCard]);

  // Wrong notes for keyboard flash
  const wrongNotes = useMemo(() => {
    if (game.cardStatus !== 'miss' || !activeNotes || !game.currentCard) return null;
    const targetSet = new Set(game.currentCard.pitches);
    const wrong = new Set();
    for (const [note] of activeNotes) {
      if (!targetSet.has(note)) wrong.add(note);
    }
    return wrong.size > 0 ? wrong : null;
  }, [game.cardStatus, activeNotes, game.currentCard]);

  // Level label
  const levelLabel = game.levelConfig?.name ?? `Level ${game.level}`;

  // Progress percentage
  const progressPct = game.scoreNeeded > 0
    ? Math.min(100, (game.score / game.scoreNeeded) * 100)
    : 0;

  return (
    <div className="piano-flashcards">
      <div className="piano-flashcards__play-area">
        {/* Left column: level info + score */}
        <div className="piano-flashcards__stats-left">
          <div className="piano-flashcards__level">
            <div className="piano-flashcards__level-num">Level {game.level + 1}</div>
            <div className="piano-flashcards__level-name">{levelLabel}</div>
          </div>
          <div className="piano-flashcards__score-block">
            <div className="piano-flashcards__score-value">{game.score}</div>
            <div className="piano-flashcards__score-label">/ {game.scoreNeeded}</div>
          </div>
          <div className="piano-flashcards__progress">
            <div
              className="piano-flashcards__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Center: flashcard */}
        <div className="piano-flashcards__card-area">
          {game.currentCard && (
            <div className={[
              'piano-flashcards__card',
              game.cardStatus === 'hit' && 'piano-flashcards__card--hit',
              game.cardStatus === 'miss' && 'piano-flashcards__card--miss',
            ].filter(Boolean).join(' ')}>
              <ActionStaff
                targetPitches={game.currentCard.pitches}
                matched={game.cardStatus === 'hit'}
                activeNotes={activeNotes}
              />
            </div>
          )}

          {game.phase === 'COMPLETE' && (
            <div className="piano-flashcards__complete">
              <div className="piano-flashcards__complete-title">Training Complete!</div>
              <div className="piano-flashcards__complete-stat">{game.accuracy}% accuracy</div>
            </div>
          )}
        </div>

        {/* Right column: attempt history */}
        <div className="piano-flashcards__stats-right">
          <AttemptHistory attempts={game.attempts} accuracy={game.accuracy} />
        </div>
      </div>

      <div className="piano-flashcards__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={targetNotes}
          wrongNotes={wrongNotes}
        />
      </div>
    </div>
  );
}

export default PianoFlashcards;
```

**Step 2: Create PianoFlashcards.scss**

Create `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.scss`:

```scss
.piano-flashcards {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a2e;
  color: #fff;

  &__play-area {
    flex: 1;
    display: flex;
    gap: 1.5rem;
    padding: 1.5rem;
    min-height: 0;
  }

  &__stats-left,
  &__stats-right {
    width: 160px;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1rem;
  }

  // ─── Left column ───────────────────────────────────
  &__level {
    text-align: center;
  }

  &__level-num {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.5);
  }

  &__level-name {
    font-size: 1.1rem;
    font-weight: 700;
    color: #00ffc8;
  }

  &__score-block {
    text-align: center;
  }

  &__score-value {
    font-size: 2.5rem;
    font-weight: 800;
    line-height: 1;
    color: #fff;
  }

  &__score-label {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.4);
  }

  &__progress {
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  &__progress-fill {
    height: 100%;
    background: #00ffc8;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  // ─── Center: card ──────────────────────────────────
  &__card-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  &__card {
    width: 100%;
    max-width: 360px;
    aspect-ratio: 3 / 2;
    border-radius: 12px;
    overflow: hidden;

    .action-staff {
      width: 100%;
      height: 100%;
    }

    &--hit {
      animation: fc-flash-green 0.35s ease-out;
    }

    &--miss {
      animation: fc-shake 0.3s ease-out;
    }
  }

  // ─── Completion overlay ────────────────────────────
  &__complete {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 12px;
  }

  &__complete-title {
    font-size: 2rem;
    font-weight: 800;
    color: #00ffc8;
  }

  &__complete-stat {
    font-size: 1.2rem;
    color: rgba(255, 255, 255, 0.7);
    margin-top: 0.5rem;
  }

  // ─── Keyboard ──────────────────────────────────────
  &__keyboard {
    height: 18%;
    min-height: 80px;
  }
}

// ─── Attempt history ───────────────────────────────
.attempt-history {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;

  &__dots {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: center;
    max-width: 120px;
  }

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;

    &--hit {
      background: #00ffc8;
    }

    &--miss {
      background: #ff4444;
    }
  }

  &__accuracy {
    font-size: 1.8rem;
    font-weight: 800;
    color: #fff;
  }

  &__label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.4);
  }
}

// ─── Animations ──────────────────────────────────────
@keyframes fc-flash-green {
  0% { box-shadow: 0 0 0 0 rgba(0, 255, 200, 0.6); }
  50% { box-shadow: 0 0 40px 15px rgba(0, 255, 200, 0.3); }
  100% { box-shadow: 0 0 0 0 rgba(0, 255, 200, 0); }
}

@keyframes fc-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx \
       frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.scss
git commit -m "feat(piano): add PianoFlashcards layout component with styles"
```

---

### Task 8: Integrate into PianoVisualizer

Replace the hardcoded Tetris check with registry-aware logic. Add the flashcards rendering path.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx:13,52-53,234,354-362`

**Step 1: Add flashcards import and generalize game detection**

In `frontend/src/modules/Piano/PianoVisualizer.jsx`:

Add import after line 13:

```jsx
// OLD (line 13)
import { PianoTetris } from './PianoTetris/PianoTetris.jsx';
// NEW
import { PianoTetris } from './PianoTetris/PianoTetris.jsx';
import { PianoFlashcards } from './PianoFlashcards/PianoFlashcards.jsx';
import { getGameEntry } from './gameRegistry.js';
```

**Step 2: Replace hardcoded isTetrisGame with registry-driven check**

In `frontend/src/modules/Piano/PianoVisualizer.jsx`, lines 52-53:

```jsx
// OLD
  const isTetrisGame = activation.activeGameId === 'tetris';
  const isAnyGame = game.isGameMode || isTetrisGame;
// NEW
  const activeGameEntry = activation.activeGameId ? getGameEntry(activation.activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';
  const isAnyGame = game.isGameMode || isFullscreenGame;
```

**Step 3: Update className to use generic fullscreen class**

In `frontend/src/modules/Piano/PianoVisualizer.jsx`, line 234:

```jsx
// OLD
    <div className={`piano-visualizer${game.isGameMode ? ' game-mode' : ''}${isTetrisGame ? ' tetris-mode' : ''}`}>
// NEW
    <div className={`piano-visualizer${game.isGameMode ? ' game-mode' : ''}${isFullscreenGame ? ' tetris-mode' : ''}`}>
```

**Step 4: Replace hardcoded Tetris render with multi-game block**

In `frontend/src/modules/Piano/PianoVisualizer.jsx`, lines 354-362:

```jsx
// OLD
      {isTetrisGame && (
        <div className="tetris-fullscreen">
          <PianoTetris
            activeNotes={activeNotes}
            tetrisConfig={gamesConfig?.tetris}
            onDeactivate={activation.deactivate}
          />
        </div>
      )}
// NEW
      {isFullscreenGame && (
        <div className="tetris-fullscreen">
          {activation.activeGameId === 'tetris' && (
            <PianoTetris
              activeNotes={activeNotes}
              tetrisConfig={gamesConfig?.tetris}
              onDeactivate={activation.deactivate}
            />
          )}
          {activation.activeGameId === 'flashcards' && (
            <PianoFlashcards
              activeNotes={activeNotes}
              flashcardsConfig={gamesConfig?.flashcards}
              onDeactivate={activation.deactivate}
            />
          )}
        </div>
      )}
```

**Step 5: Run existing tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js
npx vitest run frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js
npx vitest run frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js
```

Expected: All pass.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "feat(piano): integrate flashcards game into PianoVisualizer"
```

---

### Task 9: Update reference docs

**Files:**
- Modify: `docs/reference/piano/piano-games.md`

**Step 1: Add Piano Flashcards section**

In `docs/reference/piano/piano-games.md`, add a new section after the Piano Tetris section (before `## Shared Utilities`):

```markdown
---

## Piano Flashcards

Untimed note-reading trainer. Shows notes on a staff; player presses the matching MIDI key(s). Progressive difficulty mirrors the Tetris level structure.

### Component Tree

```
PianoFlashcards
├── ActionStaff           (shared — large centered card showing target note(s))
├── AttemptHistory         (green/red dots + accuracy %)
└── PianoKeyboard          (visual keyboard with highlighted targets)
```

### File Inventory

| File | Purpose |
|------|---------|
| `PianoFlashcards/PianoFlashcards.jsx` | Main layout: 3-column (stats │ card │ history) + keyboard |
| `PianoFlashcards/PianoFlashcards.scss` | Layout styles and animations |
| `PianoFlashcards/useFlashcardGame.js` | Game state machine: phase, score, level, card lifecycle |
| `PianoFlashcards/flashcardEngine.js` | Pure functions: card generation, match evaluation |
| `PianoFlashcards/flashcardEngine.test.js` | Vitest tests for engine functions |
| `PianoFlashcards/components/AttemptHistory.jsx` | Rolling attempt dots + accuracy display |

### Game State Machine

```
IDLE ──[startGame()]──▶ PLAYING ──[level 8 threshold]──▶ COMPLETE
 ▲                                                           │
 └──────────────────────[5s display]─────────────────────────┘
```

### Match Evaluation

| Result | Condition | Effect |
|--------|-----------|--------|
| `correct` | All target pitches held | Score +10, next card after 400ms |
| `wrong` | Non-target note pressed (chord incomplete) | Red flash, card stays, marked as failed |
| `partial` | Some targets held, no wrong notes | No feedback — player is rolling a chord |
| `idle` | No notes pressed | No feedback |

Chord tolerance: players can roll chords (press notes sequentially while holding). As long as only target notes are pressed, the match stays `partial` until all notes are held.

### 9 Difficulty Levels

| Level | Complexity | Range | Keys | Score to advance |
|-------|-----------|-------|------|-----------------|
| 0 | Single | C4-C5 | White | 100 |
| 1 | Single | C4-C5 | Chromatic | 120 |
| 2 | Single | C3-C6 | Chromatic | 140 |
| 3 | Dyad | C4-C5 | White | 160 |
| 4 | Dyad | C4-C5 | Chromatic | 180 |
| 5 | Dyad | C3-C6 | Chromatic | 200 |
| 6 | Triad | C4-C5 | White | 220 |
| 7 | Triad | C4-C5 | Chromatic | 240 |
| 8 | Triad | C3-C6 | Chromatic | 260 |

Each complexity tier ramps: white narrow → chromatic narrow → chromatic wide.
```

Add `flashcards` to the activation table under `## Game Activation`:

```markdown
| Mechanism | Details |
|-----------|---------
| ...existing rows... |
```

Add to the `piano.yml` config example to show the flashcards entry.

**Step 2: Commit**

```bash
git add docs/reference/piano/piano-games.md
git commit -m "docs: add Piano Flashcards reference documentation"
```

---

## Summary of All Files

### New files (7)
- `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`
- `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.test.js`
- `frontend/src/modules/Piano/PianoFlashcards/useFlashcardGame.js`
- `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx`
- `frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.scss`
- `frontend/src/modules/Piano/PianoFlashcards/components/AttemptHistory.jsx`

### Moved files (2)
- `PianoTetris/components/ActionStaff.jsx` → `Piano/components/ActionStaff.jsx`
- `PianoTetris/components/ActionStaff.scss` → `Piano/components/ActionStaff.scss`

### Modified files (4)
- `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx` (import path)
- `frontend/src/modules/Piano/gameRegistry.js` (add entry)
- `frontend/src/modules/Piano/PianoVisualizer.jsx` (generalize + add flashcards)
- `data/household/config/piano.yml` (add flashcards config)

### Updated docs (1)
- `docs/reference/piano/piano-games.md`
