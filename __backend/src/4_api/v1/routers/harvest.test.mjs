import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHarvestRouter } from './harvest.mjs';

function build({
  has = true,
  harvest = async () => ({ count: 2 }),
  describeFailure = r => (r?.status === 'error' ? 'auth_failed: invalid refresh_token' : null),
  healthReport,
} = {}) {
  const harvesterService = {
    has: vi.fn(() => has),
    listHarvesters: vi.fn(() => [{ serviceId: 'sample' }]),
    getAllStatuses: vi.fn(() => [{ serviceId: 'sample', running: false }]),
    getStatus: vi.fn(() => ({ serviceId: 'sample', running: false })),
    harvest: vi.fn(harvest),
    describeFailure: vi.fn(describeFailure),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/harvest', createHarvestRouter({
    harvesterService,
    principalResolver: { resolve: () => 'default' },
    requestIds: { next: () => 'abcdef123456' },
    deadline: { run: promise => promise },
    timeoutPolicy: () => 120000,
    logger,
    ...(healthReport ? { healthReport } : {}),
  }));
  return { app, harvesterService, logger };
}

describe('harvester HTTP characterization', () => {
  it('preserves the successful response envelope', async () => {
    const { app } = build();
    const response = await request(app).get('/harvest/sample?user=u');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true, harvester: 'sample', data: { count: 2 }, requestId: 'abcdef123456',
    });
  });

  it('preserves the unknown-harvester response envelope', async () => {
    const { app } = build({ has: false });
    const response = await request(app).get('/harvest/missing?user=u');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      ok: false, error: 'Unknown harvester: missing', available: ['sample'], requestId: 'abcdef123456',
    });
  });

  it('answers 502 with the reason when the harvest reports an error', async () => {
    const result = { count: 0, status: 'error', reason: 'auth_failed', error: 'invalid refresh_token' };
    const { app, logger } = build({ harvest: async () => result });
    const response = await request(app).get('/harvest/withings?user=u');
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      ok: false, harvester: 'withings', message: 'auth_failed: invalid refresh_token',
      data: result, requestId: 'abcdef123456',
    });
    expect(logger.warn).toHaveBeenCalledWith('harvest.failed', expect.objectContaining({
      serviceId: 'withings', message: 'auth_failed: invalid refresh_token',
    }));
  });

  it('redacts credentials from a failed harvest before answering or logging', async () => {
    const result = { count: 0, status: 'error', reason: 'auth_failed', error: 'rejected Bearer abc123' };
    const { app, logger } = build({
      harvest: async () => result,
      describeFailure: r => `${r.reason}: ${r.error}`,
    });
    const response = await request(app).get('/harvest/withings?user=u');
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('abc123');
    expect(response.body.message).toBe('auth_failed: rejected Bearer [REDACTED]');
    expect(response.body.data).toEqual({ ...result, error: 'rejected Bearer [REDACTED]' });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('abc123');
    expect(result.error).toBe('rejected Bearer abc123');
  });

  it('keeps timeout and provider-rate-limit HTTP translations at the API boundary', async () => {
    const timeout = build({ harvest: async () => { throw new Error('Timeout: sample exceeded 120000ms limit'); } });
    expect((await request(timeout.app).get('/harvest/sample')).status).toBe(504);

    const limited = build({ harvest: async () => { const error = new Error('limited'); error.response = { status: 429 }; throw error; } });
    expect((await request(limited.app).get('/harvest/sample')).status).toBe(429);
  });

  it('GET / includes harvester health when a report is wired', async () => {
    const { app } = build({ healthReport: async () => ({ withings: { status: 'failing', failures: 3 } }) });
    const response = await request(app).get('/harvest');
    expect(response.status).toBe(200);
    expect(response.body.health).toEqual({ withings: { status: 'failing', failures: 3 } });
    expect(response.body.harvesters).toEqual([{ serviceId: 'sample', status: { serviceId: 'sample', running: false } }]);
  });

  it('GET / redacts tokens in a health lastError', async () => {
    const { app } = build({ healthReport: async () => ({ withings: { status: 'failing', lastError: 'Bearer abc123 rejected' } }) });
    const response = await request(app).get('/harvest');
    expect(response.body.health.withings.lastError).toBe('Bearer [REDACTED] rejected');
  });

  it('GET / reports health null when no report is wired', async () => {
    const { app } = build();
    const response = await request(app).get('/harvest');
    expect(response.status).toBe(200);
    expect(response.body.health).toBe(null);
  });
});
