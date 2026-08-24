import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createPianoGamesRouter } from './pianoGames.mjs';

function appFor(container, nativeRouters = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano-games', createPianoGamesRouter({ container, nativeRouters }));
  return app;
}

test('translates a game move request into the application contract', async () => {
  let captured;
  const app = appFor({
    chooseMove: async (gameId, value) => {
      captured = { gameId, value };
      return { move: { column: 3 }, opponent: { level: 1 } };
    },
  });
  const response = await request(app).post('/api/v1/piano-games/connect-four/move?user=kid').send({
    transcript: { moves: [2] }, level: 9, gameId: 'match-1',
  });
  assert.equal(response.status, 200);
  assert.equal(captured.gameId, 'connect-four');
  assert.equal(captured.value.userId, 'kid');
  assert.equal(response.body.move.column, 3);
});

test('mounts Piano-native family routers before the generic route', async () => {
  const chess = express.Router();
  chess.post('/move', (_req, res) => res.json({ from: 'e2', to: 'e4' }));
  const app = appFor({ chooseMove: async () => { throw new Error('generic should not run'); } }, { chess });
  const response = await request(app).post('/api/v1/piano-games/chess/move').send({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { from: 'e2', to: 'e4' });
});
