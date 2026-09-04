import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

// The route's job for goals is envelope mapping. BudgetService owns the shape
// rules (BudgetService.test.mjs); this pins that a refused shape comes back as
// a 400 with its code, NOT as a 500 — a goals form cannot tell a person what to
// fix if a bad payload reads as a server failure.

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeApp(setGoals) {
  const budgetService = {
    getGoals: vi.fn(async () => ({ heightIn: 70 })),
    setGoals: vi.fn(setGoals),
    getBudget: vi.fn(async () => ({})),
  };
  const router = createHealthRouter({
    healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-02' },
    budgetService,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/health', router);
  return { app, budgetService };
}

describe('PUT /goals — refusal envelopes (Task 6.1)', () => {
  it('maps GOALS_INVALID to 400 with the code, not a 500', async () => {
    const { app } = makeApp(async () => {
      throw typedError("GOALS_INVALID: watchMicros.sodium.direction must be one of ceiling, floor", 'GOALS_INVALID');
    });
    const res = await request(app).put('/api/v1/health/goals')
      .send({ watchMicros: [{ key: 'sodium', limit: 2300, direction: 'up' }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GOALS_INVALID');
    expect(res.body.error).toMatch(/direction/);
  });

  it('still maps a write failure to a 500', async () => {
    const { app } = makeApp(async () => { throw typedError('GOALS_WRITE_FAILED: disk', 'GOALS_WRITE_FAILED'); });
    const res = await request(app).put('/api/v1/health/goals').send({ heightIn: 70 });
    expect(res.status).toBe(500);
  });

  it('passes a valid payload through untouched', async () => {
    const { app, budgetService } = makeApp(async (_userId, goals) => goals);
    const payload = {
      heightIn: 70,
      macroGoals: { proteinG: 150, carbsG: null, fatG: 60 },
      watchMicros: [{ key: 'sodium', limit: 2300, direction: 'ceiling' }],
    };
    const res = await request(app).put('/api/v1/health/goals').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.goals).toEqual(payload);
    expect(budgetService.setGoals).toHaveBeenCalledWith('testuser', payload);
  });
});
