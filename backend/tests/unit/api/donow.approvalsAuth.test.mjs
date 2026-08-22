/**
 * The approvals token is the ONLY authentication on
 * `POST /approvals/:id/{approve,deny}` — anyone holding the string can approve
 * a parental-approval request. It must therefore be presentable out of band
 * (bearer header or body) rather than only as `?token=`, which lands in access
 * logs and in notification URLs.
 */
import express from 'express';
import request from 'supertest';
import { createDoNowRouter } from '#api/v1/routers/donow.mjs';

const approvals = {
  listPending: async () => [],
  approve: async () => ({ ok: true }),
  deny: async () => ({ ok: true }),
};

const app = (logger = { warn() {}, debug() {} }) => {
  const a = express();
  a.use('/donow', createDoNowRouter({
    service: {}, approvals, expectedToken: 'sekrit', logger,
  }));
  return a;
};

describe('donow approvals auth', () => {
  it('accepts a bearer header', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .set('Authorization', 'Bearer sekrit').expect(200);
  });

  it('accepts the token in the body', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .send({ token: 'sekrit' }).expect(200);
  });

  it('still accepts ?token= during the HA migration, but warns', async () => {
    const warns = [];
    await request(app({ warn: (e) => warns.push(e), debug() {} }))
      .post('/donow/approvals/x/approve?token=sekrit').expect(200);
    expect(warns).toContain('donow.approvals.token.query_deprecated');
  });

  it('rejects a wrong token', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .set('Authorization', 'Bearer nope').expect(401);
  });
});
