import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminStateGatesRouter } from '#api/v1/routers/admin/state-gates.mjs';

function appWith(operations) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.householdId = 'home';
    req.user = { sub: 'admin-a' };
    req.roles = ['admin'];
    next();
  });
  app.use('/api/v1/admin/state-gates', createAdminStateGatesRouter({
    operations,
    actorFromRequest: req => ({ id: req.user.sub, kind: 'user', roles: req.roles }),
  }));
  return app;
}

describe('State Gates administrative HTTP translation', () => {
  it('passes the authenticated actor to policy activation', async () => {
    const activatePolicyGraph = vi.fn(async () => ({ result: 'activated', currentRevision: 3 }));
    await request(appWith({ activatePolicyGraph, getDiagnostics: vi.fn() }))
      .post('/api/v1/admin/state-gates/policy/activate')
      .send({ actor: { id: 'forged' } })
      .expect(200, { result: 'activated', currentRevision: 3 });
    expect(activatePolicyGraph).toHaveBeenCalledWith('home', {
      id: 'admin-a', kind: 'user', roles: ['admin'],
    });
  });

  it('keeps assertion provenance and policy diagnostics on separate admin resources', async () => {
    const actor = { id: 'admin-a', kind: 'user', roles: ['admin'] };
    const getDiagnostics = vi.fn(async () => ({
      currentRevision: 4,
      assertions: [{ id: 'a1', actor: { id: 'parent-a' }, evidenceRef: 'private/ref' }],
      policy: {
        active: { digest: 'digest', policyRevision: 2 },
        candidateValidation: { valid: true, errors: [] },
      },
    }));
    const app = appWith({ activatePolicyGraph: vi.fn(), getDiagnostics });

    const assertions = await request(app).get('/api/v1/admin/state-gates/assertions').expect(200);
    expect(assertions.body).toEqual({
      currentRevision: 4,
      assertions: [{ id: 'a1', actor: { id: 'parent-a' }, evidenceRef: 'private/ref' }],
    });
    const policy = await request(app).get('/api/v1/admin/state-gates/policy').expect(200);
    expect(policy.body).toEqual({
      currentRevision: 4,
      active: { digest: 'digest', policyRevision: 2 },
      candidateValidation: { valid: true, errors: [] },
    });
    expect(getDiagnostics).toHaveBeenNthCalledWith(1, 'home', actor);
    expect(getDiagnostics).toHaveBeenNthCalledWith(2, 'home', actor);
  });

  it('preserves semantic authorization failures from the application', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), {
      name: 'AuthorizationError', code: 'FORBIDDEN', status: 403,
    });
    const response = await request(appWith({
      activatePolicyGraph: vi.fn(async () => { throw forbidden; }),
      getDiagnostics: vi.fn(),
    })).post('/api/v1/admin/state-gates/policy/activate').expect(403);
    expect(response.body).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
  });
});
