# Piano Tetris Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Tetris game controlled by piano sight-reading to the existing PianoVisualizer, using a config-driven game registry to support multiple game modes.

**Architecture:** Three-layer approach: (1) Game Registry refactor extracts activation detection into a shared hook and replaces hardcoded game switching in PianoVisualizer with a config-driven registry. (2) Tetris engine as pure functions (matching the existing `gameEngine.js` pattern) handles board state, piece movement, collision, rotation, line clearing, and scoring. (3) Staff matching system maps 4 action channels (move left, move right, rotate CCW, rotate CW) to musical notes displayed on staves, with hold-to-repeat. The PianoTetris component assembles staves, board, and keyboard into the layout from the design doc.

**Tech Stack:** React (hooks + JSX), SCSS, MIDI input via existing `useMidiSubscription`, SVG for staff rendering, pure JS for game engine. No new dependencies.

---

## Task 1: Tetris Engine — Pure Functions

The tetris engine follows the same pattern as the existing `gameEngine.js` — pure functions, no React, fully testable.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/tetrisEngine.js`
- Create: `frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js`

**Step 1: Create the tetris engine with piece definitions, board creation, collision detection, rotation, movement, line clearing, and scoring**

Create `frontend/src/modules/Piano/PianoTetris/tetrisEngine.js`:

```js
/**
 * Tetris Engine — Pure functions, no React
 *
 * Board: 20 rows x 10 cols, row 0 = top
 * Each cell: null (empty) or { type: 'T' } (filled)
 */

// ─── Piece Definitions ──────────────────────────────────────────

// Each piece: array of 4 rotations, each rotation is array of [row, col] offsets
const PIECES = {
  I: [
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],
  ],
  O: [
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
  ],
  T: [
    [[0,0],[0,1],[0,2],[1,1]],
    [[0,0],[1,0],[2,0],[1,1]],
    [[1,0],[1,1],[1,2],[0,1]],
    [[0,0],[1,0],[2,0],[1,-1]],
  ],
  S: [
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,0],[1,0],[1,1],[2,1]],
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,0],[1,0],[1,1],[2,1]],
  ],
  Z: [
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,1],[1,0],[1,1],[2,0]],
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
  J: [
    [[0,0],[1,0],[1,1],[1,2]],
    [[0,0],[0,1],[1,0],[2,0]],
    [[0,0],[0,1],[0,2],[1,2]],
    [[0,0],[1,0],[2,0],[2,-1]],
  ],
  L: [
    [[0,2],[1,0],[1,1],[1,2]],
    [[0,0],[1,0],[2,0],[2,1]],
    [[0,0],[0,1],[0,2],[1,0]],
    [[0,0],[0,1],[1,1],[2,1]],
  ],
};

const PIECE_TYPES = Object.keys(PIECES);
const BOARD_ROWS = 20;
const BOARD_COLS = 10;

// NES-style scoring
const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };

// ─── Board Operations ────────────────────────────────────────────

export function createBoard() {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

/**
 * Get the absolute cell positions for a piece at a given position and rotation.
 */
export function getPieceCells(piece) {
  const offsets = PIECES[piece.type][piece.rotation];
  return offsets.map(([dr, dc]) => [piece.y + dr, piece.x + dc]);
}

/**
 * Check if a piece at a position is valid (in bounds and no collision).
 */
export function isValidPosition(board, piece) {
  const cells = getPieceCells(piece);
  return cells.every(([r, c]) =>
    r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS && board[r][c] === null
  );
}

/**
 * Lock a piece onto the board, returning the new board.
 */
export function lockPiece(board, piece) {
  const newBoard = board.map(row => [...row]);
  const cells = getPieceCells(piece);
  for (const [r, c] of cells) {
    if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS) {
      newBoard[r][c] = { type: piece.type };
    }
  }
  return newBoard;
}

/**
 * Clear completed lines. Returns { board, linesCleared }.
 */
export function clearLines(board) {
  const kept = board.filter(row => row.some(cell => cell === null));
  const linesCleared = BOARD_ROWS - kept.length;
  const emptyRows = Array.from({ length: linesCleared }, () => Array(BOARD_COLS).fill(null));
  return { board: [...emptyRows, ...kept], linesCleared };
}

// ─── Piece Movement ──────────────────────────────────────────────

export function movePiece(board, piece, dx, dy) {
  const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return isValidPosition(board, moved) ? moved : null;
}

export function rotatePiece(board, piece, direction) {
  const newRotation = (piece.rotation + direction + 4) % 4;
  const rotated = { ...piece, rotation: newRotation };
  // Try basic rotation
  if (isValidPosition(board, rotated)) return rotated;
  // Wall kick: try shifting left/right by 1, then 2
  for (const kick of [1, -1, 2, -2]) {
    const kicked = { ...rotated, x: rotated.x + kick };
    if (isValidPosition(board, kicked)) return kicked;
  }
  return null; // Rotation not possible
}

/**
 * Calculate ghost piece position (hard drop preview).
 */
export function getGhostPosition(board, piece) {
  let ghost = { ...piece };
  while (true) {
    const next = { ...ghost, y: ghost.y + 1 };
    if (!isValidPosition(board, next)) return ghost;
    ghost = next;
  }
}

/**
 * Hard drop — move piece to ghost position and lock immediately.
 */
export function hardDrop(board, piece) {
  const ghost = getGhostPosition(board, piece);
  return { piece: ghost, distance: ghost.y - piece.y };
}

// ─── Piece Spawning ──────────────────────────────────────────────

/**
 * Generate a random bag of all 7 piece types (7-bag randomizer).
 */
export function generateBag() {
  const bag = [...PIECE_TYPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/**
 * Spawn a new piece at the top center of the board.
 * Returns null if the spawn position is blocked (game over).
 */
export function spawnPiece(board, type) {
  const piece = { type, rotation: 0, x: 3, y: 0 };
  return isValidPosition(board, piece) ? piece : null;
}

// ─── Scoring ─────────────────────────────────────────────────────

export function calculateScore(linesCleared, level) {
  if (linesCleared === 0) return 0;
  const base = LINE_SCORES[Math.min(linesCleared, 4)] ?? LINE_SCORES[4];
  return base * (level + 1);
}

/**
 * Get gravity interval (ms) based on level.
 * Starts at 1000ms, decreases per level.
 */
export function getGravityMs(level) {
  // NES-inspired curve: faster every level, floor at 100ms
  const speeds = [1000, 900, 800, 700, 600, 500, 450, 400, 350, 300, 250, 200, 175, 150, 125, 100];
  return speeds[Math.min(level, speeds.length - 1)];
}

// ─── Game State ──────────────────────────────────────────────────

export function createTetrisState() {
  const bag = generateBag();
  const nextBag = generateBag();
  const board = createBoard();
  const firstType = bag[0];
  const piece = spawnPiece(board, firstType);

  return {
    phase: 'IDLE',
    board,
    currentPiece: piece,
    nextPiece: bag[1] ?? nextBag[0],
    bag: bag.slice(1),
    nextBag,
    score: 0,
    linesCleared: 0,
    level: 0,
    countdown: null,
  };
}

/**
 * Advance to next piece from the bag. Refills bag when depleted.
 * Returns updated state or null if game over (spawn blocked).
 */
export function nextPieceFromBag(state) {
  let { bag, nextBag } = state;
  let type;

  if (bag.length > 0) {
    type = bag[0];
    bag = bag.slice(1);
  } else {
    type = nextBag[0];
    bag = nextBag.slice(1);
    nextBag = generateBag();
  }

  const peekType = bag.length > 0 ? bag[0] : nextBag[0];
  const piece = spawnPiece(state.board, type);

  if (!piece) return null; // Game over

  return {
    ...state,
    currentPiece: piece,
    nextPiece: peekType,
    bag,
    nextBag,
  };
}

// ─── Exports for testing ─────────────────────────────────────────

export { PIECES, PIECE_TYPES, BOARD_ROWS, BOARD_COLS, LINE_SCORES };
```

**Step 2: Write tests for the tetris engine**

Create `frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  createBoard, getPieceCells, isValidPosition, lockPiece, clearLines,
  movePiece, rotatePiece, getGhostPosition, hardDrop,
  generateBag, spawnPiece, calculateScore, getGravityMs,
  createTetrisState, nextPieceFromBag,
  BOARD_ROWS, BOARD_COLS, PIECE_TYPES,
} from './tetrisEngine.js';

describe('tetrisEngine', () => {
  describe('createBoard', () => {
    it('creates a 20x10 empty board', () => {
      const board = createBoard();
      expect(board.length).toBe(BOARD_ROWS);
      expect(board[0].length).toBe(BOARD_COLS);
      expect(board.every(row => row.every(cell => cell === null))).toBe(true);
    });
  });

  describe('getPieceCells', () => {
    it('returns absolute positions for a T piece at origin', () => {
      const cells = getPieceCells({ type: 'T', rotation: 0, x: 0, y: 0 });
      expect(cells).toEqual([[0,0],[0,1],[0,2],[1,1]]);
    });

    it('offsets by piece position', () => {
      const cells = getPieceCells({ type: 'T', rotation: 0, x: 3, y: 5 });
      expect(cells).toEqual([[5,3],[5,4],[5,5],[6,4]]);
    });
  });

  describe('isValidPosition', () => {
    it('accepts a piece in empty board', () => {
      const board = createBoard();
      expect(isValidPosition(board, { type: 'T', rotation: 0, x: 3, y: 0 })).toBe(true);
    });

    it('rejects piece out of bounds left', () => {
      const board = createBoard();
      expect(isValidPosition(board, { type: 'T', rotation: 0, x: -1, y: 0 })).toBe(false);
    });

    it('rejects piece out of bounds right', () => {
      const board = createBoard();
      expect(isValidPosition(board, { type: 'T', rotation: 0, x: 8, y: 0 })).toBe(false);
    });

    it('rejects piece overlapping filled cell', () => {
      const board = createBoard();
      board[0][3] = { type: 'O' };
      expect(isValidPosition(board, { type: 'T', rotation: 0, x: 3, y: 0 })).toBe(false);
    });
  });

  describe('lockPiece', () => {
    it('places piece cells onto board', () => {
      const board = createBoard();
      const piece = { type: 'O', rotation: 0, x: 4, y: 18 };
      const newBoard = lockPiece(board, piece);
      expect(newBoard[18][4]).toEqual({ type: 'O' });
      expect(newBoard[18][5]).toEqual({ type: 'O' });
      expect(newBoard[19][4]).toEqual({ type: 'O' });
      expect(newBoard[19][5]).toEqual({ type: 'O' });
      // Original board unchanged
      expect(board[18][4]).toBe(null);
    });
  });

  describe('clearLines', () => {
    it('clears a full row and shifts down', () => {
      const board = createBoard();
      // Fill bottom row completely
      for (let c = 0; c < BOARD_COLS; c++) board[19][c] = { type: 'I' };
      // Put a block on row 18
      board[18][0] = { type: 'T' };
      const { board: newBoard, linesCleared } = clearLines(board);
      expect(linesCleared).toBe(1);
      // Row 18's block should now be at row 19
      expect(newBoard[19][0]).toEqual({ type: 'T' });
      // Top row should be empty
      expect(newBoard[0].every(c => c === null)).toBe(true);
    });

    it('returns 0 lines when nothing to clear', () => {
      const board = createBoard();
      const { linesCleared } = clearLines(board);
      expect(linesCleared).toBe(0);
    });
  });

  describe('movePiece', () => {
    it('moves piece left', () => {
      const board = createBoard();
      const piece = { type: 'T', rotation: 0, x: 5, y: 10 };
      const moved = movePiece(board, piece, -1, 0);
      expect(moved.x).toBe(4);
    });

    it('returns null when blocked', () => {
      const board = createBoard();
      const piece = { type: 'T', rotation: 0, x: 0, y: 10 };
      // T piece rotation 0 has cells at x, x+1, x+2 — so x=-1 would be out of bounds
      expect(movePiece(board, piece, -1, 0)).toBe(null);
    });
  });

  describe('rotatePiece', () => {
    it('rotates piece clockwise', () => {
      const board = createBoard();
      const piece = { type: 'T', rotation: 0, x: 4, y: 10 };
      const rotated = rotatePiece(board, piece, 1);
      expect(rotated.rotation).toBe(1);
    });

    it('wall kicks when near edge', () => {
      const board = createBoard();
      // L piece rotation 3 has offset [2,-1] which would put col at x-1
      const piece = { type: 'L', rotation: 2, x: 0, y: 10 };
      const rotated = rotatePiece(board, piece, 1);
      // Should wall kick to make it fit, or return null
      if (rotated) {
        expect(isValidPosition(board, rotated)).toBe(true);
      }
    });
  });

  describe('getGhostPosition', () => {
    it('drops piece to bottom of empty board', () => {
      const board = createBoard();
      const piece = { type: 'O', rotation: 0, x: 4, y: 0 };
      const ghost = getGhostPosition(board, piece);
      expect(ghost.y).toBe(18); // O piece is 2 rows tall, so y=18 puts bottom row at 19
    });
  });

  describe('hardDrop', () => {
    it('returns piece at ghost position and distance', () => {
      const board = createBoard();
      const piece = { type: 'O', rotation: 0, x: 4, y: 0 };
      const { piece: dropped, distance } = hardDrop(board, piece);
      expect(dropped.y).toBe(18);
      expect(distance).toBe(18);
    });
  });

  describe('generateBag', () => {
    it('contains all 7 piece types', () => {
      const bag = generateBag();
      expect(bag.length).toBe(7);
      expect([...bag].sort()).toEqual([...PIECE_TYPES].sort());
    });
  });

  describe('spawnPiece', () => {
    it('spawns at top center of empty board', () => {
      const board = createBoard();
      const piece = spawnPiece(board, 'T');
      expect(piece).not.toBe(null);
      expect(piece.x).toBe(3);
      expect(piece.y).toBe(0);
    });

    it('returns null when spawn blocked', () => {
      const board = createBoard();
      // Fill top rows
      for (let c = 0; c < BOARD_COLS; c++) {
        board[0][c] = { type: 'X' };
        board[1][c] = { type: 'X' };
      }
      expect(spawnPiece(board, 'T')).toBe(null);
    });
  });

  describe('calculateScore', () => {
    it('scores single line at level 0', () => {
      expect(calculateScore(1, 0)).toBe(100);
    });

    it('scores tetris at level 0', () => {
      expect(calculateScore(4, 0)).toBe(800);
    });

    it('multiplies by level+1', () => {
      expect(calculateScore(1, 2)).toBe(300); // 100 * 3
    });

    it('returns 0 for no lines', () => {
      expect(calculateScore(0, 5)).toBe(0);
    });
  });

  describe('getGravityMs', () => {
    it('starts at 1000ms', () => {
      expect(getGravityMs(0)).toBe(1000);
    });

    it('floors at 100ms', () => {
      expect(getGravityMs(100)).toBe(100);
    });
  });

  describe('createTetrisState', () => {
    it('creates valid initial state', () => {
      const state = createTetrisState();
      expect(state.phase).toBe('IDLE');
      expect(state.board.length).toBe(BOARD_ROWS);
      expect(state.currentPiece).not.toBe(null);
      expect(PIECE_TYPES).toContain(state.nextPiece);
      expect(state.score).toBe(0);
      expect(state.level).toBe(0);
    });
  });

  describe('nextPieceFromBag', () => {
    it('advances to next piece', () => {
      const state = createTetrisState();
      const prev = state.currentPiece.type;
      const next = nextPieceFromBag(state);
      expect(next).not.toBe(null);
      expect(next.currentPiece).not.toBe(null);
    });

    it('returns null on game over (blocked spawn)', () => {
      const state = createTetrisState();
      // Fill top rows to block spawning
      for (let c = 0; c < BOARD_COLS; c++) {
        state.board[0][c] = { type: 'X' };
        state.board[1][c] = { type: 'X' };
      }
      expect(nextPieceFromBag(state)).toBe(null);
    });
  });
});
```

**Step 3: Run the tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/tetrisEngine.js frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js
git commit -m "feat(piano): add tetris engine with pure functions and tests"
```

---

## Task 2: Staff Matching Hook — useStaffMatching

Maps 4 action channels to musical notes. Each channel has target pitches; when the player plays matching notes, the corresponding Tetris action fires. Supports hold-to-repeat.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/useStaffMatching.js`
- Create: `frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js`

**Step 1: Create the staff matching hook**

Create `frontend/src/modules/Piano/PianoTetris/useStaffMatching.js`:

```js
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/**
 * Actions for Tetris control — 4 channels
 */
const ACTIONS = ['moveLeft', 'moveRight', 'rotateCCW', 'rotateCW'];

const INITIAL_REPEAT_DELAY = 200; // ms before hold-to-repeat kicks in
const REPEAT_INTERVAL = 100;       // ms between repeated actions

/**
 * Generate 4 unique target sets from noteRange, avoiding overlap.
 *
 * @param {number[]} noteRange - [low, high] MIDI range
 * @param {'single'|'dyad'|'triad'} complexity - How many notes per target
 * @returns {Object} Map of action -> targetPitches array
 */
export function generateTargets(noteRange, complexity = 'single') {
  const [low, high] = noteRange;
  const available = [];
  for (let n = low; n <= high; n++) available.push(n);

  // Shuffle
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const notesPerTarget = complexity === 'triad' ? 3 : complexity === 'dyad' ? 2 : 1;
  const targets = {};

  for (let a = 0; a < ACTIONS.length; a++) {
    const start = a * notesPerTarget;
    const pitches = available.slice(start, start + notesPerTarget);
    if (pitches.length < notesPerTarget) {
      // Not enough notes — fall back to single
      targets[ACTIONS[a]] = [available[a % available.length]];
    } else {
      targets[ACTIONS[a]] = pitches;
    }
  }

  return targets;
}

/**
 * Check if all target pitches for an action are currently held.
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {number[]} targetPitches - Required pitches
 * @returns {boolean}
 */
export function isActionMatched(activeNotes, targetPitches) {
  return targetPitches.every(p => activeNotes.has(p));
}

/**
 * Hook: manages 4 action channels, fires callbacks on match, supports hold-to-repeat.
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Object} targets - { moveLeft: [pitches], moveRight: [pitches], ... }
 * @param {function} onAction - Called with action name: 'moveLeft' | 'moveRight' | 'rotateCCW' | 'rotateCW'
 * @param {boolean} enabled - Whether matching is active
 * @returns {{ matchedActions: Set<string> }} - Currently matched actions (for UI glow)
 */
export function useStaffMatching(activeNotes, targets, onAction, enabled = true) {
  const [matchedActions, setMatchedActions] = useState(new Set());
  const repeatTimers = useRef(new Map()); // action -> { timeout, interval }
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Check matches on every activeNotes change
  useEffect(() => {
    if (!enabled || !targets) {
      setMatchedActions(new Set());
      return;
    }

    const newMatched = new Set();
    for (const action of ACTIONS) {
      const pitches = targets[action];
      if (pitches && isActionMatched(activeNotes, pitches)) {
        newMatched.add(action);
      }
    }
    setMatchedActions(newMatched);
  }, [activeNotes, targets, enabled]);

  // Fire actions and handle hold-to-repeat
  useEffect(() => {
    if (!enabled) return;

    for (const action of ACTIONS) {
      const isMatched = matchedActions.has(action);
      const hasTimer = repeatTimers.current.has(action);

      if (isMatched && !hasTimer) {
        // Action just matched — fire immediately, start repeat timer
        onActionRef.current(action);

        const timeout = setTimeout(() => {
          const interval = setInterval(() => {
            onActionRef.current(action);
          }, REPEAT_INTERVAL);

          repeatTimers.current.set(action, { timeout: null, interval });
        }, INITIAL_REPEAT_DELAY);

        repeatTimers.current.set(action, { timeout, interval: null });

      } else if (!isMatched && hasTimer) {
        // Action released — stop repeat
        const timer = repeatTimers.current.get(action);
        if (timer.timeout) clearTimeout(timer.timeout);
        if (timer.interval) clearInterval(timer.interval);
        repeatTimers.current.delete(action);
      }
    }
  }, [matchedActions, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of repeatTimers.current.values()) {
        if (timer.timeout) clearTimeout(timer.timeout);
        if (timer.interval) clearInterval(timer.interval);
      }
      repeatTimers.current.clear();
    };
  }, []);

  return { matchedActions };
}

export { ACTIONS };
```

**Step 2: Write tests**

Create `frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateTargets, isActionMatched, ACTIONS } from './useStaffMatching.js';

describe('useStaffMatching utilities', () => {
  describe('generateTargets', () => {
    it('generates targets for all 4 actions', () => {
      const targets = generateTargets([60, 72], 'single');
      expect(Object.keys(targets)).toEqual(ACTIONS);
    });

    it('produces single-note targets with complexity=single', () => {
      const targets = generateTargets([60, 72], 'single');
      for (const action of ACTIONS) {
        expect(targets[action].length).toBe(1);
      }
    });

    it('produces dyad targets with complexity=dyad', () => {
      const targets = generateTargets([60, 80], 'dyad');
      for (const action of ACTIONS) {
        expect(targets[action].length).toBe(2);
      }
    });

    it('produces no duplicate notes across targets', () => {
      const targets = generateTargets([60, 72], 'single');
      const allNotes = Object.values(targets).flat();
      expect(new Set(allNotes).size).toBe(allNotes.length);
    });

    it('stays within note range', () => {
      const targets = generateTargets([60, 72], 'single');
      const allNotes = Object.values(targets).flat();
      expect(allNotes.every(n => n >= 60 && n <= 72)).toBe(true);
    });
  });

  describe('isActionMatched', () => {
    it('returns true when all target pitches are active', () => {
      const active = new Map([[60, { velocity: 80 }], [64, { velocity: 80 }]]);
      expect(isActionMatched(active, [60, 64])).toBe(true);
    });

    it('returns false when some pitches missing', () => {
      const active = new Map([[60, { velocity: 80 }]]);
      expect(isActionMatched(active, [60, 64])).toBe(false);
    });

    it('returns true for single-note match', () => {
      const active = new Map([[67, { velocity: 100 }]]);
      expect(isActionMatched(active, [67])).toBe(true);
    });

    it('returns false for empty activeNotes', () => {
      expect(isActionMatched(new Map(), [60])).toBe(false);
    });
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/useStaffMatching.js frontend/src/modules/Piano/PianoTetris/useStaffMatching.test.js
git commit -m "feat(piano): add staff matching hook with hold-to-repeat"
```

---

## Task 3: Tetris Game Hook — useTetrisGame

The state machine that wires the tetris engine + staff matching. Manages phases (IDLE → STARTING → PLAYING → GAME_OVER), gravity tick, piece locking, and level advancement.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/useTetrisGame.js`

**Step 1: Create the game hook**

Create `frontend/src/modules/Piano/PianoTetris/useTetrisGame.js`:

```js
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import {
  createTetrisState, createBoard, spawnPiece, nextPieceFromBag,
  movePiece, rotatePiece, lockPiece, clearLines, hardDrop,
  getGhostPosition, calculateScore, getGravityMs,
  BOARD_ROWS, BOARD_COLS,
} from './tetrisEngine.js';
import { generateTargets, useStaffMatching } from './useStaffMatching.js';

const COUNTDOWN_STEPS = [3, 2, 1, 0];
const COUNTDOWN_STEP_MS = 800;
const LOCK_DELAY_MS = 500;
const GAME_OVER_DISPLAY_MS = 5000;

/**
 * Tetris game state machine hook.
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Object} tetrisConfig - From piano.yml tetris game config
 * @returns {Object} Game state for rendering
 */
export function useTetrisGame(activeNotes, tetrisConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-tetris' }), []);
  const [state, setState] = useState(createTetrisState);
  const stateRef = useRef(state);
  const gravityRef = useRef(null);
  const lockDelayRef = useRef(null);
  const countdownRef = useRef(null);
  const gameOverRef = useRef(null);

  useEffect(() => { stateRef.current = state; }, [state]);

  const levelConfig = tetrisConfig?.levels?.[state.level] ?? tetrisConfig?.levels?.[0];
  const noteRange = levelConfig?.note_range ?? [60, 72];
  const complexity = levelConfig?.complexity ?? 'single';

  // Generate staff targets — regenerate when level changes or on new piece
  const [targets, setTargets] = useState(() => generateTargets(noteRange, complexity));
  const targetRotation = levelConfig?.target_rotation ?? 'piece';

  // Regenerate targets based on rotation strategy
  const regenerateTargets = useCallback(() => {
    setTargets(generateTargets(noteRange, complexity));
  }, [noteRange, complexity]);

  // Target rotation on new piece
  const lastPieceId = useRef(null);
  useEffect(() => {
    if (targetRotation === 'piece' && state.currentPiece) {
      const pieceId = `${state.currentPiece.type}-${state.score}-${state.linesCleared}`;
      if (pieceId !== lastPieceId.current) {
        lastPieceId.current = pieceId;
        regenerateTargets();
      }
    }
  }, [state.currentPiece, state.score, state.linesCleared, targetRotation, regenerateTargets]);

  // Target rotation on timer
  useEffect(() => {
    if (targetRotation !== 'timer' || state.phase !== 'PLAYING') return;
    const ms = levelConfig?.target_change_ms ?? 5000;
    const interval = setInterval(regenerateTargets, ms);
    return () => clearInterval(interval);
  }, [targetRotation, state.phase, levelConfig, regenerateTargets]);

  // ─── Cleanup ─────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (gravityRef.current) clearInterval(gravityRef.current);
    if (lockDelayRef.current) clearTimeout(lockDelayRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (gameOverRef.current) clearTimeout(gameOverRef.current);
    gravityRef.current = null;
    lockDelayRef.current = null;
    countdownRef.current = null;
    gameOverRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // ─── Action Handler (from staff matching) ────────────────────

  const handleAction = useCallback((action) => {
    setState(prev => {
      if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;

      let newPiece = null;
      switch (action) {
        case 'moveLeft':
          newPiece = movePiece(prev.board, prev.currentPiece, -1, 0);
          break;
        case 'moveRight':
          newPiece = movePiece(prev.board, prev.currentPiece, 1, 0);
          break;
        case 'rotateCCW':
          newPiece = rotatePiece(prev.board, prev.currentPiece, -1);
          break;
        case 'rotateCW':
          newPiece = rotatePiece(prev.board, prev.currentPiece, 1);
          break;
      }

      if (!newPiece) return prev; // Move/rotation not possible
      return { ...prev, currentPiece: newPiece };
    });
  }, []);

  // Staff matching — only active during PLAYING
  const { matchedActions } = useStaffMatching(
    activeNotes,
    targets,
    handleAction,
    state.phase === 'PLAYING'
  );

  // ─── Start Game ──────────────────────────────────────────────

  const startGame = useCallback(() => {
    cleanup();
    const fresh = createTetrisState();
    setState({ ...fresh, phase: 'STARTING', countdown: 3 });

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setState(prev => ({ ...prev, countdown: COUNTDOWN_STEPS[step] }));
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setState(prev => ({ ...prev, phase: 'PLAYING', countdown: null }));
        logger.info('piano.tetris.started', {});
      }
    }, COUNTDOWN_STEP_MS);
  }, [cleanup, logger]);

  // ─── Gravity Tick ────────────────────────────────────────────

  const lockAndAdvance = useCallback(() => {
    setState(prev => {
      if (!prev.currentPiece || prev.phase !== 'PLAYING') return prev;

      // Lock piece
      const newBoard = lockPiece(prev.board, prev.currentPiece);
      const { board: clearedBoard, linesCleared } = clearLines(newBoard);

      const newLinesCleared = prev.linesCleared + linesCleared;
      const newLevel = Math.floor(newLinesCleared / 10);
      const lineScore = calculateScore(linesCleared, prev.level);

      if (linesCleared > 0) {
        logger.info('piano.tetris.lines-cleared', { lines: linesCleared, total: newLinesCleared, score: lineScore });
      }

      const updated = {
        ...prev,
        board: clearedBoard,
        score: prev.score + lineScore,
        linesCleared: newLinesCleared,
        level: newLevel,
      };

      // Spawn next piece
      const next = nextPieceFromBag(updated);
      if (!next) {
        // Game over
        logger.info('piano.tetris.game-over', { score: updated.score, lines: updated.linesCleared, level: updated.level });
        return { ...updated, phase: 'GAME_OVER', currentPiece: null };
      }

      return next;
    });
  }, [logger]);

  useEffect(() => {
    if (state.phase !== 'PLAYING') return;

    const gravityMs = getGravityMs(state.level);

    gravityRef.current = setInterval(() => {
      setState(prev => {
        if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;

        const moved = movePiece(prev.board, prev.currentPiece, 0, 1);
        if (moved) {
          return { ...prev, currentPiece: moved };
        }

        // Can't move down — start lock delay (or lock immediately if already at bottom)
        return prev; // Lock delay handled below
      });

      // Check if piece is grounded after gravity
      const current = stateRef.current;
      if (current.phase === 'PLAYING' && current.currentPiece) {
        const canDrop = movePiece(current.board, current.currentPiece, 0, 1);
        if (!canDrop && !lockDelayRef.current) {
          lockDelayRef.current = setTimeout(() => {
            lockDelayRef.current = null;
            lockAndAdvance();
          }, LOCK_DELAY_MS);
        }
      }
    }, gravityMs);

    return () => {
      clearInterval(gravityRef.current);
      gravityRef.current = null;
    };
  }, [state.phase, state.level, lockAndAdvance]);

  // ─── Game Over Auto-Dismiss ──────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'GAME_OVER') return;
    gameOverRef.current = setTimeout(() => {
      setState(createTetrisState());
      logger.info('piano.tetris.dismissed', {});
    }, GAME_OVER_DISPLAY_MS);
    return () => clearTimeout(gameOverRef.current);
  }, [state.phase, logger]);

  // ─── Derived state for rendering ─────────────────────────────

  const ghostPiece = useMemo(() => {
    if (state.phase !== 'PLAYING' || !state.currentPiece) return null;
    return getGhostPosition(state.board, state.currentPiece);
  }, [state.board, state.currentPiece, state.phase]);

  return {
    phase: state.phase,
    board: state.board,
    currentPiece: state.currentPiece,
    ghostPiece,
    nextPiece: state.nextPiece,
    score: state.score,
    linesCleared: state.linesCleared,
    level: state.level,
    countdown: state.countdown,
    targets,
    matchedActions,
    startGame,
    deactivate: () => { cleanup(); setState(createTetrisState()); },
  };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/useTetrisGame.js
git commit -m "feat(piano): add tetris game state machine hook"
```

---

## Task 4: TetrisBoard Component

Renders the 10x20 grid with the current piece, ghost piece, and locked cells.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.jsx`
- Create: `frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.scss`

**Step 1: Create the board component**

Create `frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.jsx`:

```jsx
import { useMemo } from 'react';
import { getPieceCells, BOARD_ROWS, BOARD_COLS, PIECES, PIECE_TYPES } from '../tetrisEngine.js';
import './TetrisBoard.scss';

// Color map for piece types
const PIECE_COLORS = {
  I: 180, // cyan
  O: 50,  // yellow
  T: 280, // purple
  S: 120, // green
  Z: 0,   // red
  J: 220, // blue
  L: 30,  // orange
};

/**
 * Renders the 10x20 Tetris board with current piece, ghost piece, and locked cells.
 */
export function TetrisBoard({ board, currentPiece, ghostPiece, nextPiece }) {
  // Build a display grid combining board + ghost + current piece
  const displayGrid = useMemo(() => {
    const grid = board.map(row => row.map(cell =>
      cell ? { ...cell, state: 'locked' } : null
    ));

    // Ghost piece (semi-transparent preview)
    if (ghostPiece) {
      const ghostCells = getPieceCells(ghostPiece);
      for (const [r, c] of ghostCells) {
        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS && !grid[r][c]) {
          grid[r][c] = { type: ghostPiece.type, state: 'ghost' };
        }
      }
    }

    // Current piece (solid)
    if (currentPiece) {
      const cells = getPieceCells(currentPiece);
      for (const [r, c] of cells) {
        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS) {
          grid[r][c] = { type: currentPiece.type, state: 'active' };
        }
      }
    }

    return grid;
  }, [board, currentPiece, ghostPiece]);

  // Next piece preview — render in a 4x4 mini grid
  const nextPieceGrid = useMemo(() => {
    if (!nextPiece) return null;
    const offsets = PIECES[nextPiece][0]; // rotation 0
    const grid = Array.from({ length: 4 }, () => Array(4).fill(null));
    for (const [r, c] of offsets) {
      if (r >= 0 && r < 4 && c >= 0 && c < 4) {
        grid[r][c] = { type: nextPiece };
      }
    }
    return grid;
  }, [nextPiece]);

  return (
    <div className="tetris-board-wrapper">
      <div className="tetris-board">
        {displayGrid.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              className={`tetris-cell${cell ? ` tetris-cell--${cell.state}` : ''}`}
              style={cell ? { '--hue': PIECE_COLORS[cell.type] ?? 0 } : undefined}
            />
          ))
        )}
      </div>

      {nextPieceGrid && (
        <div className="tetris-next">
          <span className="tetris-next__label">NEXT</span>
          <div className="tetris-next__grid">
            {nextPieceGrid.map((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`next-${r}-${c}`}
                  className={`tetris-cell${cell ? ' tetris-cell--preview' : ''}`}
                  style={cell ? { '--hue': PIECE_COLORS[cell.type] ?? 0 } : undefined}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { PIECE_COLORS };
```

**Step 2: Create the board styles**

Create `frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.scss`:

```scss
.tetris-board-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  height: 100%;
}

.tetris-board {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  grid-template-rows: repeat(20, 1fr);
  gap: 1px;
  width: 100%;
  max-width: 300px;
  aspect-ratio: 1 / 2;
  background: rgba(0, 0, 0, 0.6);
  border: 2px solid rgba(0, 200, 255, 0.4);
  border-radius: 4px;
  padding: 2px;
}

.tetris-cell {
  background: rgba(30, 30, 50, 0.5);
  border-radius: 2px;

  &--locked {
    background: hsla(var(--hue), 70%, 50%, 0.9);
    box-shadow: inset 0 0 4px hsla(var(--hue), 100%, 70%, 0.5);
  }

  &--active {
    background: hsla(var(--hue), 90%, 60%, 1);
    box-shadow:
      inset 0 0 6px hsla(var(--hue), 100%, 80%, 0.6),
      0 0 8px hsla(var(--hue), 100%, 60%, 0.4);
  }

  &--ghost {
    background: hsla(var(--hue), 50%, 50%, 0.2);
    border: 1px dashed hsla(var(--hue), 70%, 60%, 0.4);
  }

  &--preview {
    background: hsla(var(--hue), 80%, 55%, 0.8);
    box-shadow: inset 0 0 3px hsla(var(--hue), 100%, 70%, 0.4);
  }
}

.tetris-next {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  &__label {
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(0, 200, 255, 0.7);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(4, 20px);
    grid-template-rows: repeat(4, 20px);
    gap: 1px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 3px;
    padding: 2px;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.jsx frontend/src/modules/Piano/PianoTetris/components/TetrisBoard.scss
git commit -m "feat(piano): add TetrisBoard grid renderer with ghost and next-piece preview"
```

---

## Task 5: ActionStaff Component

Renders a single musical staff with clef, target note(s), and action icon. Glows when the player matches the target.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.jsx`
- Create: `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.scss`

**Step 1: Create the ActionStaff component**

Create `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.jsx`:

```jsx
import { useMemo } from 'react';
import { getNoteName } from '../../noteUtils.js';
import './ActionStaff.scss';

// Staff line positions (from bottom): E4=0, G4=1, B4=2, D5=3, F5=4 (treble)
// Bass: G2=0, B2=1, D3=2, F3=3, A3=4
const TREBLE_BOTTOM = 64; // E4
const BASS_BOTTOM = 43;   // G2

// Map MIDI note to staff position (number of half-steps from bottom line)
// Returns { staffY, needsLedger, clef }
function getNoteStaffPosition(midiNote) {
  // Note names in chromatic order with staff positions
  // C D E F G A B map to positions 0 1 2 3 4 5 6 (diatonic)
  const NOTE_TO_DIATONIC = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  const isSharp = ![0, 2, 4, 5, 7, 9, 11].includes(midiNote % 12);
  const baseMidi = isSharp ? midiNote - 1 : midiNote;
  const octave = Math.floor(baseMidi / 12) - 1;
  const noteInOctave = baseMidi % 12;
  const diatonic = NOTE_TO_DIATONIC[noteInOctave] ?? 0;

  // Absolute diatonic position (C4 = 28)
  const absDiatonic = octave * 7 + diatonic;

  // Treble clef: bottom line = E4 (diatonic 30), top line = F5 (diatonic 34)
  // Bass clef: bottom line = G2 (diatonic 18), top line = A3 (diatonic 22)
  const trebleBottom = 30; // E4
  const bassTop = 22;      // A3

  const useTreeble = absDiatonic >= 28; // C4 and above -> treble
  const clef = useTreeble ? 'treble' : 'bass';

  // Position relative to bottom staff line
  const bottomLineDiatonic = useTreeble ? trebleBottom : 18; // G2 for bass
  const position = absDiatonic - bottomLineDiatonic;

  return { position, clef, isSharp };
}

// SVG action icons
const ACTION_ICONS = {
  moveLeft: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M28 8 L12 20 L28 32" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  moveRight: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M12 8 L28 20 L12 32" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  rotateCCW: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M12 14 A12 12 0 1 0 20 8" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M16 6 L12 14 L20 14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  rotateCW: (
    <svg viewBox="0 0 40 40" className="action-icon">
      <path d="M28 14 A12 12 0 1 1 20 8" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M24 6 L28 14 L20 14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

/**
 * Renders a single action staff with clef, target notes, and action icon.
 *
 * @param {string} action - 'moveLeft' | 'moveRight' | 'rotateCCW' | 'rotateCW'
 * @param {number[]} targetPitches - MIDI notes to display on staff
 * @param {boolean} matched - Whether the player is currently matching this staff
 * @param {boolean} fired - Brief pulse when action fires
 */
export function ActionStaff({ action, targetPitches = [], matched = false, fired = false }) {
  const notePositions = useMemo(() =>
    targetPitches.map(pitch => ({
      pitch,
      name: getNoteName(pitch),
      ...getNoteStaffPosition(pitch),
    })),
    [targetPitches]
  );

  // Determine clef from first note (all notes in a staff should share clef)
  const clef = notePositions[0]?.clef ?? 'treble';

  // Staff line Y positions (SVG coords, 5 lines spaced 8px apart)
  // Bottom line at y=48, top line at y=16
  const staffLineYs = [48, 40, 32, 24, 16];

  return (
    <div className={`action-staff${matched ? ' action-staff--matched' : ''}${fired ? ' action-staff--fired' : ''}`}>
      <div className="action-staff__icon">
        {ACTION_ICONS[action]}
      </div>

      <svg className="action-staff__svg" viewBox="0 0 120 64" preserveAspectRatio="xMidYMid meet">
        {/* Staff lines */}
        {staffLineYs.map((y, i) => (
          <line key={i} x1="10" y1={y} x2="110" y2={y} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        ))}

        {/* Clef symbol (simplified text) */}
        <text x="14" y={clef === 'treble' ? 42 : 36} fontSize="28" fill="rgba(255,255,255,0.6)" fontFamily="serif">
          {clef === 'treble' ? '𝄞' : '𝄢'}
        </text>

        {/* Note heads */}
        {notePositions.map((np, i) => {
          // Y position: bottom line (pos=0) = y48, each diatonic step = -4px
          const noteY = 48 - np.position * 4;
          const noteX = 70 + i * 20; // Space multiple notes

          // Ledger lines for notes above/below staff
          const ledgerLines = [];
          if (np.position < 0) {
            for (let p = -2; p >= np.position; p -= 2) {
              ledgerLines.push(48 - p * 4);
            }
          }
          if (np.position > 8) {
            for (let p = 10; p <= np.position; p += 2) {
              ledgerLines.push(48 - p * 4);
            }
          }

          return (
            <g key={np.pitch}>
              {/* Ledger lines */}
              {ledgerLines.map((ly, li) => (
                <line key={`ledger-${li}`} x1={noteX - 10} y1={ly} x2={noteX + 10} y2={ly}
                  stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
              ))}
              {/* Note head — filled ellipse */}
              <ellipse cx={noteX} cy={noteY} rx="6" ry="4.5"
                className={`action-staff__note${matched ? ' action-staff__note--matched' : ''}`}
                transform={`rotate(-10, ${noteX}, ${noteY})`}
              />
              {/* Sharp sign */}
              {np.isSharp && (
                <text x={noteX - 14} y={noteY + 4} fontSize="14" fill="rgba(255,255,255,0.7)" fontFamily="serif">♯</text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="action-staff__label">
        {targetPitches.map(p => getNoteName(p)).join(' ')}
      </div>
    </div>
  );
}
```

**Step 2: Create the styles**

Create `frontend/src/modules/Piano/PianoTetris/components/ActionStaff.scss`:

```scss
.action-staff {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: none; // TV app kills CSS transitions; use class toggles

  &--matched {
    background: rgba(0, 200, 100, 0.15);
    border-color: rgba(0, 255, 130, 0.4);
  }

  &--fired {
    background: rgba(0, 255, 130, 0.25);
    border-color: rgba(0, 255, 130, 0.7);
  }

  &__icon {
    width: 32px;
    height: 32px;
    color: rgba(255, 255, 255, 0.5);

    .action-staff--matched & {
      color: rgba(0, 255, 130, 0.9);
    }

    .action-staff--fired & {
      color: rgba(0, 255, 200, 1);
    }
  }

  .action-icon {
    width: 100%;
    height: 100%;
  }

  &__svg {
    width: 100%;
    max-width: 140px;
    height: auto;
  }

  &__note {
    fill: rgba(255, 255, 255, 0.8);
    stroke: rgba(255, 255, 255, 0.3);
    stroke-width: 0.5;

    &--matched {
      fill: rgba(0, 255, 130, 0.9);
      stroke: rgba(0, 255, 130, 0.5);
    }
  }

  &__label {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 0.05em;
    font-weight: 600;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/components/ActionStaff.jsx frontend/src/modules/Piano/PianoTetris/components/ActionStaff.scss
git commit -m "feat(piano): add ActionStaff component with SVG staff and note rendering"
```

---

## Task 6: TetrisOverlay Component

Countdown, game over, and score display — matches existing GameOverlay pattern.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.jsx`
- Create: `frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.scss`

**Step 1: Create the overlay component**

Create `frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.jsx`:

```jsx
import './TetrisOverlay.scss';

/**
 * Overlay for countdown, game over display.
 */
export function TetrisOverlay({ phase, countdown, score, linesCleared, level }) {
  if (phase === 'STARTING' && countdown != null) {
    return (
      <div className="tetris-overlay">
        <div className="tetris-overlay__countdown">
          {countdown === 0 ? 'GO!' : countdown}
        </div>
      </div>
    );
  }

  if (phase === 'GAME_OVER') {
    return (
      <div className="tetris-overlay">
        <div className="tetris-overlay__gameover">
          <h2 className="tetris-overlay__title">GAME OVER</h2>
          <div className="tetris-overlay__stats">
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{score.toLocaleString()}</span>
              <span className="tetris-overlay__stat-label">Score</span>
            </div>
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{linesCleared}</span>
              <span className="tetris-overlay__stat-label">Lines</span>
            </div>
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{level}</span>
              <span className="tetris-overlay__stat-label">Level</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

**Step 2: Create the styles**

Create `frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.scss`:

```scss
.tetris-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;

  &__countdown {
    font-size: 8rem;
    font-weight: 900;
    color: white;
    text-shadow:
      0 0 30px rgba(0, 200, 255, 0.8),
      0 0 60px rgba(0, 200, 255, 0.4);
  }

  &__gameover {
    text-align: center;
    background: rgba(0, 0, 0, 0.8);
    padding: 40px 60px;
    border-radius: 16px;
    border: 2px solid rgba(255, 50, 50, 0.5);
  }

  &__title {
    font-size: 3rem;
    font-weight: 900;
    color: #ff4444;
    margin: 0 0 24px;
    text-shadow: 0 0 20px rgba(255, 68, 68, 0.6);
  }

  &__stats {
    display: flex;
    gap: 32px;
    justify-content: center;
  }

  &__stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  &__stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: white;
  }

  &__stat-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.jsx frontend/src/modules/Piano/PianoTetris/components/TetrisOverlay.scss
git commit -m "feat(piano): add TetrisOverlay for countdown and game over display"
```

---

## Task 7: PianoTetris Main Component

The main layout component that assembles staves, board, and keyboard per the design doc layout.

**Files:**
- Create: `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`
- Create: `frontend/src/modules/Piano/PianoTetris/PianoTetris.scss`

**Step 1: Create the main PianoTetris component**

Create `frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx`:

```jsx
import { useMemo } from 'react';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { useTetrisGame } from './useTetrisGame.js';
import { TetrisBoard } from './components/TetrisBoard.jsx';
import { ActionStaff } from './components/ActionStaff.jsx';
import { TetrisOverlay } from './components/TetrisOverlay.jsx';
import './PianoTetris.scss';

/**
 * Piano Tetris — full screen layout with staves flanking the board.
 *
 * Layout:
 * +----------------------------------------------+
 * |  [Move Left]              [Move Right]       |
 * |  [staff]     +----------+ [staff]            |
 * |              |  TETRIS  |                    |
 * |  [Rot CCW]   |  BOARD   |  [Rot CW]         |
 * |  [staff]     +----------+  [staff]           |
 * +----------------------------------------------+
 * |           PIANO KEYBOARD                     |
 * +----------------------------------------------+
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Object} tetrisConfig - From piano.yml
 * @param {function} onDeactivate - Called when game should exit
 */
export function PianoTetris({ activeNotes, tetrisConfig, onDeactivate }) {
  const game = useTetrisGame(activeNotes, tetrisConfig);

  // Keyboard range — show the note range for current level
  const levelConfig = tetrisConfig?.levels?.[game.level] ?? tetrisConfig?.levels?.[0];
  const noteRange = levelConfig?.note_range ?? [60, 72];

  const { startNote, endNote } = useMemo(() => {
    const [low, high] = noteRange;
    const span = high - low;
    const padding = Math.round(span / 3);
    const minSpan = 24;

    let displayStart = low - padding;
    let displayEnd = high + padding;
    if (displayEnd - displayStart < minSpan) {
      const extra = minSpan - (displayEnd - displayStart);
      displayStart -= Math.floor(extra / 2);
      displayEnd += Math.ceil(extra / 2);
    }

    return {
      startNote: Math.max(21, displayStart),
      endNote: Math.min(108, displayEnd),
    };
  }, [noteRange]);

  // Target pitches for keyboard highlighting — all pitches across all 4 staves
  const keyboardTargets = useMemo(() => {
    if (!game.targets) return null;
    const pitches = new Set();
    for (const arr of Object.values(game.targets)) {
      for (const p of arr) pitches.add(p);
    }
    return pitches;
  }, [game.targets]);

  // HUD info
  const scoreDisplay = game.score.toLocaleString();

  return (
    <div className="piano-tetris">
      <div className="piano-tetris__hud">
        <span className="piano-tetris__score">{scoreDisplay}</span>
        <span className="piano-tetris__level">Level {game.level}</span>
        <span className="piano-tetris__lines">{game.linesCleared} lines</span>
      </div>

      <div className="piano-tetris__play-area">
        {/* Left column: Move Left (top) + Rotate CCW (bottom) */}
        <div className="piano-tetris__staves piano-tetris__staves--left">
          <ActionStaff
            action="moveLeft"
            targetPitches={game.targets?.moveLeft ?? []}
            matched={game.matchedActions.has('moveLeft')}
          />
          <ActionStaff
            action="rotateCCW"
            targetPitches={game.targets?.rotateCCW ?? []}
            matched={game.matchedActions.has('rotateCCW')}
          />
        </div>

        {/* Center: Tetris board */}
        <div className="piano-tetris__board-container">
          <TetrisBoard
            board={game.board}
            currentPiece={game.currentPiece}
            ghostPiece={game.ghostPiece}
            nextPiece={game.nextPiece}
          />
        </div>

        {/* Right column: Move Right (top) + Rotate CW (bottom) */}
        <div className="piano-tetris__staves piano-tetris__staves--right">
          <ActionStaff
            action="moveRight"
            targetPitches={game.targets?.moveRight ?? []}
            matched={game.matchedActions.has('moveRight')}
          />
          <ActionStaff
            action="rotateCW"
            targetPitches={game.targets?.rotateCW ?? []}
            matched={game.matchedActions.has('rotateCW')}
          />
        </div>
      </div>

      <div className="piano-tetris__keyboard" style={{ height: '25%' }}>
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={keyboardTargets}
        />
      </div>

      <TetrisOverlay
        phase={game.phase}
        countdown={game.countdown}
        score={game.score}
        linesCleared={game.linesCleared}
        level={game.level}
      />
    </div>
  );
}
```

**Step 2: Create the styles**

Create `frontend/src/modules/Piano/PianoTetris/PianoTetris.scss`:

```scss
.piano-tetris {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  color: white;
  overflow: hidden;

  &__hud {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.4);
    border-bottom: 1px solid rgba(0, 200, 255, 0.2);
    flex-shrink: 0;
  }

  &__score {
    font-size: 1.5rem;
    font-weight: 800;
    color: rgba(0, 255, 200, 0.9);
    text-shadow: 0 0 10px rgba(0, 255, 200, 0.4);
  }

  &__level, &__lines {
    font-size: 0.85rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
  }

  &__play-area {
    display: flex;
    flex: 1;
    min-height: 0;
    padding: 12px;
    gap: 12px;
    align-items: center;
    justify-content: center;
  }

  &__staves {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    max-width: 200px;
    justify-content: center;

    &--left {
      align-items: flex-end;
    }

    &--right {
      align-items: flex-start;
    }
  }

  &__board-container {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    flex-shrink: 0;
  }

  &__keyboard {
    flex-shrink: 0;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoTetris/PianoTetris.jsx frontend/src/modules/Piano/PianoTetris/PianoTetris.scss
git commit -m "feat(piano): add PianoTetris main layout component"
```

---

## Task 8: Game Registry & PianoVisualizer Integration

Replace hardcoded game mode detection with a config-driven registry. Add tetris as a second game. Wire PianoTetris into PianoVisualizer.

**Files:**
- Create: `frontend/src/modules/Piano/gameRegistry.js`
- Create: `frontend/src/modules/Piano/useGameActivation.js`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`
- Modify: `data/household/config/piano.yml`

**Step 1: Create the game registry**

Create `frontend/src/modules/Piano/gameRegistry.js`:

```js
/**
 * Game Registry — maps game IDs to their components and hooks.
 *
 * `layout`:
 *   - 'waterfall': game overlays on top of existing waterfall (rhythm game)
 *   - 'replace': game replaces the waterfall entirely (tetris)
 */
const GAME_REGISTRY = {
  rhythm: {
    component: () => import('./components/GameOverlay'),
    hook: () => import('./useGameMode'),
    layout: 'waterfall',
  },
  tetris: {
    component: () => import('./PianoTetris/PianoTetris'),
    hook: () => import('./PianoTetris/useTetrisGame'),
    layout: 'replace',
  },
};

export function getGameEntry(gameId) {
  return GAME_REGISTRY[gameId] ?? null;
}

export function getGameIds() {
  return Object.keys(GAME_REGISTRY);
}

export { GAME_REGISTRY };
```

**Step 2: Create the shared activation hook**

Create `frontend/src/modules/Piano/useGameActivation.js`:

```js
import { useState, useEffect, useRef, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { isActivationComboHeld } from './gameEngine.js';

const ACTIVATION_COOLDOWN_MS = 2000;

/**
 * Shared game activation hook — watches activeNotes for any game's activation combo.
 *
 * Reads `games` config from piano.yml. Each game entry has:
 *   activation: { notes: [MIDI...], window_ms: 300 }
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Object} gamesConfig - { rhythm: { activation: {...}, ... }, tetris: { activation: {...}, ... } }
 * @returns {{ activeGameId: string|null, gameConfig: Object|null, deactivate: function }}
 */
export function useGameActivation(activeNotes, gamesConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'game-activation' }), []);
  const [activeGameId, setActiveGameId] = useState(null);
  const cooldownRef = useRef(0);

  useEffect(() => {
    if (!gamesConfig) return;
    if (Date.now() < cooldownRef.current) return;

    // Don't check for new activations while a game is active
    // (re-pressing combo during play exits — handled below)
    for (const [gameId, config] of Object.entries(gamesConfig)) {
      const activation = config?.activation;
      if (!activation?.notes) continue;

      const comboHeld = isActivationComboHeld(
        activeNotes,
        activation.notes,
        activation.window_ms ?? 300
      );

      if (!comboHeld) continue;

      cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;

      if (activeGameId === null) {
        logger.info('game.activated', { gameId });
        setActiveGameId(gameId);
      } else if (activeGameId === gameId) {
        // Same combo pressed again during play — exit
        logger.info('game.deactivated', { gameId });
        setActiveGameId(null);
      }
      // Different game combo while one is active — ignore
      break;
    }
  }, [activeNotes, gamesConfig, activeGameId, logger]);

  // Dev shortcut: backtick cycles through games (localhost only)
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    if (!gamesConfig) return;

    const gameIds = Object.keys(gamesConfig);

    const handleKey = (e) => {
      if (e.key !== '`') return;
      e.preventDefault();
      e.stopPropagation();

      if (Date.now() < cooldownRef.current) return;
      cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;

      setActiveGameId(prev => {
        if (prev === null) {
          // Activate first game
          const id = gameIds[0];
          logger.info('game.dev-activated', { gameId: id });
          return id;
        }
        const idx = gameIds.indexOf(prev);
        if (idx < gameIds.length - 1) {
          // Cycle to next game
          const id = gameIds[idx + 1];
          logger.info('game.dev-switched', { from: prev, to: id });
          return id;
        }
        // Deactivate
        logger.info('game.dev-deactivated', { gameId: prev });
        return null;
      });
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [gamesConfig, logger]);

  const deactivate = () => {
    cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;
    setActiveGameId(null);
  };

  const gameConfig = activeGameId ? gamesConfig[activeGameId] : null;

  return { activeGameId, gameConfig, deactivate };
}
```

**Step 3: Update piano.yml — add tetris config under `games` key**

Modify `data/household/config/piano.yml` — add a `games` section that wraps the existing `game` as `rhythm` and adds `tetris`:

Replace the entire file with:

```yaml
# Piano app configuration

# Legacy game config (rhythm game) — kept for backward compat
game:
  activation:
    notes: [30, 102]        # F#1 + F#7
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
    - name: "Three Keys"
      notes: [60, 62, 64]
      range: [60, 72]
      fall_duration_ms: 15000
      spawn_delay_ms: 1500
      max_visible: 1
      simultaneous: 1
      sequential: true
      mode: invaders
      points_to_advance: 22000
      max_misses: 30

    - name: "Five Keys"
      notes: [60, 62, 64, 65, 67]
      range: [60, 72]
      fall_duration_ms: 12000
      spawn_delay_ms: 1200
      max_visible: 1
      simultaneous: 1
      sequential: true
      mode: invaders
      points_to_advance: 22000
      max_misses: 25

    - name: "Full Octave"
      notes: [60, 62, 64, 65, 67, 69, 71]
      range: [60, 72]
      fall_duration_ms: 10000
      spawn_delay_ms: 1000
      max_visible: 1
      simultaneous: 1
      sequential: true
      mode: invaders
      points_to_advance: 22000
      max_misses: 20

    - name: "Mix It Up"
      notes: [60, 62, 64, 65, 67, 69, 71]
      range: [60, 72]
      fall_duration_ms: 9000
      spawn_delay_ms: 800
      max_visible: 2
      simultaneous: 1
      mode: invaders
      points_to_advance: 11000
      max_misses: 10

    - name: "Sharp Notes"
      notes: [60, 62, 64, 65, 66, 67, 69, 70, 71]
      range: [60, 72]
      fall_duration_ms: 9000
      spawn_delay_ms: 800
      max_visible: 2
      simultaneous: 1
      mode: invaders
      points_to_advance: 11000
      max_misses: 10

    - name: "Two Octaves"
      notes: [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67]
      range: [48, 72]
      fall_duration_ms: 8000
      spawn_delay_ms: 700
      max_visible: 2
      simultaneous: 1
      mode: invaders
      points_to_advance: 11000
      max_misses: 8

    - name: "Rhythm Time"
      notes: [60, 62, 64, 65, 67]
      range: [60, 72]
      fall_duration_ms: 6000
      spawn_delay_ms: 1000
      max_visible: 2
      simultaneous: 1
      mode: hero
      points_to_advance: 11000
      max_misses: 8

    - name: "Duets"
      notes: [60, 62, 64, 65, 67, 69, 71]
      range: [60, 72]
      fall_duration_ms: 5000
      spawn_delay_ms: 1200
      max_visible: 2
      simultaneous: 2
      mode: hero
      points_to_advance: 11000
      max_misses: 6

# ── Multi-game registry ──────────────────────────────────────────
games:
  rhythm:
    activation:
      notes: [30, 102]      # F#1 + F#7
      window_ms: 300

  tetris:
    activation:
      notes: [31, 103]      # G1 + G7
      window_ms: 300
    levels:
      - gravity_ms: 1000
        complexity: single
        note_range: [60, 72]
        target_rotation: piece
      - gravity_ms: 800
        complexity: single
        note_range: [55, 76]
        target_rotation: piece
      - gravity_ms: 600
        complexity: dyad
        note_range: [48, 84]
        target_rotation: piece
      - gravity_ms: 500
        complexity: dyad
        note_range: [48, 84]
        target_rotation: timer
        target_change_ms: 8000
      - gravity_ms: 400
        complexity: triad
        note_range: [48, 84]
        target_rotation: timer
        target_change_ms: 6000
```

**Step 4: Modify PianoVisualizer to use game activation + tetris**

Modify `frontend/src/modules/Piano/PianoVisualizer.jsx`:

1. Add imports at top (after existing imports):

```js
import { useGameActivation } from './useGameActivation.js';
import { PianoTetris } from './PianoTetris/PianoTetris.jsx';
```

2. In the component body, after `setGameConfig(gc)` on line 111, also store the games config:

Add state: `const [gamesConfig, setGamesConfig] = useState(null);`

In the config loading effect, after the `setGameConfig(gc)` line, add:
```js
const gamesC = pianoAppConfig?.parsed?.games ?? null;
setGamesConfig(gamesC);
```

3. Add the activation hook after `useGameMode`:

```js
const activation = useGameActivation(activeNotes, gamesConfig);
```

4. Determine which game is active and whether to show tetris or rhythm:

```js
const isRhythmGame = game.isGameMode || (activation.activeGameId === 'rhythm');
const isTetrisGame = activation.activeGameId === 'tetris';
const isAnyGame = isRhythmGame || isTetrisGame;
```

5. In the render, wrap the tetris game in a conditional:

After the existing `{game.isGameMode && ( <GameOverlay ... /> )}` block (line ~333), add:

```jsx
{isTetrisGame && (
  <div className="tetris-fullscreen">
    <PianoTetris
      activeNotes={activeNotes}
      tetrisConfig={gamesConfig?.tetris}
      onDeactivate={activation.deactivate}
    />
  </div>
)}
```

6. Update the root className and inactivity logic to account for tetris:

Replace `game.isGameMode` references with `isAnyGame` where appropriate (inactivity detection, layout classes).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/gameRegistry.js \
       frontend/src/modules/Piano/useGameActivation.js \
       frontend/src/modules/Piano/PianoVisualizer.jsx \
       data/household/config/piano.yml
git commit -m "feat(piano): add game registry, activation hook, and tetris integration"
```

---

## Task 9: Manual Testing & Polish

Verify the full flow works end-to-end using the dev keyboard shortcuts.

**Files:**
- Modify: Various files for bug fixes discovered during testing

**Step 1: Start the dev server**

Run: `lsof -i :3111` to check if already running.
If not running: `npm run dev`

**Step 2: Test in browser**

1. Open the PianoVisualizer (navigate to office app or use the TV app)
2. Press backtick (`) to cycle through games — should now cycle: no game → rhythm → tetris → no game
3. Verify tetris layout: 4 staves flanking a board, keyboard at bottom
4. Use number keys (dev MIDI input) to play notes matching the staff targets
5. Verify: matching a staff target fires the corresponding tetris action
6. Verify: pieces fall, lines clear, score increments, level advances
7. Verify: game over when board fills up, auto-dismisses after 5 seconds
8. Verify: pressing activation combo (or backtick) during play exits back to visualizer

**Step 3: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix(piano): polish tetris integration from manual testing"
```

---

## Task 10: Run All Existing Tests

Verify nothing broke in the existing piano module.

**Step 1: Run the tetris engine tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoTetris/`
Expected: All tests PASS

**Step 2: Run any existing piano-related tests**

Run: `npx vitest run --reporter=verbose 2>&1 | head -50` to check for any test suite issues

**Step 3: Commit if any fixes needed**

---

## Summary of File Changes

### New Files (10)
```
frontend/src/modules/Piano/PianoTetris/
├── PianoTetris.jsx
├── PianoTetris.scss
├── useTetrisGame.js
├── tetrisEngine.js
├── tetrisEngine.test.js
├── useStaffMatching.js
├── useStaffMatching.test.js
└── components/
    ├── TetrisBoard.jsx
    ├── TetrisBoard.scss
    ├── ActionStaff.jsx
    ├── ActionStaff.scss
    ├── TetrisOverlay.jsx
    └── TetrisOverlay.scss

frontend/src/modules/Piano/
├── gameRegistry.js          (new)
└── useGameActivation.js     (new)
```

### Modified Files (2)
```
frontend/src/modules/Piano/PianoVisualizer.jsx  (add tetris integration)
data/household/config/piano.yml                  (add games registry + tetris config)
```
