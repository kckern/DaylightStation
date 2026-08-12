// backend/src/4_api/v1/routers/fitness.strength.test.mjs
//
// POST /sessions/:sessionId/strength end to end: real router, real LogStrengthRun, real
// workout repository against a temp directory, in-memory session store. What is asserted
// is the RECORD that ends up stored — the point of the endpoint is that a strength run
// lands in the same file a cycle ride does.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFitnessRouter } from './fitness.mjs';
import { YamlWorkoutRepository } from '#adapters/fitness/YamlWorkoutRepository.mjs';
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
import { LogStrengthRun } from '#apps/fitness/usecases/LogStrengthRun.mjs';
import { expandWorkout } from '#domains/fitness/workout/workout.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };
const HH = 'main';
const SESSION_ID = '20260811092020';

const WORKOUT = {
  title: 'Full Body Friday',
  author: 'test-user',
  groups: [
    { rounds: 1, exercises: [{ slug: 'back-squat', sets: 4, reps: 8, load: '135 lb', restSeconds: 90 }] },
  ],
};

let dataDir;
let store;

function makeStore() {
  const saved = new Map([[`${HH}:${SESSION_ID}`, {
    version: 3,
    sessionId: SESSION_ID,
    session: { id: SESSION_ID, date: '2026-08-11', start: '2026-08-11 09:20:20' },
    timezone: 'America/Los_Angeles',
    participants: { 'test-user': { display_name: 'Test User', is_primary: true } },
    timeline: { series: { 'test-user:hr': '[[120,3]]' }, events: [], encoding: 'rle' },
  }]]);
  return {
    saved,
    async save(session, householdId) {
      const data = typeof session.toJSON === 'function' ? session.toJSON() : session;
      saved.set(`${householdId}:${data.sessionId}`, data);
    },
    async findById(id, householdId) { return saved.get(`${householdId}:${id}`) ?? null; },
    async findByDate() { return []; },
    async delete() {},
    getStoragePaths(id) { return { sessionFilePath: `/fake/${id}.yml` }; },
  };
}

function buildApp({ withWorkouts = true } = {}) {
  const configService = {
    getDefaultHouseholdId: () => HH,
    getDataDir: () => dataDir,
    getHouseholdPath: (relativePath) => path.join(dataDir, 'household', relativePath),
  };
  const workoutRepository = new YamlWorkoutRepository({ configService, logger: silentLogger });
  workoutRepository.save({ ...WORKOUT, id: 'full-body-friday' }, HH);

  const sessionService = new SessionService({ sessionStore: store, defaultHouseholdId: HH });
  const logStrengthRun = new LogStrengthRun({ sessionService, workoutRepository, logger: silentLogger });
  const router = createFitnessRouter({
    configService,
    sessionService,
    logger: silentLogger,
    ...(withWorkouts ? { workoutRepository, logStrengthRun } : {}),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/fitness', router);
  return app;
}

const workSteps = (count) =>
  expandWorkout({ ...WORKOUT, id: 'full-body-friday' })
    .filter((s) => s.kind === 'work')
    .slice(0, count);

const stored = () => store.saved.get(`${HH}:${SESSION_ID}`);

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-api-'));
  store = makeStore();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('fitness POST /sessions/:sessionId/strength', () => {
  it('logs the sets actually completed onto the session record', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/api/fitness/sessions/${SESSION_ID}/strength`)
      .send({ workoutId: 'full-body-friday', completedSteps: workSteps(2), completedAt: '2026-08-11T17:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.strength.runs).toHaveLength(1);

    expect(stored().strength).toEqual({
      runs: [{
        workoutId: 'full-body-friday',
        title: 'Full Body Friday',
        completedAt: '2026-08-11T17:00:00.000Z',
        participants: ['test-user'],
        setsCompleted: 2,
        setsPlanned: 4,
        groups: [{
          index: 0,
          kind: 'sets',
          exercises: [{ slug: 'back-squat', setsCompleted: 2, setsPlanned: 4, reps: 8, load: '135 lb' }],
        }],
      }],
    });
  });

  it('404s an unknown session and an unknown workout', async () => {
    const app = buildApp();
    const noSession = await request(app)
      .post('/api/fitness/sessions/20260811999999/strength')
      .send({ workoutId: 'full-body-friday', completedSteps: workSteps(1) });
    expect(noSession.status).toBe(404);
    expect(noSession.body.reason).toBe('unknown_session');

    const noWorkout = await request(app)
      .post(`/api/fitness/sessions/${SESSION_ID}/strength`)
      .send({ workoutId: 'never-authored', completedSteps: workSteps(1) });
    expect(noWorkout.status).toBe(404);
    expect(noWorkout.body.reason).toBe('unknown_workout');
  });

  it('422s a run with nothing completed and writes no block', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/api/fitness/sessions/${SESSION_ID}/strength`)
      .send({ workoutId: 'full-body-friday', completedSteps: [] });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('nothing_completed');
    expect(stored().strength).toBeUndefined();
  });

  it('503s when strength logging is not configured, rather than half-working', async () => {
    const app = buildApp({ withWorkouts: false });
    const res = await request(app)
      .post(`/api/fitness/sessions/${SESSION_ID}/strength`)
      .send({ workoutId: 'full-body-friday', completedSteps: workSteps(1) });
    expect(res.status).toBe(503);
  });
});
