import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createChessRouter } from './chess.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CONFIG = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
};
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function appWith({ engine, configService }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chess', createChessRouter({ engine, configService, logger: silentLogger }));
  return app;
}

const stubConfig = (overrides = {}) => ({
  read: async () => CONFIG,
  writeUserLayer: vi.fn(async () => {}),
  resolveRung: (config, id) => config.rungs.find((r) => r.id === id) || config.rungs[1],
  ...overrides,
});

describe('POST /api/v1/chess/move', () => {
  it('returns the engine move for a legal position', async () => {
    const engine = { chooseMove: async () => ({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish', thinkingMs: 12 }) };
    const res = await request(appWith({ engine, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: START, rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
  });

  it('rejects an invalid FEN before it reaches the engine', async () => {
    const chooseMove = vi.fn();
    const res = await request(appWith({ engine: { chooseMove }, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: 'not-a-fen', rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(400);
    expect(chooseMove).not.toHaveBeenCalled();
  });

  it('reports game over as a null move rather than an error', async () => {
    const engine = { chooseMove: async () => null };
    const res = await request(appWith({ engine, configService: stubConfig() }))
      .post('/api/v1/chess/move').send({ fen: START, rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(200);
    expect(res.body.move).toBeNull();
  });
});

describe('/api/v1/chess/config', () => {
  it('serves the merged config', async () => {
    const res = await request(appWith({ engine: {}, configService: stubConfig() }))
      .get('/api/v1/chess/config?user=felix');
    expect(res.status).toBe(200);
    expect(res.body.default_rung).toBe('learner');
  });

  it('writes the user layer on PUT', async () => {
    const configService = stubConfig();
    const res = await request(appWith({ engine: {}, configService }))
      .put('/api/v1/chess/config?user=felix').send({ default_rung: 'steady' });
    expect(res.status).toBe(200);
    expect(configService.writeUserLayer).toHaveBeenCalledWith('felix', { default_rung: 'steady' });
  });

  it('refuses to write without a user', async () => {
    const configService = stubConfig();
    const res = await request(appWith({ engine: {}, configService }))
      .put('/api/v1/chess/config').send({ default_rung: 'steady' });
    expect(res.status).toBe(400);
    expect(configService.writeUserLayer).not.toHaveBeenCalled();
  });
});
