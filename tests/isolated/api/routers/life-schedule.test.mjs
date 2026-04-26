import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

import createScheduleRouter from '#api/v1/routers/life/schedule.mjs';

describe('GET /api/v1/life/schedule/:format', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use('/schedule', createScheduleRouter({
      cadenceService: {
        resolve: () => ({
          unit: { periodId: '2025-06-07', startDate: new Date('2025-06-07') },
          cycle: { periodId: '2025-W23', startDate: new Date('2025-06-02') },
        }),
      },
      lifePlanStore: {
        load: () => ({
          ceremonies: {
            unit_intention: { enabled: true },
            cycle_retro: { enabled: true },
            phase_review: { enabled: false },
          },
          cadence: { unit: 'day', cycle: 'week', phase: 'month' },
        }),
      },
    }));
  });

  it('returns JSON schedule', async () => {
    const res = await request(app).get('/schedule/json');
    expect(res.status).toBe(200);
    expect(res.body.ceremonies).toBeDefined();
    expect(res.body.ceremonies.length).toBeGreaterThan(0);
  });

  it('returns iCal schedule', async () => {
    const res = await request(app).get('/schedule/ical');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('BEGIN:VEVENT');
  });

  it('returns RSS schedule', async () => {
    const res = await request(app).get('/schedule/rss');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/rss+xml');
    expect(res.text).toContain('<rss version="2.0">');
    expect(res.text).toContain('<item>');
  });

  it('returns XML schedule', async () => {
    const res = await request(app).get('/schedule/xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<schedule>');
    expect(res.text).toContain('<ceremony');
  });

  it('returns 400 for unsupported format', async () => {
    const res = await request(app).get('/schedule/yaml');
    expect(res.status).toBe(400);
  });

  it('only includes enabled ceremonies', async () => {
    const res = await request(app).get('/schedule/json');
    const types = res.body.ceremonies.map(c => c.type);
    expect(types).toContain('unit_intention');
    expect(types).toContain('cycle_retro');
    expect(types).not.toContain('phase_review');
  });
});
