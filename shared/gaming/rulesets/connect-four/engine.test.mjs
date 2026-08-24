import test from 'node:test';
import assert from 'node:assert/strict';
import { playColumn, replayGame } from './engine.mjs';
import { chooseColumn } from './opponent.mjs';

test('replays a vertical win from a compact transcript', () => {
  const game = replayGame({ moves: [0, 1, 0, 1, 0, 1, 0] });
  assert.equal(game.valid, true);
  assert.equal(game.status.winner, 1);
  assert.equal(game.status.winningCells.length, 4);
});

test('rejects a full column without mutating the transcript', () => {
  const transcript = { moves: [0, 0, 0, 0, 0, 0] };
  const result = playColumn(transcript, 0);
  assert.equal(result.error, 'column_full');
  assert.deepEqual(transcript.moves, [0, 0, 0, 0, 0, 0]);
});

test('opponent takes an immediate win and blocks one', () => {
  const win = replayGame({ moves: [1, 0, 1, 0, 2, 0, 2] });
  assert.equal(chooseColumn(win.board, { player: 2 }), 0);
  const block = replayGame({ moves: [0, 1, 0, 1, 0] });
  assert.equal(chooseColumn(block.board, { player: 2 }), 0);
});
