import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectFourEngine } from './ConnectFourEngineAdapter.mjs';

test('worker-backed adapter returns a legal deterministic column', async (context) => {
  const engine = createConnectFourEngine({ timeoutMs: 2000 });
  context.after(() => engine.dispose());
  const answer = await engine.chooseMove({ transcript: { moves: [3] }, level: 1 });
  assert.equal(Number.isInteger(answer.column), true);
  assert.ok(answer.column >= 0 && answer.column <= 6);
  assert.match(answer.engine, /worker|fallback/);
});

test('adapter refuses invalid and finished transcripts', async (context) => {
  const engine = createConnectFourEngine();
  context.after(() => engine.dispose());
  assert.equal(await engine.chooseMove({ transcript: { moves: [9] } }), null);
  assert.equal(await engine.chooseMove({ transcript: { moves: [0, 1, 0, 1, 0, 1, 0] } }), null);
});
