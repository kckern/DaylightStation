export const CHECKERS_SIZE = 8;
export const PLAYABLE_SQUARES = 32;
export const DRAW_QUIET_PLY = 80;

const PLAYER_ONE = new Set(['r', 'R']);
const PLAYER_TWO = new Set(['b', 'B']);

export function indexToCoord(index) {
  if (!Number.isInteger(index) || index < 0 || index >= PLAYABLE_SQUARES) return null;
  const row = Math.floor(index / 4);
  const column = (index % 4) * 2 + ((row + 1) % 2);
  return { row, column };
}

export function coordToIndex(row, column) {
  if (!Number.isInteger(row) || !Number.isInteger(column)
    || row < 0 || row >= CHECKERS_SIZE || column < 0 || column >= CHECKERS_SIZE
    || (row + column) % 2 !== 1) return null;
  return row * 4 + Math.floor(column / 2);
}

export function createBoard() {
  return Array.from({ length: PLAYABLE_SQUARES }, (_, index) => {
    const { row } = indexToCoord(index);
    if (row <= 2) return 'b';
    if (row >= 5) return 'r';
    return null;
  });
}

export function ownerOf(piece) {
  if (PLAYER_ONE.has(piece)) return 1;
  if (PLAYER_TWO.has(piece)) return 2;
  return null;
}

function directionsFor(piece) {
  if (piece === 'R' || piece === 'B') return [-1, 1];
  return piece === 'r' ? [-1] : piece === 'b' ? [1] : [];
}

function movesFrom(board, from, capturesOnly = false) {
  const piece = board[from];
  if (!piece) return [];
  const origin = indexToCoord(from);
  const moves = [];
  for (const rowDirection of directionsFor(piece)) {
    for (const columnDirection of [-1, 1]) {
      const adjacent = coordToIndex(origin.row + rowDirection, origin.column + columnDirection);
      if (adjacent === null) continue;
      if (!board[adjacent] && !capturesOnly) {
        moves.push({ from, to: adjacent, capture: null });
        continue;
      }
      if (ownerOf(board[adjacent]) === ownerOf(piece)) continue;
      const landing = coordToIndex(origin.row + rowDirection * 2, origin.column + columnDirection * 2);
      if (landing !== null && !board[landing] && board[adjacent]) {
        moves.push({ from, to: landing, capture: adjacent });
      }
    }
  }
  return moves;
}

export function legalMoves(board, player, forcedFrom = null) {
  if (!Array.isArray(board) || board.length !== PLAYABLE_SQUARES) return [];
  const owned = board.flatMap((piece, index) => ownerOf(piece) === player ? [index] : []);
  const sources = forcedFrom === null ? owned : owned.filter((index) => index === forcedFrom);
  const captures = sources.flatMap((from) => movesFrom(board, from, true)).filter((move) => move.capture !== null);
  if (captures.length || forcedFrom !== null) return captures;
  return sources.flatMap((from) => movesFrom(board, from, false));
}

export function describeGame({ board, turn, forcedFrom = null, quietPly = 0 }) {
  const onePieces = board.filter((piece) => ownerOf(piece) === 1).length;
  const twoPieces = board.filter((piece) => ownerOf(piece) === 2).length;
  if (!onePieces) return { gameOver: true, winner: 2, draw: false, outcome: 'no_pieces' };
  if (!twoPieces) return { gameOver: true, winner: 1, draw: false, outcome: 'no_pieces' };
  if (quietPly >= DRAW_QUIET_PLY) return { gameOver: true, winner: null, draw: true, outcome: 'quiet_draw' };
  if (legalMoves(board, turn, forcedFrom).length === 0) {
    return { gameOver: true, winner: turn === 1 ? 2 : 1, draw: false, outcome: 'no_moves' };
  }
  return { gameOver: false, winner: null, draw: false, outcome: null };
}

export function createGame() {
  const game = { board: createBoard(), turn: 1, forcedFrom: null, quietPly: 0, moves: [] };
  return { ...game, status: describeGame(game), valid: true, error: null };
}

export function applyMove(game, requestedMove) {
  if (game.status?.gameOver) return { ...game, error: 'game_over' };
  const from = Number(requestedMove?.from);
  const to = Number(requestedMove?.to);
  const move = legalMoves(game.board, game.turn, game.forcedFrom)
    .find((candidate) => candidate.from === from && candidate.to === to);
  if (!move) return { ...game, error: 'illegal_move' };

  const board = [...game.board];
  let piece = board[from];
  board[from] = null;
  board[to] = piece;
  if (move.capture !== null) board[move.capture] = null;
  const destination = indexToCoord(to);
  const promoted = (piece === 'r' && destination.row === 0) || (piece === 'b' && destination.row === 7);
  if (promoted) {
    piece = piece.toUpperCase();
    board[to] = piece;
  }

  // In American checkers, crowning ends the move even if the new king could jump.
  const moreCaptures = move.capture !== null && !promoted
    ? movesFrom(board, to, true).filter((candidate) => candidate.capture !== null)
    : [];
  const forcedFrom = moreCaptures.length ? to : null;
  const turn = forcedFrom === null ? (game.turn === 1 ? 2 : 1) : game.turn;
  const quietPly = move.capture !== null || promoted ? 0 : game.quietPly + 1;
  const next = {
    board,
    turn,
    forcedFrom,
    quietPly,
    moves: [...game.moves, { from, to }],
    lastMove: { ...move, player: game.turn, promoted },
    valid: true,
    error: null,
  };
  return { ...next, status: describeGame(next) };
}

export function replayGame(transcript = {}) {
  const moves = Array.isArray(transcript?.moves) ? transcript.moves : [];
  let game = createGame();
  for (let index = 0; index < moves.length; index += 1) {
    const next = applyMove(game, moves[index]);
    if (next.error) return { ...game, valid: false, error: next.error, errorAt: index };
    game = next;
  }
  return game;
}

export default {
  CHECKERS_SIZE, PLAYABLE_SQUARES, indexToCoord, coordToIndex, createBoard,
  ownerOf, legalMoves, describeGame, createGame, applyMove, replayGame,
};
