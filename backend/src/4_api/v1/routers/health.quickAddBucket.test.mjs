import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp() {
  const calls = { suggest: [], quickAdd: [] };
  const catalogService = {
    suggest: async (q, userId, limit, options) => {
      calls.suggest.push({ q, userId, limit, options });
      return [{ id: 'e1', name: 'Oatmeal' }];
    },
    quickAdd: async (catalogEntryId, userId, options) => {
      calls.quickAdd.push({ catalogEntryId, userId, options });
      return { uuid: 'row-1', mealTime: options?.mealTime ?? 'night', settled: true, settledBy: 'user' };
    },
  };
  const router = createHealthRouter({
    healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-04' },
    catalogService,
    logger: silent,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/health', router);
  return { app, calls };
}

describe('GET /nutrition/catalog/suggest — bucket param (Task 9.1)', () => {
  it('passes the bucket through to the service', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/catalog/suggest?bucket=morning');
    expect(res.status).toBe(200);
    expect(calls.suggest[0].options).toEqual({ bucket: 'morning' });
  });

  it('omitting the bucket leaves it undefined — the bucket-blind ranking', async () => {
    const { app, calls } = makeApp();
    await request(app).get('/api/v1/health/nutrition/catalog/suggest?q=oat');
    expect(calls.suggest[0].q).toBe('oat');
    expect(calls.suggest[0].options.bucket).toBeUndefined();
  });

  it('refuses a phantom bucket with 400 rather than passing it downstream', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/catalog/suggest?bucket=brunch');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid bucket/);
    expect(calls.suggest).toHaveLength(0);
  });
});

describe('POST /nutrition/catalog/quickadd — mealTime in the body (Task 9.1/9.2)', () => {
  it('applies the mealTime directly, so no follow-up PUT is needed', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1', mealTime: 'morning' });
    expect(res.status).toBe(200);
    expect(calls.quickAdd[0].options).toEqual({ mealTime: 'morning' });
    expect(res.body.item.mealTime).toBe('morning');
  });

  it('still works with no mealTime — Telegram and the coach never send one', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1' });
    expect(res.status).toBe(200);
    expect(calls.quickAdd[0].options.mealTime).toBeUndefined();
  });

  it('refuses a phantom mealTime with 400 and never logs the food', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1', mealTime: 'brunch' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mealTime/);
    expect(calls.quickAdd).toHaveLength(0);
  });
});
