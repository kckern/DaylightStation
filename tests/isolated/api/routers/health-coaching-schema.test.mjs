/**
 * GET /api/v1/health/coaching/schema isolated router test (F2-D)
 *
 * Returns the user's `coaching_dimensions` schema from the playbook so the
 * frontend's CoachingComplianceCard can render generic per-dimension rows.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '#api/v1/routers/health.mjs';

function buildApp({ personalContextLoader, configService } = {}) {
  const app = express();
  const router = createHealthRouter({
    healthService: { execute: () => ({}) },
    healthStore: {
      loadWeightData: async () => ({}),
      loadActivityData: async () => ({}),
      loadFitnessData: async () => ({}),
      loadNutritionData: async () => ({}),
      loadCoachingData: async () => ({}),
    },
    longitudinalService: { aggregate: async () => ({}) },
    configService,
    personalContextLoader,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  app.use('/api/v1/health', router);
  return app;
}

describe('GET /api/v1/health/coaching/schema', () => {
  it('returns the playbook coaching_dimensions when present', async () => {
    const dims = [
      {
        key: 'morning_meditation',
        type: 'boolean',
        fields: { taken: { type: 'boolean', required: true } },
        thresholds: { consecutive_misses_trigger: 3 },
        cta_text: 'meditation cta',
      },
    ];
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      personalContextLoader: {
        loadPlaybook: vi.fn(async () => ({ coaching_dimensions: dims })),
      },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema')
      .query({ username: 'test-user' });

    expect(res.status).toBe(200);
    expect(res.body.coaching_dimensions).toEqual(dims);
  });

  it('returns an empty array when the playbook lacks coaching_dimensions', async () => {
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      personalContextLoader: {
        loadPlaybook: vi.fn(async () => ({ profile: {} })),
      },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema')
      .query({ username: 'test-user' });

    expect(res.status).toBe(200);
    expect(res.body.coaching_dimensions).toEqual([]);
  });

  it('returns an empty array when the playbook itself is missing', async () => {
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      personalContextLoader: {
        loadPlaybook: vi.fn(async () => null),
      },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema')
      .query({ username: 'test-user' });

    expect(res.status).toBe(200);
    expect(res.body.coaching_dimensions).toEqual([]);
  });

  it('returns an empty array (with warn log) when personalContextLoader is unwired', async () => {
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      // No personalContextLoader
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema')
      .query({ username: 'test-user' });

    expect(res.status).toBe(200);
    expect(res.body.coaching_dimensions).toEqual([]);
  });

  it('returns 400 when no username is resolvable', async () => {
    const app = buildApp({
      configService: undefined,
      personalContextLoader: {
        loadPlaybook: vi.fn(),
      },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('uses configService default when username query param absent', async () => {
    const loadPlaybook = vi.fn(async () => ({ coaching_dimensions: [] }));
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      personalContextLoader: { loadPlaybook },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema');

    expect(res.status).toBe(200);
    expect(loadPlaybook).toHaveBeenCalledWith('test-user');
  });

  it('returns 500 when loadPlaybook throws', async () => {
    const app = buildApp({
      configService: { getHeadOfHousehold: () => 'test-user' },
      personalContextLoader: {
        loadPlaybook: vi.fn(async () => { throw new Error('boom'); }),
      },
    });

    const res = await request(app)
      .get('/api/v1/health/coaching/schema')
      .query({ username: 'test-user' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/boom/);
  });
});
