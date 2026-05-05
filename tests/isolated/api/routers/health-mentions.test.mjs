// tests/isolated/api/routers/health-mentions.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthMentionsRouter } from '../../../../backend/src/4_api/v1/routers/health-mentions.mjs';

function makeApp(deps = {}) {
  const fakeDeps = {
    healthAnalyticsService: {
      listPeriods: vi.fn(async ({ userId }) => ({
        periods: [
          { slug: '2017-cut', label: '2017 Cut', from: '2017-01-15', to: '2017-04-30', source: 'declared' },
          { slug: 'stable-195', label: 'Stable 195', from: '2024-08-01', to: '2024-11-15', source: 'remembered' },
        ],
      })),
    },
    ...deps,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/health/mentions', createHealthMentionsRouter(fakeDeps));
  return { app, deps: fakeDeps };
}

describe('GET /api/v1/health/mentions/periods', () => {
  it('returns rolling vocab + named periods unfiltered', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/mentions/periods?user=kc');
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toBeDefined();
    const slugs = res.body.suggestions.map(s => s.slug);
    // Rolling vocab present
    expect(slugs).toContain('last_30d');
    expect(slugs).toContain('all_time');
    // Calendar vocab present
    expect(slugs).toContain('this_year');
    // Named periods present
    expect(slugs).toContain('2017-cut');
    expect(slugs).toContain('stable-195');
  });

  it('filters by prefix substring (case-insensitive)', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/mentions/periods?user=kc&prefix=cut');
    expect(res.status).toBe(200);
    const slugs = res.body.suggestions.map(s => s.slug);
    expect(slugs).toContain('2017-cut');
    expect(slugs).not.toContain('last_30d');
  });

  it('each suggestion has slug, label, value, group=period', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/mentions/periods?user=kc');
    for (const s of res.body.suggestions) {
      expect(s.slug).toBeDefined();
      expect(s.label).toBeDefined();
      expect(s.value).toBeDefined();
      expect(s.group).toBe('period');
    }
  });

  it('returns 400 when user param missing', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/health/mentions/periods');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user/);
  });

  it('survives healthAnalyticsService.listPeriods throwing (named periods unavailable)', async () => {
    const { app } = makeApp({
      healthAnalyticsService: {
        listPeriods: async () => { throw new Error('no working memory'); },
      },
    });
    const res = await request(app).get('/api/v1/health/mentions/periods?user=kc');
    expect(res.status).toBe(200);
    // Rolling+calendar vocab still present
    const slugs = res.body.suggestions.map(s => s.slug);
    expect(slugs).toContain('last_30d');
  });
});

describe('GET /api/v1/health/mentions/recent-days', () => {
  function deps() {
    return {
      healthAnalyticsService: { listPeriods: async () => ({ periods: [] }) },
      healthStore: {
        loadWeightData: async () => ({
          '2026-05-04': { lbs: 197 }, '2026-05-05': { lbs: 196.5 },
        }),
        loadNutritionData: async () => ({
          '2026-05-03': { calories: 2000 }, '2026-05-05': { calories: 2100 },
        }),
      },
      healthService: {
        getHealthForRange: async () => ({
          '2026-05-04': { workouts: [{ type: 'run', duration: 30 }] },
        }),
      },
      now: () => new Date('2026-05-05T12:00:00Z'),
    };
  }

  it('returns N days with per-day data flags', async () => {
    const { app } = makeApp(deps());
    const res = await request(app).get('/api/v1/health/mentions/recent-days?user=kc&days=7');
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBe(7);
    const may4 = res.body.suggestions.find(s => s.slug === '2026-05-04');
    expect(may4).toBeDefined();
    expect(may4.has).toMatchObject({ weight: true, workout: true, nutrition: false });
    expect(may4.group).toBe('day');
  });

  it('?has=workout filters to days with workouts', async () => {
    const { app } = makeApp(deps());
    const res = await request(app).get('/api/v1/health/mentions/recent-days?user=kc&days=7&has=workout');
    expect(res.body.suggestions.every(s => s.has.workout)).toBe(true);
    const slugs = res.body.suggestions.map(s => s.slug);
    expect(slugs).toContain('2026-05-04');
    expect(slugs).not.toContain('2026-05-03');
  });

  it('?has=nutrition filters to days with nutrition', async () => {
    const { app } = makeApp(deps());
    const res = await request(app).get('/api/v1/health/mentions/recent-days?user=kc&days=7&has=nutrition');
    expect(res.body.suggestions.every(s => s.has.nutrition)).toBe(true);
  });

  it('?has=weight filters to days with weight', async () => {
    const { app } = makeApp(deps());
    const res = await request(app).get('/api/v1/health/mentions/recent-days?user=kc&days=7&has=weight');
    expect(res.body.suggestions.every(s => s.has.weight)).toBe(true);
  });

  it('returns 400 when user missing', async () => {
    const { app } = makeApp(deps());
    const res = await request(app).get('/api/v1/health/mentions/recent-days?days=7');
    expect(res.status).toBe(400);
  });
});
