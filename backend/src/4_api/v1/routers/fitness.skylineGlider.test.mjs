import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createFitnessRouter } from './fitness.mjs';

function app() {
  const course = { id: 'mountain-pass', version: 1 };
  const rows = new Map();
  const skylineGliderCourses = { list: () => [course] };
  const skylineGliderRuns = {
    save: async (record) => { rows.set(record.run.id, record); return { created: true, record }; },
    get: async (id) => rows.get(id) ?? null,
  };
  const server = express();
  server.use(express.json());
  server.use('/api/fitness', createFitnessRouter({ skylineGliderCourses, skylineGliderRuns, logger: { error() {} } }));
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
});
