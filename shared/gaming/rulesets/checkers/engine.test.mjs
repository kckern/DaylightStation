import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, coordToIndex, createGame, indexToCoord, legalMoves, replayGame } from './engine.mjs';
import { chooseMove } from './opponent.mjs';

test('maps all 32 playable squares bijectively', () => {
  for (let index = 0; index < 32; index += 1) {
    const { row, column } = indexToCoord(index);
    assert.equal(coordToIndex(row, column), index);
  }
});

test('starts with twelve pieces per player and seven legal opening moves', () => {
  const game = createGame();
  assert.equal(game.board.filter((piece) => piece === 'r').length, 12);
  assert.equal(game.board.filter((piece) => piece === 'b').length, 12);
  assert.equal(legalMoves(game.board, 1).length, 7);
});

test('enforces captures globally and continues a multiple jump', () => {
  const game = {
    ...createGame(),
    board: Array(32).fill(null),
    turn: 1,
  };
  game.board[coordToIndex(5, 0)] = 'r';
  game.board[coordToIndex(4, 1)] = 'b';
  game.board[coordToIndex(2, 3)] = 'b';
  game.status = { gameOver: false };
  const first = applyMove(game, { from: coordToIndex(5, 0), to: coordToIndex(3, 2) });
  assert.equal(first.turn, 1);
  assert.equal(first.forcedFrom, coordToIndex(3, 2));
  const second = applyMove(first, { from: first.forcedFrom, to: coordToIndex(1, 4) });
  assert.equal(second.turn, 2);
  assert.equal(second.board.filter(Boolean).length, 1);
});

test('replay rejects an illegal transcript and opponent returns a legal move', () => {
  assert.equal(replayGame({ moves: [{ from: 0, to: 31 }] }).valid, false);
  const game = createGame();
  const move = chooseMove(game, { level: 2 });
  assert.ok(legalMoves(game.board, game.turn).some((candidate) => candidate.from === move.from && candidate.to === move.to));
});
