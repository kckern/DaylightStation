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

function appWith({ engine, configService, recordStore, logger = silentLogger }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chess', createChessRouter({ engine, configService, recordStore, logger }));
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

  it('logs and returns the server-resolved ladder opponent', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ladderService = {
      rungFor: vi.fn(async () => ({
        rung: { id: 'level-0', label: 'Level 0', skill: 0, movetime_ms: 400 },
        level: 0,
        opponent: { name: 'Caterpie' },
      })),
    };
    const engine = { chooseMove: vi.fn(async () => ({ from: 'e2', to: 'e4', san: 'e4' })) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/chess', createChessRouter({ engine, configService: stubConfig(), ladderService, logger }));
    const res = await request(app).post('/api/v1/chess/move?user=felix')
      .send({ fen: START, rung: 'learner', level: 0, gameId: 'g1' });
    expect(res.body.opponent).toEqual({
      source: 'ladder', level: 0, name: 'Caterpie',
      rung: { id: 'level-0', label: 'Level 0', skill: 0, elo: null, movetime_ms: 400 },
    });
    expect(engine.chooseMove).toHaveBeenCalledWith(expect.objectContaining({ rung: expect.objectContaining({ skill: 0 }) }));
    expect(logger.info).toHaveBeenCalledWith('chess.move.requested', expect.objectContaining({
      requested: { rung: 'learner', level: 0 },
      effective: expect.objectContaining({ name: 'Caterpie', level: 0 }),
    }));
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

describe('user id validation (path traversal)', () => {
  // `user` becomes a path segment under data/users/<user>/ — a traversal string
  // here is a read/write primitive anywhere on disk. Every route must 400 it
  // before the config service (and therefore the filesystem) is touched.
  const TRAVERSAL = '../../../../tmp';

  it('rejects a traversal user on GET /config without reading anything', async () => {
    const configService = stubConfig({ read: vi.fn(async () => CONFIG) });
    const res = await request(appWith({ engine: {}, configService }))
      .get('/api/v1/chess/config').query({ user: TRAVERSAL });
    expect(res.status).toBe(400);
    expect(configService.read).not.toHaveBeenCalled();
  });

  it('rejects a traversal user on PUT /config without writing anything', async () => {
    const configService = stubConfig({ read: vi.fn(async () => CONFIG) });
    const res = await request(appWith({ engine: {}, configService }))
      .put('/api/v1/chess/config').query({ user: TRAVERSAL }).send({ default_rung: 'steady' });
    expect(res.status).toBe(400);
    expect(configService.writeUserLayer).not.toHaveBeenCalled();
    expect(configService.read).not.toHaveBeenCalled();
  });

  it('rejects a traversal user on POST /move before reading config or moving', async () => {
    const chooseMove = vi.fn();
    const configService = stubConfig({ read: vi.fn(async () => CONFIG) });
    const res = await request(appWith({ engine: { chooseMove }, configService }))
      .post('/api/v1/chess/move').query({ user: TRAVERSAL })
      .send({ fen: START, rung: 'learner', gameId: 'g1' });
    expect(res.status).toBe(400);
    expect(configService.read).not.toHaveBeenCalled();
    expect(chooseMove).not.toHaveBeenCalled();
  });

  it('rejects a slash-bearing user even without dot-dot', async () => {
    const configService = stubConfig({ read: vi.fn(async () => CONFIG) });
    const res = await request(appWith({ engine: {}, configService }))
      .get('/api/v1/chess/config').query({ user: 'felix/evil' });
    expect(res.status).toBe(400);
    expect(configService.read).not.toHaveBeenCalled();
  });

  it('still serves a plain user id', async () => {
    const configService = stubConfig({ read: vi.fn(async () => CONFIG) });
    const res = await request(appWith({ engine: {}, configService }))
      .get('/api/v1/chess/config').query({ user: 'felix' });
    expect(res.status).toBe(200);
    expect(configService.read).toHaveBeenCalledWith('felix');
  });
});

describe('POST /api/v1/chess/games', () => {
  it('stores a record for a real user', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games?user=felix')
      .send({ result: 'win', moves: 24, hints: 3, best_moves: 1, rung: 'steady', duration_ms: 60000 });
    expect(res.status).toBe(201);
    expect(writes[0][0]).toBe('felix');
    expect(writes[0][1]).toMatchObject({ result: 'win', moves: 24 });
  });

  it('refuses without a user, so nothing is filed anonymously', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games').send({ result: 'win', moves: 24 });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('rejects a traversal in the user segment', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games?user=../../../../tmp').send({ result: 'win' });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('answers honestly when the store fails to persist, instead of claiming success', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const app = appWith({
      engine: {}, configService: stubConfig(),
      recordStore: { save: async () => false }, // e.g. EACCES writing the .yml
      logger,
    });
    const res = await request(app).post('/api/v1/chess/games?user=felix').send({ result: 'win', moves: 24 });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    expect(res.body).not.toMatchObject({ saved: true });
    expect(logger.info).not.toHaveBeenCalledWith('chess.game.recorded', expect.anything());
    expect(logger.warn).toHaveBeenCalled();
  });
});
