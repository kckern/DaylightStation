import { expect, test } from 'vitest';
import { createBoard, describeBoard, dropDisc, replayGame } from './engine.mjs';
import { chooseColumn, CONNECT_FOUR_OPPONENTS } from './opponent.mjs';

const LEVELS = CONNECT_FOUR_OPPONENTS.map((opponent) => opponent.depth);

/** Play a position out between two rungs; returns the winner (1 red, 2 yellow). */
function playFrom(moves, levelRed, levelYellow) {
  const start = replayGame({ moves });
  let board = start.board;
  let turn = start.turn;
  for (let ply = 0; ply < 42; ply += 1) {
    const column = chooseColumn(board, { player: turn, level: turn === 1 ? levelRed : levelYellow });
    if (column === null) break;
    const result = dropDisc(board, column, turn);
    if (result.error) throw new Error(`illegal column ${column}: ${result.error}`);
    board = result.board;
    if (describeBoard(board).gameOver) break;
    turn = turn === 1 ? 2 : 1;
  }
  return describeBoard(board).winner;
}

test('every rung opens in the centre, never on an edge', () => {
  // The ladder is a difficulty ladder, not a tour of the seven columns. `level`
  // used to rotate the preference list, so rung 7 opened on column 6 and
  // stacked four discs there while the child read notes — the reported bug.
  for (const level of LEVELS) {
    expect(chooseColumn(createBoard(), { player: 2, level }), `level ${level} opening`).toBe(3);
  }
});

test('no rung parks in the far right column when the centre is free', () => {
  const board = replayGame({ moves: [3] }).board;
  for (const level of LEVELS) {
    expect(chooseColumn(board, { player: 2, level }), `level ${level} reply to the centre`).not.toBe(6);
  }
});

test('every rung still takes an immediate win and blocks one', () => {
  const win = replayGame({ moves: [1, 0, 1, 0, 2, 0, 2] });
  const block = replayGame({ moves: [0, 1, 0, 1, 0] });
  for (const level of LEVELS) {
    expect(chooseColumn(win.board, { player: 2, level }), `level ${level} win`).toBe(0);
    expect(chooseColumn(block.board, { player: 2, level }), `level ${level} block`).toBe(0);
  }
});

test('depth changes the move, and the shallow move is the losing one', () => {
  // Same position, same red opponent, same seat — the ONLY difference is the
  // yellow rung's search depth, and it flips the result. This is what `level`
  // is supposed to buy; the rotation bought a different column and nothing else.
  const position = [3, 3, 2];
  expect(chooseColumn(replayGame({ moves: position }).board, { player: 2, level: 1 })).toBe(3);
  expect(chooseColumn(replayGame({ moves: position }).board, { player: 2, level: 7 })).toBe(4);
  expect(playFrom(position, 7, 1), 'rung 1 as yellow against rung 7').toBe(1);
  expect(playFrom(position, 7, 7), 'rung 7 as yellow against rung 7').toBe(2);
});

test('the ladder is monotonic: the deeper rung beats the shallower one from both seats', () => {
  for (const [shallow, deep] of [[1, 4], [1, 7], [4, 7], [2, 5], [3, 6]]) {
    expect(playFrom([], shallow, deep), `rung ${deep} as yellow vs rung ${shallow}`).toBe(2);
    expect(playFrom([], deep, shallow), `rung ${deep} as red vs rung ${shallow}`).toBe(1);
  }
});

test('every rung answers well inside the adapter budget', () => {
  // The worker times out at 1000ms and hands the search back to the BACKEND'S
  // MAIN THREAD; the piano tablet runs the same function locally when the
  // request fails, on a much slower CPU. Measured worst case is ~254ms at rung
  // 7 — it was 2.2 SECONDS before the search moved off the engine's board
  // copies. The ceiling is deliberately loose: this runs inside a full-sweep
  // gate where a starved worker can take several times its solo wall-clock, and
  // a perf test that flakes under load gets normalised away instead of read.
  // It still catches the regression it exists for by an order of magnitude.
  const seeds = [[3, 3], [3, 3, 4, 4]];
  for (const moves of seeds) {
    const game = replayGame({ moves });
    const startedAt = Date.now();
    chooseColumn(game.board, { player: game.turn, level: 7 });
    const elapsed = Date.now() - startedAt;
    expect(elapsed, `rung 7 after [${moves.join(',')}] took ${elapsed}ms`).toBeLessThan(900);
  }
});

test('hints search for red without inheriting the opponent seat', () => {
  // The hint calls the same function with player 1; it must reason for red.
  const board = replayGame({ moves: [3, 3, 4, 4, 5] }).board;
  const hint = chooseColumn(board, { player: 1, level: 5 });
  const result = dropDisc(board, hint, 1);
  expect(result.error).toBe(null);
  expect(describeBoard(result.board).winner, `hint ${hint}`).toBe(1);
});

test('a full column is never offered, and a finished board yields null', () => {
  const stacked = replayGame({ moves: [0, 0, 0, 0, 0, 0] }).board;
  for (const level of LEVELS) {
    expect(chooseColumn(stacked, { player: 2, level }), `level ${level} on a full column`).not.toBe(0);
  }
  const full = createBoard().map((cells, row) => cells.map((_, column) => ((row + column) % 2 ? 1 : 2)));
  expect(chooseColumn(full, { player: 2, level: 4 })).toBe(null);
});

test('an unknown or missing level still plays the centre rather than throwing', () => {
  for (const level of [undefined, null, 0, -3, 'hard', 99]) {
    expect(chooseColumn(createBoard(), { player: 2, level }), `level ${String(level)}`).toBe(3);
  }
});
