import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life.mjs';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';

/**
 * Exercises the plan genesis + authoring REST routes against the REAL
 * PlanAuthoringService over a stateful in-memory store. The store keeps
 * LifePlan instances so router GET /plan → plan.toJSON() round-trips.
 */
describe('life router plan authoring', () => {
  let app;
  let db;

  beforeEach(() => {
    db = new Map();
    const lifePlanStore = {
      load: (u) => db.get(u) || null,
      save: (u, p) => { db.set(u, p); },
    };
    const planAuthoringService = new PlanAuthoringService({ lifePlanStore });

    const userService = {
      getProfile: (username) => (username === 'test-user' ? { username: 'test-user' } : null),
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/life', createLifeRouter({
      lifePlanStore,
      planAuthoringService,
      driftService: {},
      alignmentService: {},
      ceremonyService: {},
      feedbackService: {},
      retroService: {},
      aggregator: {},
      goalStateService: {},
      beliefEvaluator: {},
      cadenceService: { resolve: () => ({}) },
      ceremonyRecordStore: {},
      userService,
      defaultUsername: 'test-user',
    }));
  });

  it('POST /plan creates a plan (201) then 409 on a second genesis', async () => {
    const first = await request(app).post('/api/v1/life/plan');
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ ok: true });

    const second = await request(app).post('/api/v1/life/plan');
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it('POST /plan/goals creates a goal (creating the plan if missing)', async () => {
    const res = await request(app)
      .post('/api/v1/life/plan/goals')
      .send({ name: 'Run a half marathon', why: 'health', milestone: '10k by Sept' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('run-a-half-marathon');
    expect(res.body.state).toBe('dream');
    expect(res.body.why).toBe('health');

    const plan = await request(app).get('/api/v1/life/plan');
    expect(plan.body.goals).toHaveLength(1);
    expect(plan.body.goals[0].id).toBe('run-a-half-marathon');
  });

  it('POST /plan/goals with no name → 400', async () => {
    const res = await request(app).post('/api/v1/life/plan/goals').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('POST /plan/values creates a ranked value; missing name → 400', async () => {
    const ok = await request(app).post('/api/v1/life/plan/values').send({ name: 'Health' });
    expect(ok.status).toBe(201);
    expect(ok.body.rank).toBe(1);

    const ok2 = await request(app).post('/api/v1/life/plan/values').send({ name: 'Family' });
    expect(ok2.body.rank).toBe(2);

    const bad = await request(app).post('/api/v1/life/plan/values').send({});
    expect(bad.status).toBe(400);
  });

  it('POST /plan/beliefs creates a belief; missing fields → 400', async () => {
    const ok = await request(app)
      .post('/api/v1/life/plan/beliefs')
      .send({ if_hypothesis: 'train before 8am', then_outcome: 'training happens' });
    expect(ok.status).toBe(201);
    expect(ok.body.if).toBe('train before 8am');
    expect(ok.body.then).toBe('training happens');
    expect(ok.body.state).toBe('hypothesized');
    expect(ok.body.confidence).toBe(0.5);

    const bad = await request(app).post('/api/v1/life/plan/beliefs').send({ if_hypothesis: 'x' });
    expect(bad.status).toBe(400);
  });
});
