import { expect, test } from 'vitest';
import { playColumn, replayGame } from './engine.mjs';
import { chooseColumn } from './opponent.mjs';

// Vitest, not node:test, since 2026-09-16. The gate decides a file's runner by
// what it imports and skips node:test files — so while this spec said
// `node:test` it was run by nothing at all, in a directory the gate's ROOTS did
// not list either. Two layers of "covered by something else", covering nothing.

test('replays a vertical win from a compact transcript', () => {
  const game = replayGame({ moves: [0, 1, 0, 1, 0, 1, 0] });
  expect(game.valid).toBe(true);
  expect(game.status.winner).toBe(1);
  expect(game.status.winningCells.length).toBe(4);
});

test('rejects a full column without mutating the transcript', () => {
  const transcript = { moves: [0, 0, 0, 0, 0, 0] };
  const result = playColumn(transcript, 0);
  expect(result.error).toBe('column_full');
  expect(transcript.moves.length).toBe(6);
});

test('opponent takes an immediate win and blocks one', () => {
  const win = replayGame({ moves: [1, 0, 1, 0, 2, 0, 2] });
  expect(chooseColumn(win.board, { player: 2 })).toBe(0);
  const block = replayGame({ moves: [0, 1, 0, 1, 0] });
  expect(chooseColumn(block.board, { player: 2 })).toBe(0);
});
