import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckersEngine } from './CheckersEngineAdapter.mjs';
import { legalMoves, replayGame } from '../../../../shared/gaming/rulesets/checkers/engine.mjs';

test('worker-backed Checkers adapter returns a legal move', async (context) => {
  const engine = createCheckersEngine();
  context.after(() => engine.dispose());
  // Human opening move 20 -> 16 leaves Black to move.
  const transcript = { moves: [{ from: 20, to: 16 }] };
  const game = replayGame(transcript);
  const answer = await engine.chooseMove({ transcript, level: 2 });
  assert.ok(answer);
  assert.ok(legalMoves(game.board, 2).some((move) => move.from === answer.from && move.to === answer.to));
  assert.match(answer.engine, /worker|fallback/);
});

test('Checkers adapter refuses invalid or wrong-turn transcripts', async (context) => {
  const engine = createCheckersEngine();
  context.after(() => engine.dispose());
  assert.equal(await engine.chooseMove({ transcript: { moves: [] } }), null);
  assert.equal(await engine.chooseMove({ transcript: { moves: [{ from: 0, to: 31 }] } }), null);
});
