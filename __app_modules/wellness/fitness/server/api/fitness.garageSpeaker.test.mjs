// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';
import { GarageSpeakerHealthService } from '../application/services/GarageSpeakerHealthService.mjs';

const appWith = (garageSpeakerHealth) => {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ garageSpeakerHealth, defaultHouseholdId: 'default', logger: { info() {}, warn() {}, error() {} } }));
  return app;
};

describe('fitness garage speaker events endpoint', () => {
  it('accepts a Home Assistant recovery report and logs it under the live session', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new GarageSpeakerHealthService({ logger, liveSessionAuthority: { current: () => 'fs_1' } });
    const res = await request(appWith(service)).post('/garage-speaker/events').send({ event: 'dropout', powerW: 0, durationS: 25 });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, event: 'fitness.garage_speaker.dropout', sessionId: 'fs_1' });
    expect(logger.warn).toHaveBeenCalledWith('fitness.garage_speaker.dropout', expect.objectContaining({ powerW: 0, durationS: 25, sessionId: 'fs_1' }));
  });

  it('rejects an unknown event with 400', async () => {
    const service = new GarageSpeakerHealthService({ logger: { warn: vi.fn() } });
    const res = await request(appWith(service)).post('/garage-speaker/events').send({ event: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'unknown_event' });
  });

  it('reports 503 when the service is not wired', async () => {
    const res = await request(appWith(null)).post('/garage-speaker/events').send({ event: 'dropout' });
    expect(res.status).toBe(503);
  });
});
