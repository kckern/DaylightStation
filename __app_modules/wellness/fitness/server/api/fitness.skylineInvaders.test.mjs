import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createFitnessRouter } from './fitness.mjs';

const coded = (code) => { const error = new Error(code.toLowerCase()); error.code = code; return error; };

function app(over = {}) {
  const level = { id: 'invaders-1-1', name: 'First Wave' };
  const rows = new Map();
  const asked = [];
  const unlocks = [];
  const skylineInvadersLevels = {
    list: (household) => { asked.push(household); return [level]; },
    world: () => ({ levels: [{ id: 'invaders-1-1', name: 'First Wave' }] }),
  };
  const skylineInvadersProgress = {
    worldFor: async (world, riderId) => {
      if (riderId === 'bad!') throw coded('INVALID_RIDER');
      return { levels: world.levels.map((row) => ({ ...row, status: 'open' })), next: riderId ? 'invaders-1-1' : null };
    },
    setControls: async (riderId, gesture) => {
      if (riderId === 'bad!') throw coded('INVALID_RIDER');
      if (gesture !== 'twist') throw coded('INVALID_GESTURE');
      return { controls: { gesture, at: 'now' } };
    },
    unlock: async (riderId, levelId, unlockedBy) => {
      if (riderId === 'bad!') throw coded('INVALID_RIDER');
      unlocks.push({ riderId, levelId, unlockedBy });
      return { unlocked: [levelId] };
    },
  };
  const skylineInvadersRuns = {
    save: async (record) => { const created = !rows.has(record.run.id); rows.set(record.run.id, record); return { created, record }; },
    get: async (id) => rows.get(id) ?? null,
  };
  const server = express();
  server.use(express.json());
  server.use('/api/fitness', createFitnessRouter({ skylineInvadersLevels, skylineInvadersRuns, skylineInvadersProgress, defaultHouseholdId: 'home', logger: { error() {}, info() {} }, ...over }));
  server.unlocks = unlocks;
  server.asked = asked;
  return server;
}

describe('Skyline Invaders HTTP API', () => {
  it('lists levels for the default household, or the one asked for', async () => {
    const server = app();
    const listed = await request(server).get('/api/fitness/skyline-invaders/levels');
    expect(listed.status).toBe(200);
    expect(listed.body.levels[0].id).toBe('invaders-1-1');
    await request(server).get('/api/fitness/skyline-invaders/levels?household=other');
    expect(server.asked).toEqual(['home', 'other']);
  });

  it('saves a run once (201), repeats as 200, and loads it back', async () => {
    const server = app();
    const record = { run: { id: 'run-1' } };
    expect((await request(server).post('/api/fitness/skyline-invaders/runs').send({ record })).status).toBe(201);
    expect((await request(server).post('/api/fitness/skyline-invaders/runs').send({ record })).status).toBe(200);
    expect((await request(server).get('/api/fitness/skyline-invaders/runs/run-1')).body.record).toEqual(record);
    expect((await request(server).get('/api/fitness/skyline-invaders/runs/missing')).status).toBe(404);
  });

  it.each([['RUN_CONFLICT', 409], ['INVALID_RUN', 400]])('maps %s to HTTP %i', async (code, status) => {
    const server = app({ skylineInvadersRuns: { save: async () => { throw coded(code); } } });
    expect((await request(server).post('/api/fitness/skyline-invaders/runs').send({ record: { run: { id: 'same' } } })).status).toBe(status);
  });

  it('serves the world map for a rider, and for nobody', async () => {
    const server = app();
    const world = await request(server).get('/api/fitness/skyline-invaders/world?rider=kid');
    expect(world.status).toBe(200);
    expect(world.body).toEqual({ riderId: 'kid', next: 'invaders-1-1', levels: [{ id: 'invaders-1-1', name: 'First Wave', status: 'open' }] });
    expect((await request(server).get('/api/fitness/skyline-invaders/world')).body).toMatchObject({ riderId: null, next: null });
    expect((await request(server).get('/api/fitness/skyline-invaders/world?rider=bad!')).status).toBe(400);
  });

  it('records an admin unlock for a known level only', async () => {
    const server = app();
    const unlock = await request(server).post('/api/fitness/skyline-invaders/progress/kid/unlock').send({ levelId: 'invaders-1-1', unlockedBy: 'dad' });
    expect(unlock.status).toBe(200);
    expect(unlock.body).toEqual({ progress: { unlocked: ['invaders-1-1'] } });
    expect(server.unlocks).toEqual([{ riderId: 'kid', levelId: 'invaders-1-1', unlockedBy: 'dad' }]);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/kid/unlock').send({ levelId: 'nope' })).status).toBe(404);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/bad!/unlock').send({ levelId: 'invaders-1-1' })).status).toBe(400);
    expect(server.unlocks).toHaveLength(1);
  });

  it('saves the controls a rider picked and rejects a gesture or rider it cannot use', async () => {
    const server = app();
    const saved = await request(server).post('/api/fitness/skyline-invaders/progress/kid/controls').send({ gesture: 'twist' });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ controls: { gesture: 'twist' } });
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/kid/controls').send({ gesture: 'nope' })).status).toBe(400);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/kid/controls').send({})).status).toBe(400);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/bad!/controls').send({ gesture: 'twist' })).status).toBe(400);
  });

  it('reports 503 when the services are absent', async () => {
    const server = express();
    server.use(express.json());
    server.use('/api/fitness', createFitnessRouter({ logger: { error() {} } }));
    expect((await request(server).get('/api/fitness/skyline-invaders/levels')).status).toBe(503);
    expect((await request(server).get('/api/fitness/skyline-invaders/world')).status).toBe(503);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/kid/unlock').send({ levelId: 'x' })).status).toBe(503);
    expect((await request(server).post('/api/fitness/skyline-invaders/progress/kid/controls').send({ gesture: 'twist' })).status).toBe(503);
    expect((await request(server).post('/api/fitness/skyline-invaders/runs').send({ record: {} })).status).toBe(503);
    expect((await request(server).get('/api/fitness/skyline-invaders/runs/run-1')).status).toBe(503);
  });
});
