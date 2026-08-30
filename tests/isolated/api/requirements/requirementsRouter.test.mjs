import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createEntitlementsRouter, createRequirementsRouter } from '#api/v1/routers/requirements.mjs';

function appWith(operations) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.householdId = 'home'; req.user = { sub: 'parent-a' }; req.roles = ['parent']; next(); });
  const actorFromRequest = req => ({ id: req.user.sub, kind: 'user', roles: req.roles });
  app.use('/api/v1/requirements', createRequirementsRouter({ operations, actorFromRequest }));
  app.use('/api/v1/entitlements', createEntitlementsRouter({ operations }));
  return app;
}

describe('requirements HTTP translation', () => {
  it('derives attestation actor from request context and ignores claimed actors', async () => {
    const observeManualAttestation = vi.fn(async () => ({ result: 'observed', currentRevision: 2 }));
    const operations = { observeManualAttestation, retractManualAttestation: vi.fn(), getCurrentRequirements: vi.fn(), getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn() };
    await request(appWith(operations)).post('/api/v1/requirements/attestations').send({
      assertionId: 'a1', claimTypeId: 'chores.done', actor: { id: 'forged', roles: ['sysadmin'] },
      subject: { kind: 'learner', id: 'child' }, period: { kind: 'local_day', id: '2026-08-30', startsAt: '2026-08-30T00:00:00-07:00', endsAt: '2026-08-31T00:00:00-07:00' },
      value: true, sourceRevision: 1, observedAt: '2026-08-30T12:00:00-07:00',
    }).expect(200);
    expect(observeManualAttestation.mock.calls[0][1]).toEqual({ id: 'parent-a', kind: 'user', roles: ['parent'] });
    expect(observeManualAttestation.mock.calls[0][2]).not.toHaveProperty('actor');
  });

  it('returns replay cursor recovery metadata', async () => {
    const error = Object.assign(new Error('Replay cursor has expired'), { code: 'CURSOR_EXPIRED', status: 410, details: { oldestAvailableRevision: 5, currentRevision: 9 } });
    const operations = { replayTransitions: vi.fn(async () => { throw error; }), getCurrentRequirements: vi.fn(), getCurrentEntitlements: vi.fn(), observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn() };
    const response = await request(appWith(operations)).get('/api/v1/requirements/transitions?afterRevision=1').expect(410);
    expect(response.body).toMatchObject({ code: 'CURSOR_EXPIRED', oldestAvailableRevision: 5, currentRevision: 9 });
  });

  it('returns declared resources even before an occurrence is materialized', async () => {
    const operations = {
      getCurrentRequirements: vi.fn(async () => ({ schema: 'daylight.requirements-query/v1', currentRevision: 4, definitions: [{ id: 'chores.required' }], items: [] })),
      getCurrentEntitlements: vi.fn(async () => ({ schema: 'daylight.entitlements-query/v1', currentRevision: 4, definitions: [], items: [] })),
      replayTransitions: vi.fn(), observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    const response = await request(appWith(operations)).get('/api/v1/requirements/chores.required').expect(200);
    expect(response.body).toMatchObject({ currentRevision: 4, item: { definition: { id: 'chores.required' }, evaluation: null } });
  });

  it('maps policy unavailability without exposing internal details', async () => {
    const error = Object.assign(new Error('candidate path was secret'), { code: 'POLICY_UNAVAILABLE', status: 503 });
    const operations = {
      getCurrentRequirements: vi.fn(async () => { throw error; }),
      getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn(),
      observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    const response = await request(appWith(operations)).get('/api/v1/requirements').expect(503);
    expect(response.body).toEqual({ error: 'Internal server error', code: 'POLICY_UNAVAILABLE' });
  });
});
