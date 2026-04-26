import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life.mjs';

describe('GET /api/v1/life/health', () => {
  let app;

  beforeAll(() => {
    app = express();

    const config = {
      lifePlanStore: {
        load: (username) => {
          if (username === 'missing') return null;
          return {
            goals: [{ id: 'g1' }, { id: 'g2' }],
            beliefs: [{ id: 'b1' }],
            values: [{ id: 'v1' }],
            ceremonies: {
              unit_intention: { enabled: true },
              cycle_retro: { enabled: true },
              phase_review: { enabled: false },
            },
          };
        },
      },
      driftService: {
        getLatestSnapshot: () => ({
          timestamp: new Date().toISOString(),
          date: '2025-06-07',
        }),
      },
      alignmentService: {},
      ceremonyService: {},
      feedbackService: {},
      retroService: {},
      aggregator: {},
      // Stubs for sub-routers
      goalStateService: { transition: () => {} },
      beliefEvaluator: {},
      cadenceService: {},
      ceremonyRecordStore: {},
    };

    app.use('/api/v1/life', createLifeRouter(config));
  });

  it('returns ok status with all checks', async () => {
    const res = await request(app).get('/api/v1/life/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toBeDefined();
  });

  it('reports plan loaded with counts', async () => {
    const res = await request(app).get('/api/v1/life/health');

    expect(res.body.checks.plan.loaded).toBe(true);
    expect(res.body.checks.plan.goalCount).toBe(2);
    expect(res.body.checks.plan.beliefCount).toBe(1);
    expect(res.body.checks.plan.valueCount).toBe(1);
  });

  it('reports metrics snapshot status', async () => {
    const res = await request(app).get('/api/v1/life/health');

    expect(res.body.checks.metrics.hasSnapshot).toBe(true);
    expect(res.body.checks.metrics.lastTimestamp).toBeDefined();
    expect(res.body.checks.metrics.ageMs).toBeLessThan(5000);
  });

  it('lists enabled ceremony types', async () => {
    const res = await request(app).get('/api/v1/life/health');

    expect(res.body.checks.ceremonies.enabledCount).toBe(2);
    expect(res.body.checks.ceremonies.types).toContain('unit_intention');
    expect(res.body.checks.ceremonies.types).toContain('cycle_retro');
    expect(res.body.checks.ceremonies.types).not.toContain('phase_review');
  });

  it('reports service availability', async () => {
    const res = await request(app).get('/api/v1/life/health');

    const services = res.body.checks.services;
    expect(services.alignmentService).toBe(true);
    expect(services.driftService).toBe(true);
    expect(services.ceremonyService).toBe(true);
    expect(services.feedbackService).toBe(true);
    expect(services.retroService).toBe(true);
    expect(services.aggregator).toBe(true);
  });

  it('returns degraded when plan is missing', async () => {
    const res = await request(app).get('/api/v1/life/health?username=missing');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.plan.loaded).toBe(false);
  });
});
