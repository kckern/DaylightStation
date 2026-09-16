import { afterAll, expect, test } from 'vitest';
import { createConnectFourEngine } from './ConnectFourEngineAdapter.mjs';

// Vitest, not node:test, since 2026-09-16: the gate decides a file's runner by
// what it imports and skips node:test files, so this spec — the only coverage
// of the worker path — was run by nothing.

const engines = [];
function engine(options) {
  const created = createConnectFourEngine(options);
  engines.push(created);
  return created;
}
afterAll(() => engines.forEach((created) => created.dispose()));

test('worker-backed adapter returns a legal deterministic column', async () => {
  const answer = await engine({ timeoutMs: 2000 }).chooseMove({ transcript: { moves: [3] }, level: 1 });
  expect(Number.isInteger(answer.column)).toBe(true);
  expect(answer.column).toBeGreaterThanOrEqual(0);
  expect(answer.column).toBeLessThanOrEqual(6);
  expect(answer.engine).toMatch(/worker|fallback/);
});

test('the search runs in the worker, not on the calling thread', async () => {
  // `engine: "fallback"` means the worker never answered and the search ran
  // HERE — on the backend's main event loop in production. The adapter is
  // written to survive that, which is exactly why it can go unnoticed.
  const answer = await engine({ timeoutMs: 2000 }).chooseMove({ transcript: { moves: [3] }, level: 7 });
  expect(answer.engine).toBe('worker');
});

test('the deepest rung answers inside the worker timeout', async () => {
  const answer = await engine({ timeoutMs: 1000 }).chooseMove({ transcript: { moves: [3, 3, 4] }, level: 7 });
  expect(answer).not.toBe(null);
  expect(answer.engine).toBe('worker');
  expect(answer.thinkingMs).toBeLessThan(1000);
});

test('adapter refuses invalid and finished transcripts', async () => {
  const adapter = engine();
  expect(await adapter.chooseMove({ transcript: { moves: [9] } })).toBe(null);
  expect(await adapter.chooseMove({ transcript: { moves: [0, 1, 0, 1, 0, 1, 0] } })).toBe(null);
});

test('adapter declines to move when it is not the opponent seat', async () => {
  // An even number of plies leaves red to move; the opponent answers only as 2.
  expect(await engine().chooseMove({ transcript: { moves: [3, 3, 4, 4] }, level: 7 })).toBe(null);
});
