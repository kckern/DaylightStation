import { describe, it, expect } from 'vitest';
import {
  PIECES,
  PIECE_TYPES,
  BOARD_ROWS,
  BOARD_COLS,
  LINE_SCORES,
  createBoard,
  getPieceCells,
  isValidPosition,
  lockPiece,
  clearLines,
  movePiece,
  rotatePiece,
  getGhostPosition,
  hardDrop,
  generateBag,
  spawnPiece,
  calculateScore,
  getGravityMs,
  createTetrisState,
  nextPieceFromBag,
} from './tetrisEngine.js';

// ─── createBoard ────────────────────────────────────────────────

describe('createBoard', () => {
  it('creates a 20x10 grid of nulls', () => {
    const board = createBoard();
    expect(board.length).toBe(20);
    expect(board[0].length).toBe(10);
    for (const row of board) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });
});

// ─── getPieceCells ──────────────────────────────────────────────

describe('getPieceCells', () => {
  it('returns absolute positions offset by piece position', () => {
    const piece = { type: 'O', rotation: 0, x: 3, y: 5 };
    const cells = getPieceCells(piece);
    // O-piece rotation 0: [[0,0],[0,1],[1,0],[1,1]]
    expect(cells).toEqual([
      [5, 3], [5, 4], [6, 3], [6, 4],
    ]);
  });

  it('handles different rotations', () => {
    const piece = { type: 'T', rotation: 0, x: 0, y: 0 };
    const cells = getPieceCells(piece);
    // T-piece rotation 0: [[0,0],[0,1],[0,2],[1,1]]
    expect(cells).toEqual([
      [0, 0], [0, 1], [0, 2], [1, 1],
    ]);
  });
});

// ─── isValidPosition ────────────────────────────────────────────

describe('isValidPosition', () => {
  it('accepts a valid position on empty board', () => {
    const board = createBoard();
    const piece = { type: 'T', rotation: 0, x: 3, y: 0 };
    expect(isValidPosition(board, piece)).toBe(true);
  });

  it('rejects piece out of bounds (left)', () => {
    const board = createBoard();
    const piece = { type: 'T', rotation: 0, x: -1, y: 0 };
    expect(isValidPosition(board, piece)).toBe(false);
  });

  it('rejects piece out of bounds (right)', () => {
    const board = createBoard();
    const piece = { type: 'I', rotation: 0, x: 8, y: 0 };
    // I-piece rotation 0 spans cols 8,9,10,11 — col 10+ is out
    expect(isValidPosition(board, piece)).toBe(false);
  });

  it('rejects piece out of bounds (bottom)', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 19 };
    // O-piece occupies rows 19 and 20 — row 20 is out
    expect(isValidPosition(board, piece)).toBe(false);
  });

  it('rejects collision with existing cells', () => {
    const board = createBoard();
    board[0][3] = { type: 'I' };
    const piece = { type: 'T', rotation: 0, x: 3, y: 0 };
    // T-piece at (3,0) occupies [0,3] which is filled
    expect(isValidPosition(board, piece)).toBe(false);
  });
});

// ─── lockPiece ──────────────────────────────────────────────────

describe('lockPiece', () => {
  it('places piece cells on the board', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 0 };
    const newBoard = lockPiece(board, piece);
    expect(newBoard[0][0]).toEqual({ type: 'O' });
    expect(newBoard[0][1]).toEqual({ type: 'O' });
    expect(newBoard[1][0]).toEqual({ type: 'O' });
    expect(newBoard[1][1]).toEqual({ type: 'O' });
  });

  it('does not mutate the original board', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 0 };
    lockPiece(board, piece);
    expect(board[0][0]).toBeNull();
    expect(board[0][1]).toBeNull();
  });
});

// ─── clearLines ─────────────────────────────────────────────────

describe('clearLines', () => {
  it('clears a full row and shifts down', () => {
    const board = createBoard();
    // Fill bottom row completely
    for (let col = 0; col < BOARD_COLS; col++) {
      board[BOARD_ROWS - 1][col] = { type: 'I' };
    }
    // Place a cell on the row above
    board[BOARD_ROWS - 2][0] = { type: 'T' };

    const result = clearLines(board);
    expect(result.linesCleared).toBe(1);
    // The T cell that was at row 18 should now be at row 19 (shifted down)
    expect(result.board[BOARD_ROWS - 1][0]).toEqual({ type: 'T' });
    // Top row should be empty
    expect(result.board[0].every(c => c === null)).toBe(true);
  });

  it('returns 0 lines cleared when nothing to clear', () => {
    const board = createBoard();
    board[BOARD_ROWS - 1][0] = { type: 'I' };
    const result = clearLines(board);
    expect(result.linesCleared).toBe(0);
    expect(result.board).toBe(board); // same reference — no mutation
  });

  it('clears multiple full rows', () => {
    const board = createBoard();
    for (let col = 0; col < BOARD_COLS; col++) {
      board[BOARD_ROWS - 1][col] = { type: 'I' };
      board[BOARD_ROWS - 2][col] = { type: 'I' };
    }
    const result = clearLines(board);
    expect(result.linesCleared).toBe(2);
    expect(result.board.length).toBe(BOARD_ROWS);
  });
});

// ─── movePiece ──────────────────────────────────────────────────

describe('movePiece', () => {
  it('moves piece by dx, dy', () => {
    const board = createBoard();
    const piece = { type: 'T', rotation: 0, x: 3, y: 0 };
    const moved = movePiece(board, piece, 1, 1);
    expect(moved).toEqual({ type: 'T', rotation: 0, x: 4, y: 1 });
  });

  it('returns null when move is blocked', () => {
    const board = createBoard();
    const piece = { type: 'T', rotation: 0, x: 0, y: 0 };
    const moved = movePiece(board, piece, -1, 0);
    expect(moved).toBeNull();
  });

  it('returns null when move collides with locked piece', () => {
    const board = createBoard();
    board[1][4] = { type: 'I' };
    const piece = { type: 'T', rotation: 0, x: 3, y: 0 };
    // T at (3,0) has cell at [1,4]. Moving down would put it at [2,4] — but [1,4] is already the T cell
    // Actually T rotation 0 at x=3,y=0: cells [0,3],[0,4],[0,5],[1,4]
    // Cell [1,4] is occupied, so the piece can't be placed there at all
    // Let's test moving down: at y=1, cells would be [1,3],[1,4],[1,5],[2,4]
    // [1,4] is occupied, so move down should fail
    const moved = movePiece(board, piece, 0, 1);
    expect(moved).toBeNull();
  });
});

// ─── rotatePiece ────────────────────────────────────────────────

describe('rotatePiece', () => {
  it('rotates CW (+1)', () => {
    const board = createBoard();
    const piece = { type: 'T', rotation: 0, x: 4, y: 5 };
    const rotated = rotatePiece(board, piece, 1);
    expect(rotated).not.toBeNull();
    expect(rotated.rotation).toBe(1);
  });

  it('applies wall kicks when rotation near left wall', () => {
    const board = createBoard();
    // T rotation 3 has offsets [[0,0],[1,0],[2,0],[1,-1]]
    // At x=0, rotation 3 would put a cell at col -1 which is invalid
    // But with wall kick +1, x becomes 1, making col 0 valid
    const piece = { type: 'T', rotation: 2, x: 0, y: 5 };
    const rotated = rotatePiece(board, piece, 1);
    // Should succeed via wall kick
    expect(rotated).not.toBeNull();
    expect(rotated.rotation).toBe(3);
    expect(rotated.x).toBeGreaterThanOrEqual(0);
  });

  it('returns null if no valid rotation exists', () => {
    // Create a nearly full board where rotation is impossible
    const board = createBoard();
    // Fill columns around the piece so no kick works
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        board[row][col] = { type: 'X' };
      }
    }
    // Clear just enough for the piece but not for rotation
    board[0][4] = null;
    board[0][5] = null;
    board[0][6] = null;
    board[1][5] = null;
    const piece = { type: 'T', rotation: 0, x: 4, y: 0 };
    const rotated = rotatePiece(board, piece, 1);
    // T rotation 1 at x=4: [[0,4],[1,4],[2,4],[1,5]] — rows 1,2 cols 4,5 are filled
    expect(rotated).toBeNull();
  });
});

// ─── getGhostPosition ──────────────────────────────────────────

describe('getGhostPosition', () => {
  it('drops piece to the bottom of an empty board', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 0 };
    const ghost = getGhostPosition(board, piece);
    // O piece is 2 rows tall, so bottom is row 18-19
    expect(ghost.y).toBe(18);
    expect(ghost.x).toBe(0);
  });

  it('stops above existing pieces', () => {
    const board = createBoard();
    board[10][0] = { type: 'I' };
    const piece = { type: 'O', rotation: 0, x: 0, y: 0 };
    const ghost = getGhostPosition(board, piece);
    // O at x=0 occupies cols 0,1 rows y, y+1. Row 10 col 0 is filled.
    // So ghost lands at y=8 (rows 8,9 — just above row 10)
    expect(ghost.y).toBe(8);
  });
});

// ─── hardDrop ───────────────────────────────────────────────────

describe('hardDrop', () => {
  it('returns dropped piece and distance', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 0 };
    const result = hardDrop(board, piece);
    expect(result.piece.y).toBe(18);
    expect(result.distance).toBe(18);
  });

  it('returns distance 0 when already at bottom', () => {
    const board = createBoard();
    const piece = { type: 'O', rotation: 0, x: 0, y: 18 };
    const result = hardDrop(board, piece);
    expect(result.piece.y).toBe(18);
    expect(result.distance).toBe(0);
  });
});

// ─── generateBag ────────────────────────────────────────────────

describe('generateBag', () => {
  it('contains all 7 piece types', () => {
    const bag = generateBag();
    expect(bag.length).toBe(7);
    expect([...bag].sort()).toEqual([...PIECE_TYPES].sort());
  });

  it('is a permutation (no duplicates)', () => {
    const bag = generateBag();
    const unique = new Set(bag);
    expect(unique.size).toBe(7);
  });
});

// ─── spawnPiece ─────────────────────────────────────────────────

describe('spawnPiece', () => {
  it('spawns at x=3, y=0, rotation=0', () => {
    const board = createBoard();
    const piece = spawnPiece(board, 'T');
    expect(piece).toEqual({ type: 'T', rotation: 0, x: 3, y: 0 });
  });

  it('returns null when spawn position is blocked (game over)', () => {
    const board = createBoard();
    // Fill row 0 around the spawn area
    for (let col = 0; col < BOARD_COLS; col++) {
      board[0][col] = { type: 'I' };
    }
    const piece = spawnPiece(board, 'T');
    expect(piece).toBeNull();
  });
});

// ─── calculateScore ─────────────────────────────────────────────

describe('calculateScore', () => {
  it('scores a single line at level 0', () => {
    expect(calculateScore(1, 0)).toBe(100);
  });

  it('scores a Tetris (4 lines) at level 0', () => {
    expect(calculateScore(4, 0)).toBe(800);
  });

  it('multiplies by (level + 1)', () => {
    expect(calculateScore(1, 5)).toBe(100 * 6);
    expect(calculateScore(4, 3)).toBe(800 * 4);
  });

  it('returns 0 for 0 lines cleared', () => {
    expect(calculateScore(0, 5)).toBe(0);
  });
});

// ─── getGravityMs ───────────────────────────────────────────────

describe('getGravityMs', () => {
  it('starts at 1000ms for level 0', () => {
    expect(getGravityMs(0)).toBe(1000);
  });

  it('decreases per level', () => {
    expect(getGravityMs(1)).toBe(950);
    expect(getGravityMs(5)).toBe(750);
  });

  it('floors at 100ms', () => {
    expect(getGravityMs(18)).toBe(100);
    expect(getGravityMs(20)).toBe(100);
    expect(getGravityMs(100)).toBe(100);
  });
});

// ─── createTetrisState ──────────────────────────────────────────

describe('createTetrisState', () => {
  it('creates a valid initial state', () => {
    const state = createTetrisState();
    expect(state.phase).toBe('IDLE');
    expect(state.board.length).toBe(BOARD_ROWS);
    expect(state.board[0].length).toBe(BOARD_COLS);
    expect(state.currentPiece).not.toBeNull();
    expect(state.nextPiece).not.toBeNull();
    expect(PIECE_TYPES).toContain(state.currentPiece.type);
    expect(PIECE_TYPES).toContain(state.nextPiece.type);
    expect(state.score).toBe(0);
    expect(state.linesCleared).toBe(0);
    expect(state.level).toBe(0);
    expect(state.countdown).toBeNull();
    // Bag should have 5 remaining (7 - 2 drawn)
    expect(state.bag.length).toBe(5);
    expect(state.nextBag.length).toBe(7);
  });
});

// ─── nextPieceFromBag ───────────────────────────────────────────

describe('nextPieceFromBag', () => {
  it('advances current piece from next piece', () => {
    const state = createTetrisState();
    const nextType = state.nextPiece.type;
    const updated = nextPieceFromBag(state);
    expect(updated.currentPiece.type).toBe(nextType);
    expect(updated.nextPiece).not.toBeNull();
    expect(PIECE_TYPES).toContain(updated.nextPiece.type);
  });

  it('refills bag when depleted', () => {
    const state = createTetrisState();
    // Drain the bag
    let s = state;
    // Bag starts with 5 items. Each nextPieceFromBag pops one more.
    // After 5 calls the bag is empty, next call should refill from nextBag.
    for (let i = 0; i < 5; i++) {
      s = nextPieceFromBag(s);
    }
    expect(s.bag.length).toBe(0);
    // Next call should swap in nextBag
    const refilled = nextPieceFromBag(s);
    expect(refilled.bag.length).toBeGreaterThan(0);
    expect(refilled.nextBag.length).toBe(7);
  });

  it('returns null currentPiece (game over) when spawn is blocked', () => {
    const state = createTetrisState();
    // Fill the top rows to block spawning
    const board = state.board.map(row => [...row]);
    for (let col = 0; col < BOARD_COLS; col++) {
      board[0][col] = { type: 'X' };
      board[1][col] = { type: 'X' };
    }
    const blocked = { ...state, board };
    const result = nextPieceFromBag(blocked);
    expect(result.currentPiece).toBeNull();
    expect(result.phase).toBe('GAME_OVER');
  });
});
