import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createPianoGamesRouter } from './pianoGames.mjs';

function appFor(container, nativeRouters = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano-games', createPianoGamesRouter({ pianoGames: container, nativeRouters }));
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

test('serves the learner board-game count for the current study day', async () => {
  const app = appFor({
    boardGameDay: (userId) => ({ studyDate: '2026-08-28', completedGames: userId === 'Milo' ? 4 : 0 }),
  });
  const response = await request(app).get('/api/v1/piano-games/day/current?user=Milo');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { studyDate: '2026-08-28', completedGames: 4 });
});

test('translates the shared dialogue contract without renaming transcript fields', async () => {
  let captured;
  const app = appFor({
    dialogue: async (gameId, value) => {
      captured = { gameId, value };
      return { eventId: 'match-1:2', quip: 'Your turn.', source: 'fallback', fallbackReason: 'disabled' };
    },
  });
  const body = {
    sessionId: 'match-1', ply: 2, level: 1, playerSide: 1,
    transcript: { moves: [3, 2] }, dialogue: [{ ply: 1, quip: 'I see it.' }],
  };
  const response = await request(app).post('/api/v1/piano-games/connect-four/dialogue?user=kid').send(body);
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { gameId: 'connect-four', value: { ...body, userId: 'kid' } });
  assert.equal(response.body.quip, 'Your turn.');
});
