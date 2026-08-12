/**
 * The render-facing view of a position.
 *
 * FEN stays canonical in state; nothing downstream of the reducer should parse
 * it. A view gets a flat `{ e4: 'wP' }` map instead, and animates by diffing two
 * of those maps rather than by reading move objects. Diffing is what makes
 * undo, reload, and a spectator joining mid-game all animate correctly: they
 * have two positions but no move.
 *
 * The position-object and animation-diff shapes follow chessboard.js, so its
 * examples and idioms transfer. None of its code (or its jQuery) is used.
 */

export const FILES = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
export const RANKS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8']);

/** a8 first, h1 last — reading order for a board drawn from White's side. */
export const SQUARES = Object.freeze(
  [...RANKS].reverse().flatMap((rank) => FILES.map((file) => `${file}${rank}`)),
);

const SQUARE_RE = /^[a-h][1-8]$/;
const PIECE_RE = /^[wb][PNBRQK]$/;
const FEN_PIECES = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

export function isSquare(value) {
  return typeof value === 'string' && SQUARE_RE.test(value);
}

export function isPieceCode(value) {
  return typeof value === 'string' && PIECE_RE.test(value);
}

/** 'light' or 'dark'; null for anything that is not a square. */
export function squareColor(square) {
  if (!isSquare(square)) return null;
  const file = FILES.indexOf(square[0]);
  const rank = RANKS.indexOf(square[1]);
  return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

/** Chebyshev distance — the number of king moves between two squares. */
export function squareDistance(from, to) {
  if (!isSquare(from) || !isSquare(to)) return Infinity;
  return Math.max(
    Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])),
    Math.abs(RANKS.indexOf(from[1]) - RANKS.indexOf(to[1])),
  );
}

/** Squares in draw order for the given viewpoint. */
export function orderedSquares(orientation = 'white') {
  return orientation === 'black' ? [...SQUARES].reverse() : [...SQUARES];
}

/** FEN (full or bare placement field) -> `{ e4: 'wP' }`. Null when unparseable. */
export function fenToPosition(fen) {
  if (typeof fen !== 'string') return null;
  const placement = fen.trim().split(/\s+/)[0];
  const rows = placement.split('/');
  if (rows.length !== 8) return null;
  const position = {};
  for (const [index, row] of rows.entries()) {
    const rank = RANKS[7 - index];
    let file = 0;
    for (const symbol of row) {
      if (/[1-8]/.test(symbol)) {
        file += Number(symbol);
        continue;
      }
      const type = FEN_PIECES[symbol.toLowerCase()];
      if (!type || file > 7) return null;
      position[`${FILES[file]}${rank}`] = `${symbol === symbol.toUpperCase() ? 'w' : 'b'}${type}`;
      file += 1;
    }
    if (file !== 8) return null;
  }
  return position;
}

/** `{ e4: 'wP' }` -> the FEN placement field only (no turn, castling, or clocks). */
export function positionToFen(position) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) return null;
  const rows = [];
  for (const rank of [...RANKS].reverse()) {
    let row = '';
    let empty = 0;
    for (const file of FILES) {
      const piece = position[`${file}${rank}`];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (!isPieceCode(piece)) return null;
      if (empty) {
        row += String(empty);
        empty = 0;
      }
      row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1].toLowerCase();
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

/**
 * Diffs two positions into render operations: `move`, `add`, `clear`.
 *
 * Each destination claims the nearest identical piece as its origin, ties broken
 * by square name so the output is deterministic and safe to snapshot in tests.
 * Whatever is left over is a spawn or a capture.
 *
 * Note: a promotion whose new piece type also moved elsewhere in the same diff
 * can pair the wrong origin. That mis-animates a single frame and never touches
 * game state, which is why the trade for determinism is worth making here.
 */
export function diffPositions(before, after) {
  const from = { ...(before || {}) };
  const to = { ...(after || {}) };

  for (const square of Object.keys(to).sort()) {
    if (from[square] === to[square]) {
      delete from[square];
      delete to[square];
    }
  }

  const operations = [];
  for (const square of Object.keys(to).sort()) {
    const piece = to[square];
    const origin = Object.keys(from)
      .filter((candidate) => from[candidate] === piece)
      .sort((a, b) => squareDistance(square, a) - squareDistance(square, b) || a.localeCompare(b))[0];
    if (!origin) continue;
    operations.push({ type: 'move', piece, from: origin, to: square });
    delete from[origin];
    delete to[square];
  }

  for (const square of Object.keys(to).sort()) operations.push({ type: 'add', piece: to[square], to: square });
  for (const square of Object.keys(from).sort()) operations.push({ type: 'clear', piece: from[square], from: square });
  return operations;
}

/** Material still on the board, keyed by piece code. */
export function countMaterial(position) {
  const counts = {};
  for (const piece of Object.values(position || {})) {
    if (isPieceCode(piece)) counts[piece] = (counts[piece] || 0) + 1;
  }
  return counts;
}
