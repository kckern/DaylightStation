/**
 * Route-level net for the study-day program bypass writes (the piano lesson
 * gate's parent override). The authorisation decision itself belongs to
 * `ManageProgramDayBypass`/`TeacherGate` and is tested there; what has to hold
 * HERE is the HTTP seam around it:
 *
 *  - the routes are injection-gated, so a composition without the use case
 *    answers an honest 404 instead of crashing,
 *  - the capability cookie is what reaches the use case as `pin` (the console
 *    never sends a raw PIN body), and
 *  - the use case's own refusals map to real status codes rather than a 500.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const silent = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

const ACTIVE = {
  schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1',
  learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27',
  reason: 'Recital', decidedBy: 'kckern', decidedAt: '2026-08-27T14:00:00-07:00',
};

function appWith(manageProgramDayBypass) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    manageProgramDayBypass,
    logger: silent,
  }));
  return app;
}

const fullUseCase = () => ({
  list: vi.fn(async ({ learnerId }) => ({
    schema: 'school.program-day-bypasses/v1',
    active: learnerId ? [ACTIVE] : [ACTIVE, { ...ACTIVE, bypassId: 'pdb_2', learnerId: 'kid2' }],
    history: [ACTIVE],
  })),
  grant: vi.fn(async (args) => ({ ...ACTIVE, ...args })),
  retract: vi.fn(async ({ bypassId }) => ({ operation: 'retracted', bypassId })),
});

describe('GET /program-day-bypasses', () => {
  it('passes the learner filter through and does not cache', async () => {
    const uc = fullUseCase();
    const response = await request(appWith(uc)).get('/api/v1/school/program-day-bypasses?learnerId=kid1');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.active).toHaveLength(1);
    expect(uc.list).toHaveBeenCalledWith({ learnerId: 'kid1' });
  });

  it('reads school-wide when no learner is named', async () => {
    const uc = fullUseCase();
    const response = await request(appWith(uc)).get('/api/v1/school/program-day-bypasses');
    expect(response.status).toBe(200);
    expect(response.body.active).toHaveLength(2);
    expect(uc.list).toHaveBeenCalledWith({ learnerId: null });
  });

  it('404s as an honest refusal, not an unknown path, when unconfigured', async () => {
    const response = await request(appWith(null)).get('/api/v1/school/program-day-bypasses');
    expect(response.status).toBe(404);
    // Asserting the BODY matters: an absent route would also 404 here, so a
    // bare status check would pass even if these routes were never mounted.
    expect(response.body.error).toMatch(/not configured/i);
  });
});

describe('POST /program-day-bypasses', () => {
  it('grants and answers 201 with the record', async () => {
    const uc = fullUseCase();
    const response = await request(appWith(uc))
      .post('/api/v1/school/program-day-bypasses')
      .send({ learnerId: 'kid1', reason: 'Recital', decidedBy: 'kckern' });

    expect(response.status).toBe(201);
    expect(response.body.bypassId).toBe('pdb_1');
    expect(uc.grant).toHaveBeenCalledWith({
      learnerId: 'kid1', programId: 'piano-course', reason: 'Recital', decidedBy: 'kckern', pin: null,
    });
  });

  it('defaults programId to piano-course', async () => {
    const uc = fullUseCase();
    await request(appWith(uc)).post('/api/v1/school/program-day-bypasses')
      .send({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });
    expect(uc.grant.mock.calls[0][0].programId).toBe('piano-course');
  });

  // The console holds an HttpOnly capability cookie and sends no PIN body;
  // the router's middleware is what turns that into the use case's `pin`.
  it('feeds the capability cookie to the use case as the pin', async () => {
    const uc = fullUseCase();
    await request(appWith(uc)).post('/api/v1/school/program-day-bypasses')
      .set('Cookie', 'daylight_teacher_session=cap-token')
      .send({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });

    expect(uc.grant.mock.calls[0][0].pin).toMatchObject({ capabilityToken: 'cap-token' });
  });

  it('maps a use case ValidationError to 400, not 500', async () => {
    const uc = fullUseCase();
    uc.grant.mockRejectedValueOnce(new ValidationError('a reason is required'));
    const response = await request(appWith(uc)).post('/api/v1/school/program-day-bypasses')
      .send({ learnerId: 'kid1', decidedBy: 'kckern' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/reason/i);
  });

  it('maps an unenrolled learner to 404', async () => {
    const uc = fullUseCase();
    uc.grant.mockRejectedValueOnce(new EntityNotFoundError('program enrollment', 'kid1:piano-course'));
    const response = await request(appWith(uc)).post('/api/v1/school/program-day-bypasses')
      .send({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });
    expect(response.status).toBe(404);
  });

  it('404s as an honest refusal, not an unknown path, when unconfigured', async () => {
    const response = await request(appWith(null)).post('/api/v1/school/program-day-bypasses').send({});
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not configured/i);
  });
});

describe('POST /program-day-bypasses/:bypassId/retract', () => {
  it('retracts the id from the path', async () => {
    const uc = fullUseCase();
    const response = await request(appWith(uc))
      .post('/api/v1/school/program-day-bypasses/pdb_1/retract')
      .send({ reason: 'wrong kid', retractedBy: 'kckern' });

    expect(response.status).toBe(200);
    expect(response.body.operation).toBe('retracted');
    expect(uc.retract).toHaveBeenCalledWith({
      bypassId: 'pdb_1', reason: 'wrong kid', retractedBy: 'kckern', pin: null,
    });
  });

  it('maps an already-retracted id to 404', async () => {
    const uc = fullUseCase();
    uc.retract.mockRejectedValueOnce(new EntityNotFoundError('active program day bypass', 'pdb_1'));
    const response = await request(appWith(uc))
      .post('/api/v1/school/program-day-bypasses/pdb_1/retract')
      .send({ reason: 'x', retractedBy: 'kckern' });
    expect(response.status).toBe(404);
  });

  it('404s as an honest refusal, not an unknown path, when unconfigured', async () => {
    const response = await request(appWith(null))
      .post('/api/v1/school/program-day-bypasses/pdb_1/retract').send({ reason: 'x' });
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not configured/i);
  });
});
