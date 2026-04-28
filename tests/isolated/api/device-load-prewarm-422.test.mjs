// tests/isolated/api/device-load-prewarm-422.test.mjs
import { describe, test, expect, vi } from 'vitest';
import { createDeviceRouter } from '../../../backend/src/4_api/v1/routers/device.mjs';
import express from 'express';
import request from 'supertest';

function makeApp(wakeResult) {
  const app = express();
  const router = createDeviceRouter({
    wakeAndLoadService: {
      execute: vi.fn().mockResolvedValue(wakeResult),
    },
    deviceService: { get: () => ({ id: 'tv' }), listDevices: () => [] },
    // Pin the input-precondition contract: stub configService so the handler's
    // checkInputPrecondition gets `null` from getDeviceConfig and short-circuits
    // to ok:true. Avoids relying on a `?.` early-return in production code.
    configService: { getDeviceConfig: () => null },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
