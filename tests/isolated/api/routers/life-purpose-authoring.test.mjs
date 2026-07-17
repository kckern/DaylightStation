import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life.mjs';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';

/**
 * Exercises POST /plan/purpose — the route that lets a planless user
 * author a purpose statement without first calling POST /plan.
 * Mirrors life-plan-authoring.test.mjs's app-mount pattern.
 */
function buildApp() {
  const plans = new Map();
  const lifePlanStore = {
    load: (u) => plans.get(u) || null,
    save: (u, p) => { plans.set(u, p); },
  };
  const planAuthoringService = new PlanAuthoringService({ lifePlanStore });

  const app = express();
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
    userService: {
      getProfile: (username) => (username === 'test-user' ? { username: 'test-user' } : null),
    },
    defaultUsername: 'test-user',
  }));
  return app;
}

describe('POST /life/plan/purpose', () => {
  let app;
  beforeEach(() => { app = buildApp(); });

  it('creates a purpose for a planless user (no 404)', async () => {
    const res = await request(app)
      .post('/api/v1/life/plan/purpose')
      .send({ statement: 'To build things my kids are proud of.' });
    expect(res.status).toBe(201);
    expect(res.body.statement).toBe('To build things my kids are proud of.');
  });

  it('400s when statement is missing', async () => {
    const res = await request(app).post('/api/v1/life/plan/purpose').send({});
    expect(res.status).toBe(400);
  });
});
