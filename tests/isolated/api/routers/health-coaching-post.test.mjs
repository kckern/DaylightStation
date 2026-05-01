/**
 * POST /api/v1/health/coaching/:date isolated router test
 *
 * Covers the F-001 daily coaching compliance write endpoint.
 * Uses supertest against a router constructed with mock dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '#api/v1/routers/health.mjs';

const FAKE_DATE = '2026-05-01';

function buildApp({ setDailyCoachingUseCase, configService } = {}) {
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
    setDailyCoachingUseCase,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  app.use('/api/v1/health', router);
  return app;
}

describe('POST /api/v1/health/coaching/:date', () => {
  let executeMock;
  let app;

  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue();
    app = buildApp({
      setDailyCoachingUseCase: { execute: executeMock },
      configService: { getHeadOfHousehold: () => 'test-user' },
    });
  });

  it('invokes the use case and returns 200 on a valid body', async () => {
    const body = {
      post_workout_protein: { taken: true },
      daily_strength_micro: { movement: 'pull_up', reps: 5 },
      daily_note: 'felt strong',
    };

    const res = await request(app)
      .post(`/api/v1/health/coaching/${FAKE_DATE}`)
      .query({ username: 'test-user' })
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: expect.any(String), date: FAKE_DATE });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when no username is resolvable', async () => {
    const appNoUser = buildApp({
      setDailyCoachingUseCase: { execute: executeMock },
      configService: undefined,
    });

    const res = await request(appNoUser)
      .post(`/api/v1/health/coaching/${FAKE_DATE}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid date format', async () => {
    const res = await request(app)
      .post('/api/v1/health/coaching/not-a-date')
      .query({ username: 'test-user' })
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('passes body straight to useCase.execute()', async () => {
    const body = {
      post_workout_protein: { taken: false },
      daily_strength_micro: { movement: 'pull_up', reps: 0 },
    };

    await request(app)
      .post(`/api/v1/health/coaching/${FAKE_DATE}`)
      .query({ username: 'test-user' })
      .send(body);

    expect(executeMock).toHaveBeenCalledWith({
      userId: 'test-user',
      date: FAKE_DATE,
      coaching: body,
    });
  });

  it('returns 422 when the use case throws (validation failure)', async () => {
    executeMock.mockRejectedValueOnce(
      new TypeError('DailyCoachingEntry.post_workout_protein.taken must be a boolean')
    );

    const res = await request(app)
      .post(`/api/v1/health/coaching/${FAKE_DATE}`)
      .query({ username: 'test-user' })
      .send({ post_workout_protein: { taken: 'yes' } });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/boolean/);
  });

  it('returns 503 when setDailyCoachingUseCase is not wired', async () => {
    const appNoUseCase = buildApp({
      setDailyCoachingUseCase: undefined,
      configService: { getHeadOfHousehold: () => 'test-user' },
    });

    const res = await request(appNoUseCase)
      .post(`/api/v1/health/coaching/${FAKE_DATE}`)
      .send({});

    expect(res.status).toBe(503);
  });
});
