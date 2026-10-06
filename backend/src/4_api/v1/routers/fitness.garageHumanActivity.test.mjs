// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const appWith = (garageHumanActivity) => {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ garageHumanActivity, logger: { info() {}, warn() {}, error() {} } }));
  return app;
};

describe('fitness garage human activity endpoint', () => {
  it('updates garage protection for a kiosk state report', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, active: true });
    const res = await request(appWith({ update })).post('/garage-human-activity').send({
      deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, active: true });
    expect(update).toHaveBeenCalledWith({ deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false });
  });

  it('rejects a malformed report before touching Home Assistant', async () => {
    const update = vi.fn();
    const res = await request(appWith({ update })).post('/garage-human-activity').send({ deviceId: 'garage-tv', emulationOpen: 'true' });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
