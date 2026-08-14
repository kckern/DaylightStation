export const CONNECT_FOUR_COLUMNS = 7;
export const CONNECT_FOUR_ROWS = 6;

const EMPTY = null;

export function createBoard() {
  return Array.from({ length: CONNECT_FOUR_ROWS }, () => Array(CONNECT_FOUR_COLUMNS).fill(EMPTY));
}

export function legalColumns(board) {
  if (!Array.isArray(board) || board.length !== CONNECT_FOUR_ROWS) return [];
  return board[0].flatMap((cell, column) => cell === EMPTY ? [column] : []);
}

function winningLine(board, player) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      if (board[row][column] !== player) continue;
      for (const [dx, dy] of directions) {
        const cells = Array.from({ length: 4 }, (_, offset) => ({
          row: row + dy * offset,
          column: column + dx * offset,
        }));
        if (cells.every(({ row: y, column: x }) => board[y]?.[x] === player)) return cells;
      }
    }
  }
  return null;
}

export function describeBoard(board) {
  for (const player of [1, 2]) {
    const line = winningLine(board, player);
    if (line) return { gameOver: true, winner: player, draw: false, winningCells: line };
  }
  const draw = legalColumns(board).length === 0;
  return { gameOver: draw, winner: null, draw, winningCells: [] };
}

export function dropDisc(board, column, player) {
  if (!Number.isInteger(column) || column < 0 || column >= CONNECT_FOUR_COLUMNS) {
    return { board, row: null, error: 'invalid_column' };
  }
  if (player !== 1 && player !== 2) return { board, row: null, error: 'invalid_player' };
  if (describeBoard(board).gameOver) return { board, row: null, error: 'game_over' };
  let row = CONNECT_FOUR_ROWS - 1;
  while (row >= 0 && board[row][column] !== EMPTY) row -= 1;
  if (row < 0) return { board, row: null, error: 'column_full' };
  const next = board.map((cells) => [...cells]);
  next[row][column] = player;
  return { board: next, row, error: null, status: describeBoard(next) };
}

export function replayGame(transcript = {}) {
  const moves = Array.isArray(transcript?.moves) ? transcript.moves : [];
  let board = createBoard();
  let turn = 1;
  for (let index = 0; index < moves.length; index += 1) {
    const result = dropDisc(board, moves[index], turn);
    if (result.error) return { valid: false, error: result.error, errorAt: index, board, turn, moves: moves.slice(0, index) };
    board = result.board;
    if (result.status.gameOver && index !== moves.length - 1) {
      return { valid: false, error: 'moves_after_game_over', errorAt: index + 1, board, turn, moves: moves.slice(0, index + 1) };
    }
    turn = turn === 1 ? 2 : 1;
  }
  return { valid: true, error: null, board, turn, moves: [...moves], status: describeBoard(board) };
}

export function playColumn(transcript, column) {
  const game = replayGame(transcript);
  if (!game.valid) return game;
  const result = dropDisc(game.board, column, game.turn);
  if (result.error) return { ...game, error: result.error };
  return {
    valid: true,
    error: null,
    board: result.board,
    turn: game.turn === 1 ? 2 : 1,
    moves: [...game.moves, column],
    status: result.status,
    lastMove: { column, row: result.row, player: game.turn },
  };
}

export default { createBoard, legalColumns, describeBoard, dropDisc, replayGame, playColumn };
