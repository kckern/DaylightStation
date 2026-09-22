import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

function appWith(kioskFrictionTracker) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ kioskFrictionTracker }));
  return app;
}

describe('POST /api/v1/device/:deviceId/friction-ping', () => {
  it('records the friction ping and returns 200 { ok: true }', async () => {
    const kioskFrictionTracker = { recordFriction: vi.fn().mockResolvedValue(undefined) };

    const response = await request(appWith(kioskFrictionTracker))
      .post('/api/v1/device/portal/friction-ping')
      .send({ kind: 'stray-press' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(kioskFrictionTracker.recordFriction).toHaveBeenCalledTimes(1);
    expect(kioskFrictionTracker.recordFriction).toHaveBeenCalledWith({ deviceId: 'portal', kind: 'stray-press' });
  });

  it('rejects a missing kind before invoking the tracker', async () => {
    const kioskFrictionTracker = { recordFriction: vi.fn() };

    const response = await request(appWith(kioskFrictionTracker))
      .post('/api/v1/device/portal/friction-ping')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(kioskFrictionTracker.recordFriction).not.toHaveBeenCalled();
  });

  it('rejects a non-string kind before invoking the tracker', async () => {
    const kioskFrictionTracker = { recordFriction: vi.fn() };

    const response = await request(appWith(kioskFrictionTracker))
      .post('/api/v1/device/portal/friction-ping')
      .send({ kind: 42 });

    expect(response.status).toBe(400);
    expect(kioskFrictionTracker.recordFriction).not.toHaveBeenCalled();
  });
});
