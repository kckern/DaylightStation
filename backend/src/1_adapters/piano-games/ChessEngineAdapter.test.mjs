import test from 'node:test';
import assert from 'node:assert/strict';
import { createChessEngine } from './ChessEngineAdapter.mjs';
import { INITIAL_FEN, legalMoves } from '../../../../shared/gaming/rulesets/chess/engine.mjs';

test('worker-backed adapter returns a legal move for a fresh game (no transcript)', async (context) => {
  const engine = createChessEngine();
  context.after(() => engine.dispose());
  const move = await engine.chooseMove({ transcript: undefined, gameSessionId: 'g1', opponent: { level: 1 } });
  assert.ok(move, 'expected a move for the starting position');
  const legal = legalMoves(INITIAL_FEN).map((m) => `${m.from}${m.to}`);
  assert.ok(legal.includes(`${move.from}${move.to}`), `${move.from}${move.to} should be a legal opening move`);
  assert.match(move.engine, /homegrown|stockfish|fallback/);
});

test('replays a SAN transcript into a position before asking the engine for a reply', async (context) => {
  const engine = createChessEngine();
  context.after(() => engine.dispose());
  // 1.e4 e5 2.Nf3 leaves Black on move; the adapter has to have replayed all
  // three plies (not just looked at the last one) to hand Stockfish a legal
  // position to answer from.
  const move = await engine.chooseMove({
    transcript: { moves: ['e4', 'e5', 'Nf3'] }, gameSessionId: 'g2', opponent: { level: 1 },
  });
  assert.ok(move, 'expected a reply for Black after 1.e4 e5 2.Nf3');
});

test('a transcript that fails to replay resolves to null rather than throwing', async (context) => {
  const engine = createChessEngine();
  context.after(() => engine.dispose());
  // White's queen cannot go to h5 twice in a row — the second 'Qh5' is not a
  // legal move in the resulting position, so replay fails partway through.
  // This must read as "no move", the same way an invalid Connect
  // Four/Checkers transcript does, not as a thrown error the request handler
  // has to catch.
  const move = await engine.chooseMove({
    transcript: { moves: ['e4', 'e5', 'Qh5', 'Qh5'] }, gameSessionId: 'g3', opponent: { level: 1 },
  });
  assert.equal(move, null);
});

test("maps the ladder's 1-based level onto the zero-based engine table", async () => {
  // OpponentLadder's first rung is level 1 (see OpponentLadder.mjs's class
  // comment); the shared engine table counts from 0. The bottom entry uses the
  // teaching engine while the top entry uses Stockfish skill 20.
  let received;
  const fakeEngine = {
    chooseMove: async (request) => {
      received = request;
      return { from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish', thinkingMs: 1 };
    },
    dispose() {},
  };
  const engine = createChessEngine({ engine: fakeEngine });
  await engine.chooseMove({ transcript: undefined, gameSessionId: 'g4', opponent: { level: 1 } });
  assert.equal(received.rung.engine, 'homegrown');
  assert.equal(received.rung.depth, 1);
  await engine.chooseMove({ transcript: undefined, gameSessionId: 'g4', opponent: { level: 21 } });
  assert.equal(received.rung.skill, 20);
});

test('dispose delegates to the wrapped engine rather than leaking its worker', () => {
  let disposed = false;
  const fakeEngine = { chooseMove: async () => null, dispose: () => { disposed = true; } };
  const engine = createChessEngine({ engine: fakeEngine });
  engine.dispose();
  assert.equal(disposed, true);
});
