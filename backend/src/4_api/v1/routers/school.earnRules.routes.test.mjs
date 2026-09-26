/**
 * The teacher console's rate edits. They live under /api/v1/school/teacher so
 * the teacher capability cookie (scoped to /api/v1/school) rides the `pin`
 * argument like every other teacher write; the economy's own /api/v1/earnings
 * stays read-only.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';

class GuestForbiddenError extends Error {}

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

describe('PUT /teacher/economy/earn-rates/:learnerId', () => {
  it('sets one learner\'s rates as the acting teacher and returns the new revision', async () => {
    const manageEarnRules = { setLearnerRates: vi.fn(async () => ({ revision: 3 })), setHouseholdRules: vi.fn() };
    const res = await request(app({ manageEarnRules }))
      .put('/api/v1/school/teacher/economy/earn-rates/learner-a')
      .send({ actorId: 'parent', pin: '1234', patch: { multiplier: 2 } })
      .expect(200);
    expect(res.body).toEqual({ revision: 3 });
    expect(manageEarnRules.setLearnerRates).toHaveBeenCalledWith({ learnerId: 'learner-a', patch: { multiplier: 2 }, actorId: 'parent', pin: '1234' });
  });

  it('a refused gate is a 403 with the gate\'s sentence', async () => {
    const manageEarnRules = { setLearnerRates: vi.fn(async () => { throw new GuestForbiddenError('Only a grown-up can do this.'); }), setHouseholdRules: vi.fn() };
    const res = await request(app({ manageEarnRules }))
      .put('/api/v1/school/teacher/economy/earn-rates/learner-a')
      .send({ actorId: 'kid', patch: {} })
      .expect(403);
    expect(res.body.error).toBe('Only a grown-up can do this.');
  });

  it('is a 404 when the economy is not wired', async () => {
    await request(app()).put('/api/v1/school/teacher/economy/earn-rates/learner-a').send({}).expect(404);
  });
});

describe('PUT /teacher/economy/earn-rules', () => {
  it('replaces the household rules as the acting teacher', async () => {
    const manageEarnRules = { setLearnerRates: vi.fn(), setHouseholdRules: vi.fn(async () => ({ revision: 4 })) };
    await request(app({ manageEarnRules }))
      .put('/api/v1/school/teacher/economy/earn-rules')
      .send({ actorId: 'parent', pin: '1234', doc: { rules: [] } })
      .expect(200, { revision: 4 });
    expect(manageEarnRules.setHouseholdRules).toHaveBeenCalledWith({ doc: { rules: [] }, actorId: 'parent', pin: '1234' });
  });
});
