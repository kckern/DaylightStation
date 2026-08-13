// backend/src/4_api/v1/routers/fitness.run.test.mjs
//
// Build -> Run, end to end over HTTP: real repository against a temp directory, real
// SaveWorkout, real PrepareWorkoutRun, stub corpus. Only the exercise library is faked,
// because it is the one dependency whose real form is a 2.8 MB manifest of somebody
// else's data.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFitnessRouter } from './fitness.mjs';
import { YamlWorkoutRepository } from '#adapters/fitness/YamlWorkoutRepository.mjs';
import { SaveWorkout } from '#apps/fitness/usecases/SaveWorkout.mjs';
import { PrepareWorkoutRun } from '#apps/fitness/usecases/PrepareWorkoutRun.mjs';

const CORPUS = Object.assign(Object.create(null), {
  'back-squat': { slug: 'back-squat', name: 'Barbell Back Squat', image: 'media/library/exercise/assets/squat.gif' },
  'barbell-row': { slug: 'barbell-row', name: 'Barbell Row', image: 'media/library/exercise/assets/row.gif' },
  plank: { slug: 'plank', name: 'Plank', image: 'media/library/exercise/assets/plank.gif' },
});

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

let dataDir;
let repository;

function buildApp({ withRun = true } = {}) {
  const configService = {
    getDefaultHouseholdId: () => 'main',
    getDataDir: () => dataDir,
    getHouseholdPath: (relativePath) => path.join(dataDir, 'household', relativePath),
  };
  repository = new YamlWorkoutRepository({ configService, logger: silentLogger });
  const exerciseLibrary = { getExercise: (slug) => CORPUS[slug] ?? null };
  const saveWorkout = new SaveWorkout({ workoutRepository: repository, exerciseLibrary, logger: silentLogger });
  const router = createFitnessRouter({
    configService,
    logger: silentLogger,
    workoutRepository: repository,
    saveWorkout,
    ...(withRun
      ? { prepareWorkoutRun: new PrepareWorkoutRun({ workoutRepository: repository, exerciseLibrary, logger: silentLogger }) }
      : {}),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/fitness', router);
  return app;
}

/** The superset authoring Build produces: sets 1, rounds 3 -> A B A B A B. */
const SUPERSET = {
  title: 'Push Pull',
  groups: [{
    rounds: 3,
    exercises: [
      { slug: 'back-squat', sets: 1, reps: 8, load: '225 lb' },
      { slug: 'barbell-row', sets: 1, reps: 10 },
    ],
  }],
};

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workout-run-api-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /workouts/:id/run', () => {
  it('serves the expanded plan with real exercise names and images', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/fitness/workouts').send({
      title: 'Full Body Friday',
      groups: [
        { rounds: 1, exercises: [{ slug: 'back-squat', sets: 3, reps: 5, restSeconds: 60 }] },
        { rounds: 1, exercises: [{ slug: 'plank', seconds: 45 }] },
      ],
    });
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/fitness/workouts/${created.body.id}/run`);
    expect(res.status).toBe(200);
    expect(res.body.workout).toEqual({ id: created.body.id, title: 'Full Body Friday' });

    // Straight sets A A A with rest between, then the second group's single step. The
    // trailing rest after the last squat set is NOT dropped — a step follows it.
    expect(res.body.steps.map((s) => `${s.kind}:${s.slug ?? s.afterSlug}`)).toEqual([
      'work:back-squat', 'rest:back-squat',
      'work:back-squat', 'rest:back-squat',
      'work:back-squat', 'rest:back-squat',
      'work:plank',
    ]);
    expect(res.body.exercises).toEqual({
      'back-squat': { name: 'Barbell Back Squat', image: 'media/library/exercise/assets/squat.gif' },
      plank: { name: 'Plank', image: 'media/library/exercise/assets/plank.gif' },
    });
    expect(res.body.missingSlugs).toEqual([]);

    // Every step carries what the runner renders without re-deriving anything.
    const [first] = res.body.steps;
    expect(first).toMatchObject({
      kind: 'work', groupIndex: 0, groupKind: 'sets', slug: 'back-squat',
      round: 1, totalRounds: 1, set: 1, setNumber: 1, totalSets: 3,
      reps: 5, seconds: null, index: 0, totalSteps: 7,
    });
  });

  it('alternates A B A B A B for a superset', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/fitness/workouts').send(SUPERSET);
    const res = await request(app).get(`/api/fitness/workouts/${created.body.id}/run`);

    expect(res.status).toBe(200);
    expect(res.body.steps.map((s) => s.slug)).toEqual([
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
    ]);
    expect(res.body.steps.map((s) => s.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(res.body.steps.every((s) => s.groupKind === 'superset')).toBe(true);
    expect(res.body.steps[0].load).toBe('225 lb');
  });

  it('404s an unknown workout id', async () => {
    const res = await request(buildApp()).get('/api/fitness/workouts/never-existed/run');
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('unknown_workout');
  });

  it('404s an id that cannot address a file, instead of reaching for one', async () => {
    const res = await request(buildApp()).get('/api/fitness/workouts/..%2F..%2Fsecrets/run');
    expect(res.status).toBe(404);
  });

  it('still serves a workout whose exercise has vanished from the corpus', async () => {
    const app = buildApp();
    // Planted through the repository, not the API: SaveWorkout refuses unknown slugs at
    // authoring time. This is the state a corpus REBUILD leaves behind — the plan was
    // valid when it was written.
    repository.save({
      id: 'stale-plan',
      title: 'Stale Plan',
      groups: [{
        rounds: 2,
        exercises: [
          { slug: 'back-squat', sets: 1, reps: 5, restSeconds: 30 },
          { slug: 'retired-machine-fly', sets: 1, reps: 12, restSeconds: 30 },
        ],
      }],
    }, 'main');

    const res = await request(app).get('/api/fitness/workouts/stale-plan/run');

    expect(res.status).toBe(200);
    expect(res.body.steps.filter((s) => s.kind === 'work').map((s) => s.slug)).toEqual([
      'back-squat', 'retired-machine-fly', 'back-squat', 'retired-machine-fly',
    ]);
    expect(res.body.exercises['back-squat'].name).toBe('Barbell Back Squat');
    expect(res.body.exercises['retired-machine-fly']).toBeUndefined();
    expect(res.body.missingSlugs).toEqual(['retired-machine-fly']);
  });

  it('reports 503 when the run use case was not composed', async () => {
    const app = buildApp({ withRun: false });
    expect((await request(app).get('/api/fitness/workouts/anything/run')).status).toBe(503);
    expect((await request(app).post('/api/fitness/workouts/run').send({})).status).toBe(503);
  });
});

describe('POST /workouts/run (unsaved draft)', () => {
  it('expands a draft that was never saved, and saves nothing', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/fitness/workouts/run').send(SUPERSET);

    expect(res.status).toBe(200);
    expect(res.body.workout).toEqual({ id: null, title: 'Push Pull' });
    expect(res.body.steps.map((s) => s.slug)).toEqual([
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
      'back-squat', 'barbell-row',
    ]);
    expect(res.body.exercises['barbell-row'].name).toBe('Barbell Row');

    // The shelf is untouched — starting a run is not a save.
    expect((await request(app).get('/api/fitness/workouts')).body.workouts).toEqual([]);
  });

  it('accepts the { workout } envelope too, matching POST /workouts', async () => {
    const res = await request(buildApp()).post('/api/fitness/workouts/run').send({ workout: SUPERSET });
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(6);
  });

  it('runs a draft with an unknown slug rather than rejecting it mid-session', async () => {
    const res = await request(buildApp()).post('/api/fitness/workouts/run').send({
      title: 'Improvised',
      groups: [{ exercises: [{ slug: 'not-in-the-corpus', sets: 2, reps: 5 }] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.missingSlugs).toEqual(['not-in-the-corpus']);
  });

  it('expands an empty draft to an empty plan', async () => {
    const res = await request(buildApp()).post('/api/fitness/workouts/run').send({ title: 'Nothing', groups: [] });
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]);
  });
});
