import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceRouter } from './device.mjs';

// Anything that could power, wake, load or command a screen. Prepare must
// touch none of it — it is the look, not PLAY.
function screenTouchingServices() {
  const trap = () => new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { fleetService: trap(), screenService: trap(), dispatchService: trap(), recoveryService: trap(), sessionService: trap() };
}

function appWith(prepareService, services = screenTouchingServices()) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/device', createDeviceRouter({ ...services, prepareService }));
  return { app, services };
}

const preparing = (result = { kind: 'prepared', status: 'ok', contentId: 'plex:2', ms: 40 }) => ({
  configured: () => true,
  prepare: vi.fn().mockResolvedValue(result),
});

describe('POST /api/v1/device/:deviceId/prepare', () => {
  it('prepares the stream and touches no screen', async () => {
    const prepareService = preparing();
    const { app, services } = appWith(prepareService);
    const response = await request(app).post('/api/v1/device/office-tv/prepare').send({ contentId: 'plex:1' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, deviceId: 'office-tv', status: 'ok', contentId: 'plex:2', ms: 40 });
    expect(prepareService.prepare).toHaveBeenCalledWith('office-tv', 'plex:1');
    for (const service of Object.values(services)) {
      for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it('a failed warm-up is still a 200: preparation is best-effort', async () => {
    const { app } = appWith(preparing({ kind: 'prepared', status: 'failed', contentId: null, ms: 3 }));
    const response = await request(app).post('/api/v1/device/office-tv/prepare').send({ contentId: 'plex:1' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: false, status: 'failed' });
  });

  it('rejects a missing contentId', async () => {
    const prepareService = preparing();
    const response = await request(appWith(prepareService).app).post('/api/v1/device/office-tv/prepare').send({});
    expect(response.status).toBe(400);
    expect(prepareService.prepare).not.toHaveBeenCalled();
  });

  it('404 for an unknown screen', async () => {
    const response = await request(appWith(preparing({ kind: 'not_found' })).app)
      .post('/api/v1/device/nowhere/prepare').send({ contentId: 'plex:1' });
    expect(response.status).toBe(404);
  });

  it('501 when preparation is not wired', async () => {
    const response = await request(appWith(undefined).app).post('/api/v1/device/office-tv/prepare').send({ contentId: 'plex:1' });
    expect(response.status).toBe(501);
  });
});
