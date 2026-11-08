import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentFilterRouter } from '../../../../__app_modules/media/media/server/api/contentFilter.mjs';
import { ReviewError } from '../../../../__app_modules/media/media/server/application/content-filter/usecases/ContentFilterReview.mjs';

const mk = ({ review = {}, scenes = {}, busy = false, audit = vi.fn(async () => true) } = {}) => {
  const app = express();
  app.use(express.json());
  const jobs = { busyWriting: async () => busy, audit, state: async () => ({}), record: async () => null, enqueue: async () => ({}) };
  app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => ({}) }, contentFilterScenes: { ruleCue: async () => ({}), rule: async () => ({}), ...scenes },
    contentFilterReview: review, jobs, logger: { info() {}, warn() {} } }));
  return { app, audit };
};

describe('content-filter review routes', () => {
  test('every write is refused with 409 while a run is writing the film', async () => {
    const { app } = mk({ busy: true });
    for (const [m, url] of [['put', '/cf/9/cues/va1'], ['put', '/cf/9/scenes/sc1'], ['put', '/cf/9/words/damn'], ['put', '/cf/9/review/cue:va1'], ['post', '/cf/9/signoff'], ['put', '/cf/9/settings']]) {
      const res = await request(app)[m](url).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('A filter run is writing this film. Try again when it finishes.');
    }
  });
  test('a nudge on a cue goes to the review use case and re-audits the film', async () => {
    const nudgeCue = vi.fn(async () => ({}));
    const { app, audit } = mk({ review: { nudgeCue } });
    const res = await request(app).put('/cf/9/cues/va1').send({ nudge: { in: 1, out: 2 } });
    expect(res.status).toBe(200);
    expect(nudgeCue).toHaveBeenCalledWith({ ratingKey: '9', cueId: 'va1', nudge: { in: 1, out: 2 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(audit).toHaveBeenCalledWith('9');
  });
  test('a refused nudge keeps its status', async () => {
    const { app } = mk({ review: { nudgeCue: async () => { throw new ReviewError('A nudge can move each edge at most 30 seconds.', 400); } } });
    expect((await request(app).put('/cf/9/cues/va1').send({ nudge: { in: 1, out: 99 } })).status).toBe(400);
  });
  test('marks: a stale span is 409, a bad row id is 400, and marks do not re-audit', async () => {
    const { app, audit } = mk({ review: { markReviewed: async () => { throw new ReviewError('This part moved. Reload the list.', 409); } } });
    const stale = await request(app).put('/cf/9/review/cue:va1').send({ span: [1, 2] });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('This part moved. Reload the list.');
    expect((await request(app).put('/cf/9/review/bogus').send({})).status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
  });
  test('sign-off refused carries the missing lines; GET review returns the state', async () => {
    const { app } = mk({ review: {
      approve: async () => { throw new ReviewError('Not ready to approve.', 409, { missing: ['2 of 2 parts not reviewed'] }); },
      get: async () => ({ rows: [], signOff: { ready: false } }),
    } });
    const res = await request(app).post('/cf/9/signoff').send({});
    expect(res.status).toBe(409);
    expect(res.body.missing).toEqual(['2 of 2 parts not reviewed']);
    expect((await request(app).get('/cf/9/review')).body.signOff.ready).toBe(false);
  });
});

describe('GET /library', () => {
  test('passes stage and q, and a write invalidates the film', async () => {
    const list = vi.fn(async () => ({ films: [] })); const invalidate = vi.fn();
    const app = express(); app.use(express.json());
    const jobs = { busyWriting: async () => false, audit: async () => true };
    app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => ({}) }, contentFilterScenes: { ruleCue: async () => ({}) },
      contentFilterLibrary: { list, invalidate }, jobs, logger: { info() {}, warn() {} } }));
    await request(app).get('/cf/library?stage=rough&q=annie');
    expect(list).toHaveBeenCalledWith({ stage: 'rough', q: 'annie' });
    await request(app).put('/cf/9/cues/va1').send({ effect: 'mute' });
    expect(invalidate).toHaveBeenCalledWith('9');
  });
});
