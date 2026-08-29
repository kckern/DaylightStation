import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import createScheduleRouter from '#api/v1/routers/life/schedule.mjs';
import { LifePlanOperations } from '#apps/lifeplan/LifePlanOperations.mjs';

function appWith(plan) {
  const plans = { load: vi.fn(() => plan) };
  const lifePlanOperations = new LifePlanOperations({
    plans, goalStates: {}, beliefEvaluator: {}, cadence: {},
  });
  const app = express();
  app.use('/schedule', createScheduleRouter({ lifePlanOperations }));
  return { app, plans };
}

describe('life ceremony schedule contract', () => {
  const plan = {
    cadence: { unit: 'day', cycle: 'month' },
    ceremonies: {
      unit_intention: { enabled: true },
      cycle_retro: { enabled: true },
      era_vision: { enabled: false },
    },
  };

  it('keeps the JSON ceremony projection unchanged', async () => {
    const { app } = appWith(plan);
    const response = await request(app).get('/schedule/json');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ceremonies: [
      { type: 'unit_intention', level: 'unit', cadenceUnit: 'day', rrule: 'FREQ=DAILY' },
      { type: 'cycle_retro', level: 'cycle', cadenceUnit: 'month', rrule: 'FREQ=MONTHLY' },
    ] });
  });

  it('keeps iCalendar headers and body semantics unchanged', async () => {
    const { app } = appWith(plan);
    const response = await request(app).get('/schedule/ical');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/calendar; charset=utf-8/);
    expect(response.text).toContain('BEGIN:VCALENDAR');
    expect(response.text).toContain('RRULE:FREQ=DAILY');
  });

  it('rejects an unsupported format before loading the plan', async () => {
    const { app, plans } = appWith(plan);
    const response = await request(app).get('/schedule/csv');
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unsupported format: csv');
    expect(plans.load).not.toHaveBeenCalled();
  });

  it('retains the 404 error when the plan is absent', async () => {
    const { app } = appWith(null);
    const response = await request(app).get('/schedule/json');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No plan found' });
  });
});
