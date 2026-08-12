// backend/src/4_api/v1/routers/fitness.workouts.test.mjs
//
// The four /workouts routes end to end: real repository against a temp directory, real
// SaveWorkout, stub corpus. Only the exercise library is faked, because it is the one
// dependency whose real form is a 2.8 MB manifest of somebody else's data.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFitnessRouter } from './fitness.mjs';
import { YamlWorkoutRepository } from '#adapters/fitness/YamlWorkoutRepository.mjs';
import { SaveWorkout } from '#apps/fitness/usecases/SaveWorkout.mjs';

const KNOWN = new Set(['back-squat', 'plank', 'barbell-row']);
const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

let dataDir;

function buildApp({ withWorkouts = true } = {}) {
  const configService = {
    getDefaultHouseholdId: () => 'main',
    getDataDir: () => dataDir,
    getHouseholdPath: (relativePath) => path.join(dataDir, 'household', relativePath),
  };
  const workoutRepository = new YamlWorkoutRepository({ configService, logger: silentLogger });
  const saveWorkout = new SaveWorkout({
    workoutRepository,
    exerciseLibrary: { getExercise: (slug) => (KNOWN.has(slug) ? { slug } : null) },
    logger: silentLogger,
  });
  const router = createFitnessRouter({
    configService,
    logger: silentLogger,
    ...(withWorkouts ? { workoutRepository, saveWorkout } : {}),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/fitness', router);
  return app;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workout-api-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('fitness /workouts', () => {
  it('round-trips a workout: create, list as a summary, fetch the full body', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/fitness/workouts').send({
      title: 'Full Body Friday',
      author: 'kckern',
      groups: [
        { rounds: 3, exercises: [{ slug: 'back-squat', sets: 2, reps: 8, restSeconds: 60 }] },
        { rounds: 1, exercises: [{ slug: 'plank', seconds: 45 }, { slug: 'barbell-row', reps: 10 }] },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^full-body-friday-[a-z0-9]{4}$/);

    const list = await request(app).get('/api/fitness/workouts');
    expect(list.status).toBe(200);
    expect(list.body.workouts).toHaveLength(1);
    const [summary] = list.body.workouts;
    // A summary, not a body — the picker must not be shipped every set and rep.
    expect(summary).not.toHaveProperty('groups');
    expect(summary).toMatchObject({
      id: created.body.id,
      title: 'Full Body Friday',
      author: 'kckern',
      groupCount: 2,
      exerciseCount: 3,
      setCount: 8,
    });

    const detail = await request(app).get(`/api/fitness/workouts/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.workout.groups).toHaveLength(2);
    expect(detail.body.workout.groups[0].exercises[0])
      .toEqual({ slug: 'back-squat', sets: 2, reps: 8, seconds: null, load: null, restSeconds: 60 });
  });

  it('rejects unknown slugs with a 400 that names every one of them', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/fitness/workouts').send({
      title: 'Typos',
      groups: [
        { exercises: [{ slug: 'back-squat' }, { slug: 'bench-pres' }] },
        { exercises: [{ slug: 'dead-lft' }] },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.unknownSlugs).toEqual(['bench-pres', 'dead-lft']);
    expect(res.body.error).toContain('bench-pres');
    expect(res.body.error).toContain('dead-lft');
    // Nothing was persisted: the list is still empty.
    const list = await request(app).get('/api/fitness/workouts');
    expect(list.body.workouts).toEqual([]);
  });

  it('updates in place when the payload carries an id', async () => {
    const app = buildApp();
    const first = await request(app).post('/api/fitness/workouts')
      .send({ title: 'Leg Day', groups: [{ exercises: [{ slug: 'back-squat' }] }] });
    const { id } = first.body;

    const second = await request(app).post('/api/fitness/workouts')
      .send({ workout: { id, title: 'Leg Day (heavier)', groups: [{ exercises: [{ slug: 'back-squat' }] }] } });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(id);

    const list = await request(app).get('/api/fitness/workouts');
    expect(list.body.workouts.map((w) => w.title)).toEqual(['Leg Day (heavier)']);
  });

  it('404s an unknown id on both GET and DELETE, and deletes once', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/fitness/workouts/nope')).status).toBe(404);
    expect((await request(app).delete('/api/fitness/workouts/nope')).status).toBe(404);

    const created = await request(app).post('/api/fitness/workouts')
      .send({ title: 'Delete Me', groups: [] });
    const del = await request(app).delete(`/api/fitness/workouts/${created.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, id: created.body.id });
    expect((await request(app).delete(`/api/fitness/workouts/${created.body.id}`)).status).toBe(404);
    expect((await request(app).get('/api/fitness/workouts')).body.workouts).toEqual([]);
  });

  it('lists an empty shelf on a fresh install instead of failing', async () => {
    const res = await request(buildApp()).get('/api/fitness/workouts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workouts: [] });
  });

  it('reports 503 when workout persistence was not composed', async () => {
    const app = buildApp({ withWorkouts: false });
    expect((await request(app).get('/api/fitness/workouts')).status).toBe(503);
    expect((await request(app).post('/api/fitness/workouts').send({})).status).toBe(503);
  });
});
