import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentFilterRouter } from './contentFilter.mjs';

// GET /:rk/review starts the audit a film is missing, so its list is never empty for want of one
// (2026-11-12: Terminator 2 had a refined filter and no audit; the review list showed nothing).
function appWith({ review, jobs }) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/cf', createContentFilterRouter({ getContentFilter: { execute: async () => null }, contentFilterReview: { get: async () => review }, jobs, logger }));
  return { app, logger };
}
const jobsStub = () => ({ audit: vi.fn(async () => true), state: async () => ({ running: [], queued: [] }), busyWriting: async () => false, record: async () => null });

describe('GET /:rk/review starts a missing audit', () => {
  it('no audit and no open job: one audit is requested, reason missing', async () => {
    const jobs = jobsStub();
    const { app, logger } = appWith({ review: { title: 'T2', audit: null, job: null, rows: [] }, jobs });
    const res = await request(app).get('/cf/699056/review');
    expect(res.status).toBe(200);
    expect(jobs.audit).toHaveBeenCalledTimes(1);
    expect(jobs.audit).toHaveBeenCalledWith('699056');
    expect(logger.info).toHaveBeenCalledWith('content_filter.review.audit_requested', { ratingKey: '699056', reason: 'missing' });
  });
  it('a stale audit that is not running is requested again, reason stale', async () => {
    const jobs = jobsStub();
    const { app, logger } = appWith({ review: { audit: { ok: true, fresh: false, running: false }, job: null, rows: [] }, jobs });
    await request(app).get('/cf/5/review');
    expect(logger.info).toHaveBeenCalledWith('content_filter.review.audit_requested', { ratingKey: '5', reason: 'stale' });
  });
  it('an audit already running is not requested again', async () => {
    const jobs = jobsStub();
    const { app } = appWith({ review: { audit: { ok: true, fresh: false, running: true }, job: null, rows: [] }, jobs });
    await request(app).get('/cf/5/review');
    expect(jobs.audit).not.toHaveBeenCalled();
  });
  it('a queued or running job is not interrupted by an audit', async () => {
    const jobs = jobsStub();
    const { app } = appWith({ review: { audit: null, job: { status: 'running' }, rows: [] }, jobs });
    await request(app).get('/cf/5/review');
    expect(jobs.audit).not.toHaveBeenCalled();
  });
  it('a fresh audit asks for nothing', async () => {
    const jobs = jobsStub();
    const { app } = appWith({ review: { audit: { ok: true, fresh: true, running: false }, job: null, rows: [] }, jobs });
    await request(app).get('/cf/5/review');
    expect(jobs.audit).not.toHaveBeenCalled();
  });
});
