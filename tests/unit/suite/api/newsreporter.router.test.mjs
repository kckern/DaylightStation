import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createNewsReporterRouter } from '#api/v1/routers/newsreporter.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

describe('POST /api/v1/newsreporter/:id/run', () => {
  let app;
  let mockService;

  beforeEach(() => {
    mockService = {
      run: jest.fn().mockResolvedValue({
        status: 'ok',
        sourceCounts: { matches: 3 },
        sinkResults: [{ status: 'ok' }],
      }),
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/newsreporter', createNewsReporterRouter({
      newsReporterService: mockService,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
  });

  it('returns 200 with the service result', async () => {
    const res = await request(app)
      .post('/api/v1/newsreporter/world-cup-reporter/run')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.sourceCounts).toEqual({ matches: 3 });
    expect(res.body.sinkResults).toEqual([{ status: 'ok' }]);
  });

  it('passes overrides through to the service', async () => {
    await request(app)
      .post('/api/v1/newsreporter/world-cup-reporter/run')
      .send({ date: '2026-06-20', printer: 'downstairs', dryRun: true, force: true });

    expect(mockService.run).toHaveBeenCalledWith('world-cup-reporter', {
      date: '2026-06-20',
      printer: 'downstairs',
      dryRun: true,
      force: true,
    });
  });

  it('omits absent override keys (empty body → {} overrides)', async () => {
    await request(app)
      .post('/api/v1/newsreporter/world-cup-reporter/run')
      .send({});
    expect(mockService.run).toHaveBeenCalledWith('world-cup-reporter', {});
  });

  it('returns sections/preview on a dry run', async () => {
    mockService.run.mockResolvedValueOnce({
      status: 'ok',
      sourceCounts: { matches: 1 },
      sinkResults: [{ status: 'ok', detail: { preview: 'WORLD CUP\nBRA 2-1 ARG' } }],
      sections: [{ type: 'heading', text: 'WC' }],
      preview: 'WORLD CUP\nBRA 2-1 ARG',
    });

    const res = await request(app)
      .post('/api/v1/newsreporter/world-cup-reporter/run')
      .send({ dryRun: true, force: true });

    expect(res.status).toBe(200);
    expect(res.body.preview).toContain('BRA 2-1 ARG');
    expect(res.body.sections).toEqual([{ type: 'heading', text: 'WC' }]);
  });

  it('returns 404 when the reporter is unknown/disabled', async () => {
    mockService.run.mockRejectedValueOnce(new EntityNotFoundError('newsreporter', 'nope'));

    const res = await request(app)
      .post('/api/v1/newsreporter/nope/run')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
  });
});
