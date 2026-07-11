import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life.mjs';
import { CeremonyService } from '#apps/lifeplan/services/CeremonyService.mjs';

const baseConfig = {
  lifePlanStore: { load: () => null },
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
};

const cadenceService = {
  resolve: () => ({
    unit: { periodId: '2026-07-09' },
    cycle: { periodId: '2026-W28' },
    phase: { periodId: '2026-P3' },
    season: { periodId: '2026-S2' },
    era: { periodId: 'era-1' },
  }),
};

// Minimal plan shape that CeremonyService.getCeremonyContent needs for unit_intention.
const minimalPlan = {
  cadence: {},
  goals: [],
  qualities: [],
};

function buildApp({ plan }) {
  const lifePlanStore = { load: () => plan };
  const ceremonyRecordStore = { saveRecord: () => {} };
  const ceremonyService = new CeremonyService({ lifePlanStore, ceremonyRecordStore, cadenceService });

  const app = express();
  app.use(express.json());
  app.use('/api/v1/life', createLifeRouter({
    ...baseConfig,
    lifePlanStore,
    ceremonyRecordStore,
    cadenceService,
    ceremonyService,
  }));
  return app;
}

describe('ceremony endpoints without a plan', () => {
  let app;
  let appWithPlan;

  beforeAll(() => {
    app = buildApp({ plan: null });
    appWithPlan = buildApp({ plan: minimalPlan });
  });

  it('GET returns 404 NO_PLAN for a valid type when user has no plan', async () => {
    const res = await request(app).get('/api/v1/life/plan/ceremony/unit_intention');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_PLAN');
  });

  it('POST complete returns 404 NO_PLAN when user has no plan', async () => {
    const res = await request(app).post('/api/v1/life/plan/ceremony/unit_intention/complete').send({ responses: {} });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_PLAN');
  });

  it('still returns 400 for a genuinely unknown type when a plan exists', async () => {
    const res = await request(appWithPlan).get('/api/v1/life/plan/ceremony/nonsense_type');
    expect(res.status).toBe(400);
  });

  it('valid type with a plan returns 200 content', async () => {
    const res = await request(appWithPlan).get('/api/v1/life/plan/ceremony/unit_intention');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('unit_intention');
  });

  it('POST complete with a plan and valid type returns 200', async () => {
    const res = await request(appWithPlan).post('/api/v1/life/plan/ceremony/unit_intention/complete').send({ responses: {} });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST complete still returns 400 for an unknown type when a plan exists', async () => {
    const res = await request(appWithPlan).post('/api/v1/life/plan/ceremony/nonsense_type/complete').send({ responses: {} });
    expect(res.status).toBe(400);
  });
});
