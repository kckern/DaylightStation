import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

// GET /budget/range is envelope mapping over BudgetService.getBudgetRange
// (whose rules are pinned in BudgetService.test.mjs). What the ROUTE owns:
//   - a malformed/oversized range is the caller's fault -> 400 with its code,
//   - unset goals -> 409 (same as GET /budget), and
//   - a range containing an uncomputable DAY is a 200 whose array carries the
//     gap. That last one is the whole point: a 500 because one day predates
//     the weight history would make the week strip unusable.

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeApp(getBudgetRange) {
  const budgetService = {
    getGoals: vi.fn(async () => ({})),
    setGoals: vi.fn(async (_u, g) => g),
    getBudget: vi.fn(async () => ({})),
    getBudgetRange: vi.fn(getBudgetRange),
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

describe('GET /budget/range', () => {
  it('returns the days array, gaps included, as a 200', async () => {
    const days = [
      { date: '2026-08-30', error: 'NO_WEIGHT_DATA' },
      { date: '2026-08-31', budget: 1962, food: 500, exercise: 0, remaining: 1462, status: 'under', macros: { protein: 30 } },
    ];
    const { app, budgetService } = makeApp(async () => days);
    const res = await request(app).get('/api/v1/health/budget/range?from=2026-08-30&to=2026-08-31');
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual(days);
    expect(budgetService.getBudgetRange).toHaveBeenCalledWith('testuser', '2026-08-30', '2026-08-31');
  });

  it('does not get swallowed by GET /budget — the two are distinct routes', async () => {
    const { app, budgetService } = makeApp(async () => []);
    const res = await request(app).get('/api/v1/health/budget/range?from=2026-09-01&to=2026-09-01');
    expect(res.status).toBe(200);
    expect(budgetService.getBudgetRange).toHaveBeenCalled();
    expect(budgetService.getBudget).not.toHaveBeenCalled();
  });

  it('maps RANGE_INVALID to 400 with the code, not a 500', async () => {
    const { app } = makeApp(async () => { throw typedError('RANGE_INVALID: range is 152 days; the maximum is 62', 'RANGE_INVALID'); });
    const res = await request(app).get('/api/v1/health/budget/range?from=2026-01-01&to=2026-06-01');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RANGE_INVALID');
  });

  it('maps GOALS_NOT_CONFIGURED to 409, matching GET /budget', async () => {
    const { app } = makeApp(async () => { throw typedError('GOALS_NOT_CONFIGURED: set goals first', 'GOALS_NOT_CONFIGURED'); });
    const res = await request(app).get('/api/v1/health/budget/range?from=2026-09-01&to=2026-09-01');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GOALS_NOT_CONFIGURED');
  });

  it('an unexpected failure is still a 500', async () => {
    const { app } = makeApp(async () => { throw new Error('disk on fire'); });
    const res = await request(app).get('/api/v1/health/budget/range?from=2026-09-01&to=2026-09-01');
    expect(res.status).toBe(500);
  });

  it('forwards missing query params to the service so ONE place owns validation', async () => {
    const { app, budgetService } = makeApp(async () => { throw typedError('RANGE_INVALID: from and to must be YYYY-MM-DD dates', 'RANGE_INVALID'); });
    const res = await request(app).get('/api/v1/health/budget/range');
    expect(res.status).toBe(400);
    expect(budgetService.getBudgetRange).toHaveBeenCalledWith('testuser', undefined, undefined);
  });
});
