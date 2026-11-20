import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createPlanRouter from "../../../__app_modules/personal/life/server/api/life/plan.mjs";
import { LifePlan } from "../../../__app_modules/personal/life/server/domain/entities/LifePlan.mjs";
import { GoalStateService } from "../../../__app_modules/personal/life/server/domain/services/GoalStateService.mjs";
import { BeliefEvaluator } from "../../../__app_modules/personal/life/server/domain/services/BeliefEvaluator.mjs";
import { CadenceService } from "../../../__app_modules/personal/life/server/domain/services/CadenceService.mjs";
import { CeremonyDueResolver } from "../../../__app_modules/personal/life/server/domain/services/CeremonyDueResolver.mjs";
import { CeremonyScheduler } from "../../../__app_modules/personal/life/server/application/services/CeremonyScheduler.mjs";
import { presentBelief, presentGoal, presentLifePlan } from "../../../__app_modules/personal/life/server/application/presenters/lifePlanPresenter.mjs";
import { LifePlanOperations } from "../../../__app_modules/personal/life/server/application/LifePlanOperations.mjs";

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
      lifePlanOperations: new LifePlanOperations({
        plans: mockStore,
        goalStates: new GoalStateService(),
        beliefEvaluator: new BeliefEvaluator(),
        cadence: new CadenceService(),
        clock: { now: () => new Date('2026-08-28T12:34:56.000Z') },
      }),
      presentBelief,
      presentGoal,
      presentLifePlan,
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
      expect(res.body.state_history.at(-1).timestamp).toBe('2026-08-28T12:34:56.000Z');
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

    it('uses the injected operation date when evidence omits its date', async () => {
      const res = await request(app)
        .post('/plan/beliefs/b1/evidence')
        .send({ type: 'confirmation' });
      expect(res.status).toBe(200);
      expect(res.body.evidence_history.at(-1).date).toBe('2026-08-28');
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

    it('returns effective ceremony settings and preserves the cadence response for older readers', async () => {
      testPlan.cadence = { unit: 'day', ceremonies: {
        unit_capture: { enabled: false }, unit_intention: { enabled: false },
      } };
      testPlan.ceremonies = { unit_intention: { enabled: true, at: '08:00' } };
      const res = await request(app).get('/plan/cadence');
      expect(res.body.config).toEqual(testPlan.cadence);
      expect(res.body.ceremonies).toMatchObject({
        unit_intention: { enabled: true, at: '08:00' },
        unit_capture: { enabled: false },
        cycle_retro: { enabled: true },
        season_alignment: { enabled: false },
        era_vision: { enabled: false },
      });
    });
  });

  describe('PATCH /plan/ceremonies/:type', () => {
    it('commits disjoint switches without losing metadata and removes the disabled ceremony from due reminders', async () => {
      testPlan.ceremonies = {
        unit_intention: { enabled: true, at: '08:00' },
        unit_capture: { enabled: true, at: '20:00' },
      };
      let saved = structuredClone(testPlan);
      mockStore.load.mockImplementation(() => new LifePlan(structuredClone(saved)));
      mockStore.save.mockImplementation((_, plan) => { saved = structuredClone(plan); });
      const cadence = new CadenceService();
      const now = new Date('2026-08-28T20:00:00Z');
      const due = new CeremonyDueResolver({ cadenceService: cadence });
      const send = vi.fn().mockResolvedValue([{ delivered: true }]);
      const scheduler = new CeremonyScheduler({ notificationService: { send }, lifePlanStore: mockStore,
        ceremonyRecordStore: { hasRecord: () => false }, cadenceService: cadence, timezone: 'UTC', clock: { now: () => now } });
      const remind = () => scheduler.checkAndNotify('fixture');
      const dueTypes = () => due.listDue({ plan: mockStore.load(), cadencePosition: cadence.resolve(saved.cadence, now),
        cadenceConfig: saved.cadence, today: now, hasRecord: () => false }).map(item => item.type);
      expect(dueTypes()).toContain('unit_capture');
      expect(await remind()).toContainEqual(expect.objectContaining({ type: 'unit_capture' }));

      const updates = await Promise.all(['unit_capture', 'unit_intention'].map(type => (
        request(app).patch(`/plan/ceremonies/${type}?username=fixture`).send({ enabled: false })
      )));
      expect(updates.map(result => result.status)).toEqual([200, 200]);
      expect(mockStore.save.mock.calls.map(([user]) => user)).toEqual(['fixture', 'fixture']);
      const res = await request(app).get('/plan/cadence?username=fixture');
      expect(res.body.ceremonies).toMatchObject({
        unit_intention: { enabled: false, at: '08:00' },
        unit_capture: { enabled: false, at: '20:00' },
      });
      expect(dueTypes()).not.toContain('unit_capture');
      expect(await remind()).not.toContainEqual(expect.objectContaining({ type: 'unit_capture' }));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown ceremony or a non-boolean setting without saving', async () => {
      expect((await request(app).patch('/plan/ceremonies/unknown').send({ enabled: true })).status).toBe(400);
      expect((await request(app).patch('/plan/ceremonies/unit_intention').send({ enabled: 'false' })).status).toBe(400);
      expect(mockStore.save).not.toHaveBeenCalled();
    });
  });
});
