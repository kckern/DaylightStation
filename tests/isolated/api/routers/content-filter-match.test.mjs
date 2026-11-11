import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentFilterRouter } from '../../../../__app_modules/media/media/server/api/contentFilter.mjs';
import { ReviewError } from '../../../../__app_modules/media/media/server/application/content-filter/usecases/ContentFilterReview.mjs';

// A film the library cannot match to Plex: its page says why, and it never gets a run.
const unmatched = { ratingKey: '9', title: 'Casino Royale', year: 2006, match: 'unmatched', unmatched: { reason: 'year-mismatch', text: 'Plex has the 1954 film' }, runtimeWarning: null };
const verified = { ratingKey: '9', title: 'Gladiator', year: 2000, match: 'verified', unmatched: null, runtimeWarning: null };
const mk = (verdict, review = async () => ({ rows: [], signOff: { ready: false } })) => {
  const app = express();
  app.use(express.json());
  const enqueue = vi.fn(async (o) => ({ id: 'r1', ...o }));
  const get = vi.fn(review);
  const jobs = { busyWriting: async () => false, audit: async () => true, state: async () => ({}), record: async () => null, enqueue };
  const contentFilterLibrary = { list: async () => ({ films: [] }), invalidate: () => {}, matchOf: vi.fn(async () => verdict) };
  app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => ({}) }, contentFilterReview: { get }, contentFilterLibrary, jobs, logger: { info() {}, warn() {} } }));
  return { app, enqueue, get };
};

describe('content-filter routes for a film not matched to Plex', () => {
  test('GET /:rk/review with nothing to review answers 200 with the reason', async () => {
    const { app } = mk(unmatched, async () => { throw new ReviewError('This film has no refined filter yet.', 404); });
    const res = await request(app).get('/cf/9/review');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Casino Royale', year: 2006, match: 'unmatched', unmatched: { text: 'Plex has the 1954 film' } });
    expect(res.body.rows).toBeUndefined();
  });
  test('GET /:rk/review of a key with household work still returns the review, marked not matched', async () => {
    const { app } = mk(unmatched, async () => ({ title: 'Casino Royale', rows: [{ id: 'cue:a' }], signOff: { ready: false } }));
    const res = await request(app).get('/cf/9/review');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rows: [{ id: 'cue:a' }], match: 'unmatched', unmatched: { text: 'Plex has the 1954 film' } });
  });
  test('POST /:rk/jobs is refused with 409 and the reason', async () => {
    const { app, enqueue } = mk(unmatched);
    const res = await request(app).post('/cf/9/jobs').send({ kind: 'make' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not matched to Plex: Plex has the 1954 film/);
    expect(enqueue).not.toHaveBeenCalled();
  });
  test('a verified film is reviewed and run as before', async () => {
    const { app, enqueue, get } = mk(verified);
    expect((await request(app).get('/cf/9/review')).status).toBe(200);
    expect(get).toHaveBeenCalled();
    expect((await request(app).post('/cf/9/jobs').send({ kind: 'make' })).status).toBe(202);
    expect(enqueue).toHaveBeenCalled();
  });
});
