import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createEntitlementsRouter, createStateGatesRouter } from '#api/v1/routers/state-gates.mjs';

function appWith(operations) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.householdId = 'home'; req.user = { sub: 'parent-a' }; req.roles = ['parent']; next(); });
  const actorFromRequest = req => ({ id: req.user.sub, kind: 'user', roles: req.roles });
  app.use('/api/v1/state-gates', createStateGatesRouter({ operations, actorFromRequest }));
  app.use('/api/v1/entitlements', createEntitlementsRouter({ operations }));
  return app;
}

describe('State Gates HTTP translation', () => {
  it('derives attestation actor from request context and ignores claimed actors', async () => {
    const observeManualAttestation = vi.fn(async () => ({ result: 'observed', currentRevision: 2 }));
    const operations = { observeManualAttestation, retractManualAttestation: vi.fn(), getCurrentGates: vi.fn(), getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn() };
    await request(appWith(operations)).post('/api/v1/state-gates/attestations').send({
      assertionId: 'a1', claimTypeId: 'chores.done', actor: { id: 'forged', roles: ['sysadmin'] },
      subject: { kind: 'learner', id: 'child' }, period: { kind: 'local_day', id: '2026-08-30', startsAt: '2026-08-30T00:00:00-07:00', endsAt: '2026-08-31T00:00:00-07:00' },
      value: true, sourceRevision: 1, observedAt: '2026-08-30T12:00:00-07:00',
    }).expect(200);
    expect(observeManualAttestation.mock.calls[0][1]).toEqual({ id: 'parent-a', kind: 'user', roles: ['parent'] });
    expect(observeManualAttestation.mock.calls[0][2]).not.toHaveProperty('actor');
  });

  it('returns replay cursor recovery metadata', async () => {
    const error = Object.assign(new Error('Replay cursor has expired'), { code: 'CURSOR_EXPIRED', status: 410, details: { oldestAvailableRevision: 5, currentRevision: 9 } });
    const operations = { replayTransitions: vi.fn(async () => { throw error; }), getCurrentGates: vi.fn(), getCurrentEntitlements: vi.fn(), observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn() };
    const response = await request(appWith(operations)).get('/api/v1/state-gates/transitions?afterRevision=1').expect(410);
    expect(response.body).toMatchObject({ code: 'CURSOR_EXPIRED', oldestAvailableRevision: 5, currentRevision: 9 });
  });

  it('forwards only validated scalar collection filters', async () => {
    const getCurrentGates = vi.fn(async () => ({ definitions: [], items: [] }));
    const getCurrentEntitlements = vi.fn(async () => ({ definitions: [], items: [] }));
    const operations = {
      getCurrentGates, getCurrentEntitlements, replayTransitions: vi.fn(),
      observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    await request(appWith(operations))
      .get('/api/v1/state-gates?gateId=fitness.weekly-rings&subjectKind=learner&subjectId=learner-a&periodKind=local_day&periodId=2026-08-30')
      .expect(200);
    expect(getCurrentGates).toHaveBeenCalledWith('home', {
      subjectKind: 'learner', subjectId: 'learner-a', periodKind: 'local_day', periodId: '2026-08-30',
      gateId: 'fitness.weekly-rings',
    });

    await request(appWith(operations))
      .get('/api/v1/entitlements?capabilityId=media.evening&subjectKind=household&subjectId=home')
      .expect(200);
    expect(getCurrentEntitlements).toHaveBeenCalledWith('home', {
      subjectKind: 'household', subjectId: 'home', periodKind: undefined, periodId: undefined,
      capabilityId: 'media.evening',
    });
  });

  it.each([
    ['/api/v1/state-gates?subjectKind=person', 'INVALID_QUERY_FILTER'],
    ['/api/v1/state-gates?subjectKind=learner&subjectKind=device', 'INVALID_QUERY_FILTER'],
    ['/api/v1/state-gates?subjectId=', 'INVALID_QUERY_FILTER'],
    ['/api/v1/state-gates?periodKind=day', 'INVALID_QUERY_FILTER'],
    ['/api/v1/state-gates?gateId=weekly-rings', 'INVALID_QUERY_FILTER'],
    ['/api/v1/entitlements?capabilityId=evening', 'INVALID_QUERY_FILTER'],
    ['/api/v1/state-gates/not-namespaced', 'INVALID_QUERY_FILTER'],
    ['/api/v1/entitlements/not-namespaced', 'INVALID_QUERY_FILTER'],
  ])('rejects malformed query and resource identifiers: %s', async (url, code) => {
    const operations = {
      getCurrentGates: vi.fn(), getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn(),
      observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    const response = await request(appWith(operations)).get(url).expect(400);
    expect(response.body.code).toBe(code);
    expect(operations.getCurrentGates).not.toHaveBeenCalled();
    expect(operations.getCurrentEntitlements).not.toHaveBeenCalled();
  });

  it('parses replay integers without JavaScript numeric coercion', async () => {
    const replayTransitions = vi.fn(async () => ({ events: [] }));
    const operations = {
      replayTransitions, getCurrentGates: vi.fn(), getCurrentEntitlements: vi.fn(),
      observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    await request(appWith(operations)).get('/api/v1/state-gates/transitions?afterRevision=12&limit=25').expect(200);
    expect(replayTransitions).toHaveBeenCalledWith('home', 12, 25);

    for (const [query, code] of [
      ['afterRevision=-1', 'INVALID_REPLAY_CURSOR'],
      ['afterRevision=1.0', 'INVALID_REPLAY_CURSOR'],
      ['afterRevision=1e2', 'INVALID_REPLAY_CURSOR'],
      ['afterRevision=1&afterRevision=2', 'INVALID_REPLAY_CURSOR'],
      ['limit=0', 'INVALID_REPLAY_LIMIT'],
      ['limit=1.5', 'INVALID_REPLAY_LIMIT'],
      ['limit=NaN', 'INVALID_REPLAY_LIMIT'],
      ['limit=9007199254740992', 'INVALID_REPLAY_LIMIT'],
    ]) {
      const response = await request(appWith(operations)).get(`/api/v1/state-gates/transitions?${query}`).expect(400);
      expect(response.body.code).toBe(code);
    }
    expect(replayTransitions).toHaveBeenCalledTimes(1);
  });

  it('derives the retraction actor and translates retraction timestamps', async () => {
    const retractManualAttestation = vi.fn(async () => ({ result: 'retracted' }));
    const operations = {
      retractManualAttestation, observeManualAttestation: vi.fn(), getCurrentGates: vi.fn(),
      getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn(),
    };
    await request(appWith(operations)).delete('/api/v1/state-gates/attestations/a1').send({
      sourceRevision: 2, retractedAt: '2026-08-30T19:00:00-07:00', evidenceRef: 'evidence/2',
      actor: { id: 'forged' }, publisherId: 'forged',
    }).expect(200);
    expect(retractManualAttestation).toHaveBeenCalledWith('home', {
      id: 'parent-a', kind: 'user', roles: ['parent'],
    }, {
      assertionId: 'a1', sourceRevision: 2,
      retractedAt: Date.parse('2026-08-30T19:00:00-07:00'), evidenceRef: 'evidence/2',
    });
  });

  it('returns declared resources even before an occurrence is materialized', async () => {
    const operations = {
      getCurrentGates: vi.fn(async () => ({ schema: 'daylight.state-gates-query/v1', currentRevision: 4, definitions: [{ id: 'chores.required' }], items: [] })),
      getCurrentEntitlements: vi.fn(async () => ({ schema: 'daylight.entitlements-query/v1', currentRevision: 4, definitions: [], items: [] })),
      replayTransitions: vi.fn(), observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    const response = await request(appWith(operations)).get('/api/v1/state-gates/chores.required').expect(200);
    expect(response.body).toMatchObject({ currentRevision: 4, item: { definition: { id: 'chores.required' }, evaluation: null } });
  });

  it('maps policy unavailability without exposing internal details', async () => {
    const error = Object.assign(new Error('candidate path was secret'), { code: 'POLICY_UNAVAILABLE', status: 503 });
    const operations = {
      getCurrentGates: vi.fn(async () => { throw error; }),
      getCurrentEntitlements: vi.fn(), replayTransitions: vi.fn(),
      observeManualAttestation: vi.fn(), retractManualAttestation: vi.fn(),
    };
    const response = await request(appWith(operations)).get('/api/v1/state-gates').expect(503);
    expect(response.body).toEqual({ error: 'Internal server error', code: 'POLICY_UNAVAILABLE' });
  });
});
