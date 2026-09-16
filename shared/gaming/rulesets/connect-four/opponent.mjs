import {
  CONNECT_FOUR_COLUMNS, CONNECT_FOUR_ROWS, legalColumns,
} from './engine.mjs';

// These are mechanics-only difficulty profiles. Environments may merge them
// with names, artwork, and themes loaded from mounted configuration.
const CONNECT_FOUR_CHARACTERS = [
  ['diglett', 'Diglett', '0050-diglett-gen1.svg'],
  ['psyduck', 'Psyduck', '0054-psyduck-gen1.svg'],
  ['magnemite', 'Magnemite', '0081-magnemite-gen1.svg'],
  ['porygon', 'Porygon', '0137-porygon-gen1.svg'],
  ['gengar', 'Gengar', '0094-gengar-gen1.svg'],
  ['dragonite', 'Dragonite', '0149-dragonite-gen1.svg'],
  ['mew', 'Mew', '0151-mew-gen1.svg'],
];
export const CONNECT_FOUR_OPPONENTS = Object.freeze(CONNECT_FOUR_CHARACTERS.map(([id, name, art], index) => Object.freeze({
  id, name, art: `/api/v1/static/img/pokemon/${art}`, theme: null, depth: index + 1,
  dialogue: Object.freeze({
    persona: `${name} is a warm, competitive Connect Four opponent.`,
    voice: 'React briefly to threats, blocks, and connected lines.',
    lore: Object.freeze({ type: [], references: [], known_references: [], use: 'never' }),
  }),
})));

// Centre-first, at EVERY level. This list is move ORDER — the shape that makes
// alpha-beta cut early, and the tie-break when two columns score the same. It
// is not a difficulty dial: until 2026-09-16 `level` rotated this list, so the
// TOP rung opened on column 6 and stacked four discs there while the child read
// notes, losing to the bottom rung. Strength lives in `depth`, which is what
// the ladder's own `depth: index + 1` always claimed it was.
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const ROWS = CONNECT_FOUR_ROWS;
const COLUMNS = CONNECT_FOUR_COLUMNS;
const CELLS = ROWS * COLUMNS;
const MAX_DEPTH = 7;
const WIN_SCORE = 1_000_000;
/** Value of an unblocked window holding n of one player's discs. */
const SHAPE = [0, 1, 12, 60, WIN_SCORE];

const other = (player) => (player === 1 ? 2 : 1);

/** Every 4-cell line on the board, as flat indices, computed once. */
const WINDOWS = (() => {
  const windows = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      for (const [dy, dx] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const cells = [];
        for (let offset = 0; offset < 4; offset += 1) {
          const y = row + dy * offset;
          const x = column + dx * offset;
          if (y < 0 || y >= ROWS || x < 0 || x >= COLUMNS) break;
          cells.push(y * COLUMNS + x);
        }
        if (cells.length === 4) windows.push(cells);
      }
    }
  }
  return windows;
})();

/**
 * The search runs on a flat board it mutates and un-mutates, NOT on the
 * engine's nested arrays.
 *
 * The engine's `dropDisc` copies the whole board and rescans all 69 lines for a
 * winner on every call; at seven plies of lookahead that cost put the top rung
 * at 2.2 SECONDS a move — past the adapter's 1000ms worker timeout (which
 * drops the work back onto the backend's main thread) and far past what the
 * piano tablet can do in its local fallback without freezing. Placing a disc
 * here is two writes, and only the lines through that disc are checked.
 */
function toFlat(board) {
  const flat = new Int8Array(CELLS);
  const heights = new Int8Array(COLUMNS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const cell = board[row]?.[column];
      if (cell === 1 || cell === 2) {
        flat[row * COLUMNS + column] = cell;
        heights[column] += 1;
      }
    }
  }
  return { flat, heights };
}

/** Does the disc just placed at (row, column) complete a four? */
function wins(flat, row, column, player) {
  for (const [dy, dx] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [1, -1]) {
      let y = row + dy * sign;
      let x = column + dx * sign;
      while (y >= 0 && y < ROWS && x >= 0 && x < COLUMNS && flat[y * COLUMNS + x] === player) {
        count += 1;
        y += dy * sign;
        x += dx * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

/**
 * How good this board looks for `me` short of a finished four.
 *
 * Counts open lines: a window holding only my discs is worth more the fuller it
 * is, a window holding only theirs costs the same, and a contested window is
 * dead for both. The centre column is worth a little on its own because it
 * takes part in more lines than any other column.
 */
function evaluate(flat, me) {
  let score = 0;
  for (const cells of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const index of cells) {
      const cell = flat[index];
      if (cell === me) mine += 1;
      else if (cell) theirs += 1;
    }
    if (mine && theirs) continue;
    if (mine) score += SHAPE[mine];
    else if (theirs) score -= SHAPE[theirs];
  }
  for (let row = 0; row < ROWS; row += 1) {
    const cell = flat[row * COLUMNS + 3];
    if (cell) score += cell === me ? 3 : -3;
  }
  return score;
}

/** Minimax with alpha-beta, shaped like the checkers opponent next door. */
function search(flat, heights, depth, turn, rootPlayer, alpha, beta, filled) {
  const maximizing = turn === rootPlayer;
  let best = maximizing ? -Infinity : Infinity;
  let alphaCut = alpha;
  let betaCut = beta;
  let played = false;
  for (const column of ORDER) {
    if (heights[column] >= ROWS) continue;
    const row = ROWS - 1 - heights[column];
    const index = row * COLUMNS + column;
    flat[index] = turn;
    heights[column] += 1;
    played = true;
    let score;
    if (wins(flat, row, column, turn)) {
      // Prefer the faster win and the slower loss: deeper nodes score lower.
      score = turn === rootPlayer ? WIN_SCORE + depth : -(WIN_SCORE + depth);
    } else if (filled + 1 >= CELLS) {
      score = 0;
    } else if (depth <= 1) {
      score = evaluate(flat, rootPlayer);
    } else {
      score = search(flat, heights, depth - 1, other(turn), rootPlayer, alphaCut, betaCut, filled + 1);
    }
    flat[index] = 0;
    heights[column] -= 1;
    if (maximizing) {
      if (score > best) best = score;
      if (best > alphaCut) alphaCut = best;
    } else {
      if (score < best) best = score;
      if (best < betaCut) betaCut = best;
    }
    if (betaCut <= alphaCut) break;
  }
  return played ? best : evaluate(flat, rootPlayer);
}

/** The first column in centre-first order that wins outright for `player`. */
function immediate(flat, heights, player) {
  for (const column of ORDER) {
    if (heights[column] >= ROWS) continue;
    const row = ROWS - 1 - heights[column];
    const index = row * COLUMNS + column;
    flat[index] = player;
    const won = wins(flat, row, column, player);
    flat[index] = 0;
    if (won) return column;
  }
  return null;
}

/**
 * Deterministic local teaching partner: win, block, then search `level` plies.
 *
 * Win and block stay in front of the search so the shallowest rung still plays
 * the two moves a child expects any opponent to see, and so rung 1 stays the
 * gentle one — a single ply of lookahead and a preference for the middle.
 */
export function chooseColumn(board, { player = 2, level = 1 } = {}) {
  const legal = new Set(legalColumns(board));
  if (!legal.size) return null;
  const seat = player === 1 ? 1 : 2;
  const { flat, heights } = toFlat(board);
  const filled = heights.reduce((total, height) => total + height, 0);
  const winning = immediate(flat, heights, seat);
  if (winning !== null) return winning;
  const blocking = immediate(flat, heights, other(seat));
  if (blocking !== null) return blocking;
  const centreFirst = ORDER.find((column) => legal.has(column)) ?? null;
  const depth = Math.min(MAX_DEPTH, Math.max(1, Number(level) || 1));
  if (depth <= 1) return centreFirst;
  let bestColumn = null;
  let bestScore = -Infinity;
  for (const column of ORDER) {
    if (!legal.has(column) || heights[column] >= ROWS) continue;
    const row = ROWS - 1 - heights[column];
    const index = row * COLUMNS + column;
    flat[index] = seat;
    heights[column] += 1;
    const score = filled + 1 >= CELLS
      ? 0
      : search(flat, heights, depth - 1, other(seat), seat, -Infinity, Infinity, filled + 1);
    flat[index] = 0;
    heights[column] -= 1;
    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }
  return bestColumn ?? centreFirst;
}

export default { CONNECT_FOUR_OPPONENTS, chooseColumn };
