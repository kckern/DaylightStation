import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

function appWith(excursionGuard) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ excursionGuard }));
  return app;
}

describe('POST /api/v1/device/:deviceId/excursion', () => {
  it('starts the guard and answers 202 when the package has a policy', async () => {
    const excursionGuard = { start: vi.fn(() => ({ guarded: true })) };
    const response = await request(appWith(excursionGuard))
      .post('/api/v1/device/livingroom-tv/excursion')
      .send({ package: 'com.android.tv.settings', activity: '.accessories.AddAccessoryActivity' });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true, guarded: true });
    expect(excursionGuard.start).toHaveBeenCalledWith({
      deviceId: 'livingroom-tv', package: 'com.android.tv.settings', activity: '.accessories.AddAccessoryActivity',
    });
  });

  it('answers 200 with the reason when nothing is guarded', async () => {
    const excursionGuard = { start: vi.fn(() => ({ guarded: false, reason: 'no-policy' })) };
    const response = await request(appWith(excursionGuard))
      .post('/api/v1/device/livingroom-tv/excursion')
      .send({ package: 'us.zoom.videomeetings' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, guarded: false, reason: 'no-policy' });
  });

  it('rejects a request without a package', async () => {
    const excursionGuard = { start: vi.fn() };
    const response = await request(appWith(excursionGuard)).post('/api/v1/device/livingroom-tv/excursion').send({});
    expect(response.status).toBe(400);
    expect(excursionGuard.start).not.toHaveBeenCalled();
  });
});
