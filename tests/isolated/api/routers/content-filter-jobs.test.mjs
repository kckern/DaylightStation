import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentFilterRouter } from '../../../../__app_modules/media/media/server/api/contentFilter.mjs';
import { JobConflict } from '../../../../__app_modules/media/media/server/application/content-filter/jobs/ContentFilterJobs.mjs';

const mk = (jobs) => {
  const app = express();
  app.use(express.json());
  app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => ({}) }, jobs, logger: { info() {}, warn() {} } }));
  return app;
};

describe('content-filter jobs routes', () => {
  test('GET /jobs returns the queue state, not a film', async () => {
    const state = vi.fn(async () => ({ running: [{ ratingKey: '1', runId: 'r', step: 'refine' }], queued: [] }));
    const res = await request(mk({ state })).get('/cf/jobs');
    expect(res.status).toBe(200);
    expect(res.body.running[0].step).toBe('refine');
  });
  test('GET /:rk/jobs returns the record, or an empty one', async () => {
    const res = await request(mk({ record: async () => null })).get('/cf/42/jobs');
    expect(res.body).toEqual({ ratingKey: '42', runs: [] });
  });
  test('POST /:rk/jobs queues a run (202), 409 on conflict, 400 on bad input', async () => {
    const enqueue = vi.fn(async (o) => ({ id: 'r1', ...o }));
    const ok = await request(mk({ enqueue })).post('/cf/42/jobs').send({ kind: 'send-back', cues: ['va1'] });
    expect(ok.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ ratingKey: '42', kind: 'send-back', cues: ['va1'] }));
    const busy = await request(mk({ enqueue: async () => { throw new JobConflict(); } })).post('/cf/42/jobs').send({});
    expect(busy.status).toBe(409);
    const badStage = await request(mk({ enqueue: async () => { throw Object.assign(new Error('Unknown stage: x'), { status: 400 }); } })).post('/cf/42/jobs').send({ kind: 'stage', stage: 'x' });
    expect(badStage.status).toBe(400);
    expect((await request(mk({ enqueue })).post('/cf/42/jobs').send({ cues: ['../x'] })).status).toBe(400);
  });
});

describe('remote filter worker routes', () => {
  test('claim: 204 when nothing is queued, the claim otherwise; owner required', async () => {
    let next = null;
    const app = mk({ claimRemote: async ({ owner }) => (next ? { ...next, owner } : null) });
    expect((await request(app).post('/cf/jobs/claim').send({})).status).toBe(400);
    expect((await request(app).post('/cf/jobs/claim').send({ owner: 'w1' })).status).toBe(204);
    next = { ratingKey: '77', run: { id: 'r1' }, steps: ['refine'], inputs: {} };
    const res = await request(app).post('/cf/jobs/claim').send({ owner: 'w1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ratingKey: '77', owner: 'w1' });
  });
  test('progress and complete pass through; a run that is no longer yours is 409', async () => {
    const complete = vi.fn(async () => ({ status: 'done' }));
    const app = mk({ progress: async () => { throw new JobConflict('This run is no longer yours.'); }, complete });
    const p = await request(app).post('/cf/77/jobs/r1/progress').send({ owner: 'w1', step: { name: 'refine', status: 'running' } });
    expect(p.status).toBe(409);
    const c = await request(app).post('/cf/77/jobs/r1/complete').send({ owner: 'w1', status: 'done', results: { refined: { cues: [] } } });
    expect(c.status).toBe(200);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ ratingKey: '77', runId: 'r1', owner: 'w1', status: 'done', results: { refined: { cues: [] } } }));
  });
});
