import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createFitnessRouter } from "./fitness.mjs";

function app({ logger = { error() {}, info() {} } } = {}) {
  const course = { id: 'mountain-pass', version: 1 };
  const rows = new Map();
  const skylineGliderCourses = { list: () => [course], world: () => ({ zones: [{ id: 'alpine', name: 'Alpine', acts: [{ id: 'mountain-pass', act: 1 }] }] }) };
  const unlocks = [];
  const skylineGliderProgress = {
    worldFor: async (world, riderId) => ({ zones: world.zones, next: riderId ? 'mountain-pass' : null }),
    unlock: async (riderId, actId, unlockedBy) => { unlocks.push({ riderId, actId, unlockedBy }); return { unlocked: [actId] }; },
  };
  const skylineGliderRuns = {
    save: async (record) => { rows.set(record.run.id, record); return { created: true, record }; },
    get: async (id) => rows.get(id) ?? null,
  };
  const server = express();
  server.use(express.json());
  server.use('/api/fitness', createFitnessRouter({ skylineGliderCourses, skylineGliderRuns, skylineGliderProgress, logger }));
  server.unlocks = unlocks;
  return server;
}

describe('Skyline Glider HTTP API', () => {
  it('lists courses and saves/loads a run', async () => {
    const server = app();
    expect((await request(server).get('/api/fitness/skyline-glider/courses')).body.courses[0].id).toBe('mountain-pass');
    const record = { run: { id: 'run-1' } };
    expect((await request(server).post('/api/fitness/skyline-glider/runs').send({ record })).status).toBe(201);
    expect((await request(server).get('/api/fitness/skyline-glider/runs/run-1')).body.record).toEqual(record);
    expect((await request(server).get('/api/fitness/skyline-glider/runs/missing')).status).toBe(404);
  });

  it('maps run conflicts to HTTP 409', async () => {
    const server = express();
    server.use(express.json());
    server.use('/api/fitness', createFitnessRouter({ skylineGliderCourses: { list: () => [] }, skylineGliderRuns: { save: async () => { const error = new Error('conflict'); error.code = 'RUN_CONFLICT'; throw error; } }, logger: { error() {} } }));
    expect((await request(server).post('/api/fitness/skyline-glider/runs').send({ record: { run: { id: 'same' } } })).status).toBe(409);
  });

  it('accepts and durably logs a lifecycle suspension beacon', async () => {
    const calls = [];
    const server = app({ logger: { error() {}, info: (...args) => calls.push(args) } });
    const payload = {
      runId: 'run-live', riderId: 'test-rider', equipmentId: 'niceday',
      courseId: 'mountain-pass', courseVersion: 3, courseTime: 42.5,
      inputMode: 'inferred-slowdown', reason: 'pagehide',
    };

    expect((await request(server).post('/api/fitness/skyline-glider/suspensions').send(payload)).status).toBe(202);
    expect(calls).toContainEqual(['skyline_glider.flight.suspended', expect.objectContaining(payload)]);
    expect((await request(server).post('/api/fitness/skyline-glider/suspensions').send({ reason: 'pagehide' })).status).toBe(400);
  });
  it('serves the rider world map and admin unlocks for known acts only', async () => {
    const server = app();
    const world = await request(server).get('/api/fitness/skyline-glider/world?rider=kid');
    expect(world.status).toBe(200);
    expect(world.body).toMatchObject({ riderId: 'kid', next: 'mountain-pass', zones: [{ id: 'alpine' }] });
    const unlock = await request(server).post('/api/fitness/skyline-glider/progress/kid/unlock').send({ actId: 'mountain-pass', unlockedBy: 'dad' });
    expect(unlock.status).toBe(200);
    expect(server.unlocks).toEqual([{ riderId: 'kid', actId: 'mountain-pass', unlockedBy: 'dad' }]);
    const missing = await request(server).post('/api/fitness/skyline-glider/progress/kid/unlock').send({ actId: 'nope' });
    expect(missing.status).toBe(404);
  });
});
