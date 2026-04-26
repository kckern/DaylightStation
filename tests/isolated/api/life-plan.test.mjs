import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createPlanRouter from '#api/v1/routers/life/plan.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import { GoalStateService } from '#domains/lifeplan/services/GoalStateService.mjs';
import { BeliefEvaluator } from '#domains/lifeplan/services/BeliefEvaluator.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';

describe('Life Plan API Router', () => {
  let app;
  let mockStore;
  let testPlan;

  beforeEach(() => {
    testPlan = new LifePlan({
      purpose: { statement: 'Maximize joy' },
      goals: [
        { id: 'g1', name: 'Run marathon', state: 'considered' },
        { id: 'g2', name: 'Learn piano', state: 'dream' },
      ],
      beliefs: [
        { id: 'b1', if: 'Train consistently', then: 'Finish race', state: 'testing', confidence: 0.6 },
      ],
      values: [
        { id: 'v1', name: 'Health', rank: 1 },
      ],
    });

    mockStore = {
      load: vi.fn().mockReturnValue(testPlan),
      save: vi.fn(),
    };

    const router = createPlanRouter({
      lifePlanStore: mockStore,
      goalStateService: new GoalStateService(),
      beliefEvaluator: new BeliefEvaluator(),
      cadenceService: new CadenceService(),
    });

    app = express();
    app.use(express.json());
    app.use('/plan', router);
  });

  describe('GET /plan', () => {
    it('returns the full plan', async () => {
      const res = await request(app).get('/plan');
      expect(res.status).toBe(200);
      expect(res.body.purpose.statement).toBe('Maximize joy');
      expect(res.body.goals).toHaveLength(2);
    });
  });

  describe('GET /plan/goals', () => {
    it('returns all goals', async () => {
      const res = await request(app).get('/plan/goals');
      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(2);
    });

    it('filters by state', async () => {
      const res = await request(app).get('/plan/goals?state=dream');
      expect(res.status).toBe(200);
      expect(res.body.goals).toHaveLength(1);
      expect(res.body.goals[0].id).toBe('g2');
    });
  });

  describe('GET /plan/goals/:goalId', () => {
    it('returns a single goal', async () => {
      const res = await request(app).get('/plan/goals/g1');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Run marathon');
    });

    it('returns 404 for unknown goal', async () => {
      const res = await request(app).get('/plan/goals/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /plan/goals/:goalId/transition', () => {
    it('transitions a goal', async () => {
      const res = await request(app)
        .post('/plan/goals/g1/transition')
        .send({ state: 'ready', reason: 'Dependencies met' });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('ready');
      expect(mockStore.save).toHaveBeenCalled();
    });

    it('returns 400 for invalid transition', async () => {
      const res = await request(app)
        .post('/plan/goals/g2/transition')
        .send({ state: 'committed', reason: 'Skipping' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot transition/i);
    });
  });

  describe('GET /plan/beliefs', () => {
    it('returns all beliefs', async () => {
      const res = await request(app).get('/plan/beliefs');
      expect(res.status).toBe(200);
      expect(res.body.beliefs).toHaveLength(1);
    });
  });

  describe('POST /plan/beliefs/:id/evidence', () => {
    it('adds evidence to a belief', async () => {
      const res = await request(app)
        .post('/plan/beliefs/b1/evidence')
        .send({ type: 'confirmation', date: '2025-06-01' });
      expect(res.status).toBe(200);
      expect(res.body.confidence).toBeGreaterThan(0.6);
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('GET /plan/cadence', () => {
    it('returns cadence config and current position', async () => {
      const res = await request(app).get('/plan/cadence');
      expect(res.status).toBe(200);
      expect(res.body.current).toBeDefined();
      expect(res.body.current.unit).toBeDefined();
      expect(res.body.current.cycle).toBeDefined();
    });
  });
});
