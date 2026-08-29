// tests/isolated/api/device-load-prewarm-422.test.mjs
import { describe, test, expect, vi } from 'vitest';
import { createDeviceRouter } from '../../../backend/src/4_api/v1/routers/device.mjs';
import express from 'express';
import request from 'supertest';
import { DeviceContentDispatchService } from '#apps/devices/services/DeviceContentDispatchService.mjs';

function makeApp(wakeResult) {
  const app = express();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const router = createDeviceRouter({
    dispatchService: new DeviceContentDispatchService({
      wakeAndLoad: { execute: vi.fn().mockResolvedValue(wakeResult) },
      idempotency: { runWithIdempotency: vi.fn() },
      // Pin the input-precondition contract: no device config short-circuits
      // to ok:true without relying on concrete config file layout.
      configuration: { device: () => null },
      logger,
    }),
  });
  app.use('/api/v1/device', router);
  return app;
}

describe('GET /api/v1/device/:id/load — failure mapping', () => {
  test('returns 422 with code=CONTENT_NOT_FOUND on permanent prewarm failure', async () => {
    const app = makeApp({
      ok: false,
      deviceId: 'tv',
      failedStep: 'prewarm',
      permanent: true,
      error: 'Content unresolvable: non-playable-type',
      steps: { prewarm: { ok: false, reason: 'non-playable-type', permanent: true } },
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:487146');
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
    expect(res.body.error).toMatch(/non-playable-type/);
    // Sanity: the structured failedStep + permanent should pass through
    expect(res.body.failedStep).toBe('prewarm');
    expect(res.body.permanent).toBe(true);
  });

  test('returns 200 for transient prewarm failures (existing fall-through)', async () => {
    const app = makeApp({
      ok: true,
      deviceId: 'tv',
      steps: { prewarm: { ok: false, reason: 'transient', permanent: false } },
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 200 on a fully successful load (sanity)', async () => {
    const app = makeApp({
      ok: true,
      deviceId: 'tv',
      steps: { prewarm: { ok: true, contentId: 'plex:1' }, load: { ok: true } },
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 404 when device not found (existing behavior preserved)', async () => {
    const app = makeApp({
      ok: false,
      error: 'Device not found',
      deviceId: 'tv',
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:1');
    expect(res.status).toBe(404);
  });
});
