import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { requireOwnerSession } from './requireOwnerSession.mjs';
import { createTriageRouter } from './triageRouter.mjs';

const appWith = (user, triageUsername = 'alice') => {
  const app = express();
  app.use((req, _res, next) => { if (user) req.user = user; req.triageUsername = triageUsername; next(); });
  app.post('/w', requireOwnerSession, (req, res) => res.json(req.triageSession));
  return app;
};

describe('requireOwnerSession', () => {
  it('401s with no req.user', async () => {
    const res = await request(appWith(null)).post('/w');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login_required');
  });
  it('401s a session-less bearer token (sid null)', async () => {
    const res = await request(appWith({ sub: 'alice', sid: null })).post('/w');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login_required');
  });
  it('403s when the login user is not the triage user', async () => {
    const res = await request(appWith({ sub: 'alice', sid: 's1' }, 'bob')).post('/w');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('session_user_mismatch');
  });
  it('passes and sets triageSession', async () => {
    const res = await request(appWith({ sub: 'alice', sid: 's1' })).post('/w');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'alice', sid: 's1' });
  });
});

describe('router username resolution with a login', () => {
  const mk = (user) => {
    const app = express();
    app.use((req, _res, next) => { if (user) req.user = user; next(); });
    app.use(createTriageRouter({
      resolvePolicy: () => ({ enrolled: true, mode: 'dryRun' }),
      defaultUsername: 'head', isKnownUser: () => true, logger: null,
    }));
    return app;
  };
  it('defaults to req.user, not the default user', async () => {
    const res = await request(mk({ sub: 'alice', sid: 's1' })).get('/status');
    expect(res.body.username).toBe('alice');
  });
  it('explicit ?username= still wins (mismatch is caught on writes)', async () => {
    const res = await request(mk({ sub: 'alice', sid: 's1' })).get('/status?username=bob');
    expect(res.body.username).toBe('bob');
  });
});
