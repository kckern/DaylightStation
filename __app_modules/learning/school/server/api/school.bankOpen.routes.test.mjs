/**
 * `POST /api/v1/school/bank/open` — the coin bank's panel door
 * (`OpenBankAtPanel`). The use case owns every check; the route maps its
 * stamped `status` to the response and reads only `screenId` and `learnerId`.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from "../../../../../tests/_lib/school/schoolRouterTestSupport.mjs";

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

const refusing = (status, message) => ({
  open: vi.fn(async () => { const error = new Error(message); error.status = status; throw error; }),
});

describe('POST /bank/open', () => {
  it('hands the launch target back, uncached, from the body\'s screen and learner alone', async () => {
    const openBankAtPanel = { open: vi.fn(async () => ({ launchTarget: { kind: 'program', program: 'economy-bank', learnerId: 'kid', bankGrant: 'g' } })) };
    const res = await request(app({ openBankAtPanel }))
      .post('/api/v1/school/bank/open')
      .send({ screenId: 'portal', learnerId: 'kid', extra: 'ignored' })
      .expect(200);
    expect(res.body.launchTarget).toEqual({ kind: 'program', program: 'economy-bank', learnerId: 'kid', bankGrant: 'g' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(openBankAtPanel.open).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'kid' });
  });

  it('a refusal keeps its status and its sentence', async () => {
    const res = await request(app({ openBankAtPanel: refusing(403, 'Choose a current School learner.') }))
      .post('/api/v1/school/bank/open').send({ learnerId: 'ghost' }).expect(403);
    expect(res.body.error).toBe('Choose a current School learner.');
  });

  it('a missing panel is the use case\'s 503, not an internal error', async () => {
    await request(app({ openBankAtPanel: refusing(503, 'No School panel is configured. Ask a grown-up.') }))
      .post('/api/v1/school/bank/open').send({ learnerId: 'kid' }).expect(503);
  });

  it('is a 404 when the door is not wired', async () => {
    await request(app()).post('/api/v1/school/bank/open').send({ learnerId: 'kid' }).expect(404);
  });
});
