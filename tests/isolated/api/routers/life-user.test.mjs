import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life.mjs';

const baseConfig = {
  lifePlanStore: { load: () => null },
  driftService: {},
  alignmentService: {},
  ceremonyService: {},
  feedbackService: {},
  retroService: {},
  aggregator: {},
  goalStateService: {},
  beliefEvaluator: {},
  cadenceService: { resolve: () => ({}) },
  ceremonyRecordStore: {},
};

describe('life router user identity', () => {
  let app;

  beforeAll(() => {
    app = express();

    const userService = {
      getProfile: (username) => {
        if (username === 'test-user') return { username: 'test-user', display_name: 'Test User' };
        if (username === 'test-user-2') return { username: 'test-user-2' };
        return null;
      },
    };

    app.use('/api/v1/life', createLifeRouter({
      ...baseConfig,
      userService,
      defaultUsername: 'test-user',
    }));
  });

  it('GET /user resolves the default username with display name', async () => {
    const res = await request(app).get('/api/v1/life/user');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'test-user', displayName: 'Test User' });
  });

  it('GET /user honors ?username= override for known users', async () => {
    const res = await request(app).get('/api/v1/life/user?username=test-user-2');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('test-user-2');
    expect(res.body.displayName).toBe('test-user-2'); // no display_name → falls back
  });

  it('rejects unknown usernames with 404 on any life route', async () => {
    const res = await request(app).get('/api/v1/life/plan?username=nobody');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('nobody');
  });

  it('rejects unknown path-param usernames on log routes', async () => {
    const res = await request(app).get('/api/v1/life/log/nobody/2025-06-07');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('nobody');
  });

  it('resolves the default user on sub-routes when no username given', async () => {
    const res = await request(app).get('/api/v1/life/plan/goals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goals: [] }); // load(test-user) → null → empty list
  });
});

describe('life router without a userService (back-compat)', () => {
  it('accepts any username and defaults to "default"', async () => {
    const app = express();
    let seenUsername = null;
    app.use('/api/v1/life', createLifeRouter({
      ...baseConfig,
      lifePlanStore: { load: (u) => { seenUsername = u; return null; } },
    }));

    const res = await request(app).get('/api/v1/life/plan');
    expect(res.status).toBe(200);
    expect(seenUsername).toBe('default');
  });
});
