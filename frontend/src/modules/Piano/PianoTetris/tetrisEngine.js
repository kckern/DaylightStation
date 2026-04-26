/**
 * Tetris Engine — Pure functions, no React
 *
 * State shape:
 * {
 *   phase: 'IDLE' | 'STARTING' | 'PLAYING' | 'GAME_OVER',
 *   board,          // 20x10 grid of null | { type: 'T' } etc.
 *   currentPiece,   // { type, rotation, x, y } or null
 *   nextPiece,      // { type, rotation, x, y } or null
 *   bag,            // array of piece type strings remaining
 *   nextBag,        // pre-shuffled bag for seamless refill
 *   score: 0,
 *   linesCleared: 0,
 *   level: 0,
 *   countdown: null,
 * }
 *
 * Piece shape: { type: 'T', rotation: 0, x: Math.floor((BOARD_COLS - 4) / 2), y: 0 }
 */

// ─── Constants ──────────────────────────────────────────────────

export const BOARD_ROWS = 20;
export const BOARD_COLS = 10;

export const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };

/**
 * 7 standard Tetris pieces, each with 4 rotations.
 * Each rotation is an array of [row, col] offsets from the piece origin.
 */
export const PIECES = {
  I: [
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
  ],
  O: [
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
  ],
  T: [
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [1, 1], [1, 2], [0, 1]],
    [[0, 0], [1, 0], [2, 0], [1, -1]],
  ],
  S: [
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
  ],
  Z: [
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
  ],
  J: [
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, -1]],
  ],
  L: [
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
  ],
};

export const PIECE_TYPES = Object.keys(PIECES);

// ─── Board Operations ───────────────────────────────────────────

/**
 * Create an empty board (20 rows x 10 cols of nulls).
 */
export function createBoard() {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => null)
  );
}

/**
 * Get absolute cell positions [row, col] for a piece at its position/rotation.
 */
export function getPieceCells(piece) {
  const offsets = PIECES[piece.type][piece.rotation];
  return offsets.map(([row, col]) => [row + piece.y, col + piece.x]);
}

/**
 * Check if a piece is at a valid position (in bounds + no collision).
 */
export function isValidPosition(board, piece) {
  const cells = getPieceCells(piece);
  for (const [row, col] of cells) {
    if (row < 0 || row >= BOARD_ROWS) return false;
    if (col < 0 || col >= BOARD_COLS) return false;
    if (board[row][col] !== null) return false;
  }
  return true;
}

/**
 * Lock a piece onto the board. Returns a new board (does not mutate).
 */
export function lockPiece(board, piece) {
  const newBoard = board.map(row => [...row]);
  const cells = getPieceCells(piece);
  for (const [row, col] of cells) {
    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
      newBoard[row][col] = { type: piece.type };
    }
  }
  return newBoard;
}

/**
 * Clear completed lines. Returns { board, linesCleared }.
 * Full rows are removed and new empty rows are added at the top.
 */
export function clearLines(board) {
  const remaining = board.filter(row => row.some(cell => cell === null));
  const linesCleared = BOARD_ROWS - remaining.length;
  if (linesCleared === 0) return { board, linesCleared: 0 };

  const emptyRows = Array.from({ length: linesCleared }, () =>
    Array.from({ length: BOARD_COLS }, () => null)
  );
  return { board: [...emptyRows, ...remaining], linesCleared };
}

// ─── Piece Movement ─────────────────────────────────────────────

/**
 * Move a piece by (dx, dy). Returns the moved piece, or null if blocked.
 */
export function movePiece(board, piece, dx, dy) {
  const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return isValidPosition(board, moved) ? moved : null;
}

/**
 * Rotate a piece. direction: +1 = CW, -1 = CCW.
 * Includes wall kicks: tries shifting x by 0, +1, -1, +2, -2.
 * Returns the rotated piece, or null if no valid position found.
 */
export function rotatePiece(board, piece, direction) {
  const newRotation = ((piece.rotation + direction) % 4 + 4) % 4;
  const kicks = [0, 1, -1, 2, -2];

  for (const kick of kicks) {
    const candidate = { ...piece, rotation: newRotation, x: piece.x + kick };
    if (isValidPosition(board, candidate)) return candidate;
  }
  return null;
}

/**
 * Get the ghost position — piece dropped to the lowest valid row.
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
 * Hard drop: instantly drop piece to lowest valid position.
 * Returns { piece, distance }.
 */
export function hardDrop(board, piece) {
  const ghost = getGhostPosition(board, piece);
  return { piece: ghost, distance: ghost.y - piece.y };
}

// ─── Piece Spawning ─────────────────────────────────────────────

/**
 * Generate a shuffled bag of all 7 piece types (7-bag randomizer).
 */
export function generateBag() {
  const bag = [...PIECE_TYPES];
  // Fisher-Yates shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/**
 * Spawn a piece at the top of the board.
 * Returns piece at x=3, y=0, rotation=0; or null if blocked (game over).
 */
export function spawnPiece(board, type) {
  const piece = { type, rotation: 0, x: Math.floor((BOARD_COLS - 4) / 2), y: 0 };
  return isValidPosition(board, piece) ? piece : null;
}

// ─── Scoring ────────────────────────────────────────────────────

/**
 * Calculate score for cleared lines at a given level.
 * Uses NES-style LINE_SCORES * (level + 1).
 */
export function calculateScore(linesCleared, level) {
  if (linesCleared === 0) return 0;
  const base = LINE_SCORES[Math.min(linesCleared, 4)] || 0;
  return base * (level + 1);
}

/**
 * Get gravity interval in ms for a given level.
 * Starts at 1000ms, decreases per level, floor at 100ms.
 */
export function getGravityMs(level) {
  const ms = 1000 - level * 50;
  return Math.max(ms, 100);
}

// ─── Game State ─────────────────────────────────────────────────

/**
 * Create the initial Tetris game state.
 */
export function createTetrisState() {
  const bag = generateBag();
  const nextBag = generateBag();
  const board = createBoard();

  const currentType = bag.pop();
  const nextType = bag.pop();

  const currentPiece = spawnPiece(board, currentType);
  const nextPiece = { type: nextType, rotation: 0, x: Math.floor((BOARD_COLS - 4) / 2), y: 0 };

  return {
    phase: 'IDLE',
    board,
    currentPiece,
    nextPiece,
    bag,
    nextBag,
    score: 0,
    linesCleared: 0,
    level: 0,
    countdown: null,
  };
}

/**
 * Advance to the next piece from the bag.
 * Refills bag when depleted. Returns null for currentPiece if game over (blocked spawn).
 */
export function nextPieceFromBag(state) {
  const bag = [...state.bag];
  let nextBag = [...state.nextBag];

  // nextPiece becomes currentPiece
  const spawned = spawnPiece(state.board, state.nextPiece.type);
  if (spawned === null) {
    return { ...state, currentPiece: null, phase: 'GAME_OVER' };
  }

  // Draw next piece type from bag
  if (bag.length === 0) {
    // Swap in the nextBag, generate a fresh nextBag
    const refilled = [...nextBag];
    nextBag = generateBag();
    return {
      ...state,
      currentPiece: spawned,
      nextPiece: { type: refilled.pop(), rotation: 0, x: Math.floor((BOARD_COLS - 4) / 2), y: 0 },
      bag: refilled,
      nextBag,
    };
  }

  const nextType = bag.pop();
  return {
    ...state,
    currentPiece: spawned,
    nextPiece: { type: nextType, rotation: 0, x: Math.floor((BOARD_COLS - 4) / 2), y: 0 },
    bag,
    nextBag,
  };
}
