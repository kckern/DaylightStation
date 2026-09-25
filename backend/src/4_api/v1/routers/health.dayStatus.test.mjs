/**
 * The day view's Done / Fasted buttons: GET /day carries the day's closure and
 * the coach's completeness threshold; POST /nutrition/day-status sets or clears it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
let app, closures;

beforeEach(() => {
  closures = { '2026-09-20': true };
  const healthData = {
    loadDayClosedData: async () => ({ ...closures }),
    markDayStatus: async (u, date, status) => { closures = { ...closures, [date]: { status, at: "now" } }; },
    clearDayStatus: async (u, date) => { const { [date]: _gone, ...rest } = closures; closures = rest; },
    setMealFast: async (u, date, meal, fasted) => {
      const rec = { ...(closures[date] || {}) };
      const meals = { ...(rec.meals || {}) };
      if (fasted) meals[meal] = { status: 'fasting', at: 'now' }; else delete meals[meal];
      closures = { ...closures, [date]: { ...rec, meals } };
    },
  };
  const nutritionItems = { findByDate: async () => [] };
  const operations = new HealthOperations({ healthData, nutritionItems, resolveDefaultUsername: () => 'kc',
    today: () => '2026-09-24', completeness: () => ({ min_calories: 1300 }) });
  app = express();
  app.use('/api/v1/health', createHealthRouter({ healthOperations: operations, logger,
    budgetService: { getBudget: async () => ({ food: 0 }) } }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
});

describe('day status threshold', () => {
  it('minCalories is the per-user budget floor when goals set one', async () => {
    const operations = new HealthOperations({ healthData: { loadDayClosedData: async () => ({}) },
      resolveDefaultUsername: () => 'kc', today: () => '2026-09-24',
      completeness: () => ({ min_calories: 1300 }), budgetFloor: async () => 1100 });
    expect((await operations.readDayStatus('kc', '2026-09-24')).minCalories).toBe(1100);
  });

  it('falls back to the coaching threshold when the floor is missing or unreadable', async () => {
    const base = { healthData: { loadDayClosedData: async () => ({}) }, resolveDefaultUsername: () => 'kc',
      today: () => '2026-09-24', completeness: () => ({ min_calories: 1300 }) };
    expect((await new HealthOperations({ ...base, budgetFloor: async () => null }).readDayStatus('kc', '2026-09-24')).minCalories).toBe(1300);
    expect((await new HealthOperations({ ...base, budgetFloor: async () => { throw new Error('x'); } }).readDayStatus('kc', '2026-09-24')).minCalories).toBe(1300);
  });
});

describe('day status', () => {
  it('GET /day reports the closure (legacy `true` reads as done) and the threshold', async () => {
    const res = await request(app).get('/api/v1/health/day?date=2026-09-20');
    expect(res.body.dayStatus).toEqual({ status: 'done', minCalories: 1300, today: '2026-09-24', fastedMeals: [] });
    const open = await request(app).get('/api/v1/health/day?date=2026-09-23');
    expect(open.body.dayStatus).toEqual({ status: null, minCalories: 1300, today: '2026-09-24', fastedMeals: [] });
  });

  it('POST marks a fast, then reopens it', async () => {
    const fast = await request(app).post('/api/v1/health/nutrition/day-status').send({ date: '2026-09-23', status: 'fasting' });
    expect(fast.status).toBe(200);
    expect(fast.body).toEqual({ status: 'fasting', minCalories: 1300, today: '2026-09-24', fastedMeals: [] });
    const reopened = await request(app).post('/api/v1/health/nutrition/day-status').send({ date: '2026-09-23', status: null });
    expect(reopened.body.status).toBeNull();
    expect(closures['2026-09-23']).toBeUndefined();
  });

  it('POST /nutrition/meal-fast marks one meal fasted without closing the day, and undoes it', async () => {
    const res = await request(app).post('/api/v1/health/nutrition/meal-fast').send({ date: '2026-09-23', meal: 'morning', fasted: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: null, fastedMeals: ['morning'] });
    const undone = await request(app).post('/api/v1/health/nutrition/meal-fast').send({ date: '2026-09-23', meal: 'morning', fasted: false });
    expect(undone.body).toMatchObject({ status: null, fastedMeals: [] });
  });

  it('meal-fast refuses an unknown meal, a malformed date or a future day', async () => {
    for (const body of [{ date: '2026-09-23', meal: 'brunch', fasted: true }, { date: 'nope', meal: 'morning', fasted: true }, { date: '2026-09-25', meal: 'morning', fasted: true }]) {
      const res = await request(app).post('/api/v1/health/nutrition/meal-fast').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('refuses a bad status, a malformed date, or a future day', async () => {
    for (const body of [{ date: '2026-09-23', status: 'maybe' }, { date: 'yesterday', status: 'done' }, { date: '2026-09-25', status: 'done' }]) {
      const res = await request(app).post('/api/v1/health/nutrition/day-status').send(body);
      expect(res.status).toBe(400);
    }
    expect(Object.keys(closures)).toEqual(['2026-09-20']);
  });
});
