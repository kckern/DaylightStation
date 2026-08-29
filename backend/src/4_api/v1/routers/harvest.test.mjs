import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHarvestRouter } from './harvest.mjs';

function build({ has = true, harvest = async () => ({ count: 2 }) } = {}) {
  const harvesterService = {
    has: vi.fn(() => has),
    listHarvesters: vi.fn(() => [{ serviceId: 'sample' }]),
    getAllStatuses: vi.fn(() => [{ serviceId: 'sample', running: false }]),
    getStatus: vi.fn(() => ({ serviceId: 'sample', running: false })),
    harvest: vi.fn(harvest),
  };
  const app = express();
  app.use(express.json());
  app.use('/harvest', createHarvestRouter({
    harvesterService,
    principalResolver: { resolve: () => 'default' },
    requestIds: { next: () => 'abcdef123456' },
    deadline: { run: promise => promise },
    timeoutPolicy: () => 120000,
    logger: { info() {}, error() {} },
  }));
  return { app, harvesterService };
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

  it('keeps timeout and provider-rate-limit HTTP translations at the API boundary', async () => {
    const timeout = build({ harvest: async () => { throw new Error('Timeout: sample exceeded 120000ms limit'); } });
    expect((await request(timeout.app).get('/harvest/sample')).status).toBe(504);

    const limited = build({ harvest: async () => { const error = new Error('limited'); error.response = { status: 429 }; throw error; } });
    expect((await request(limited.app).get('/harvest/sample')).status).toBe(429);
  });
});
