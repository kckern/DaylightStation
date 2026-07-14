/**
 * GET /api/v1/device/:id/load — dispatchId correlation regression.
 *
 * The frontend passes its dispatchId as a query param; the router must lift
 * it into execute()'s OPTIONS arg (not leave it in the content query), or
 * WakeAndLoadService mints its own id and every homeline wake-progress
 * broadcast carries a foreign correlator the sender's UI drops on the floor
 * (2026-07-14 Bluey cast: progress tray stayed empty for the 18s wake).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';

function findHandler(router, path, method = 'get') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not mounted`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
  };
}

describe('GET /device/:deviceId/load — dispatchId correlation', () => {
  let wakeAndLoadService, router, handler;

  beforeEach(() => {
    wakeAndLoadService = {
      execute: vi.fn().mockResolvedValue({ ok: true, deviceId: 'tv', totalElapsedMs: 5 }),
    };
    router = createDeviceRouter({
      deviceService: { get: vi.fn(() => null), listDevices: vi.fn(() => []) },
      wakeAndLoadService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    handler = findHandler(router, '/:deviceId/load', 'get');
  });

  it('lifts dispatchId from the query into execute options', async () => {
    const req = {
      params: { deviceId: 'livingroom-tv' },
      query: { play: 'plex:59493', dispatchId: 'dispatch-abc-123' },
    };
    const res = makeRes();

    await handler(req, res, vi.fn());

    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);
    const [deviceId, contentQuery, options] = wakeAndLoadService.execute.mock.calls[0];
    expect(deviceId).toBe('livingroom-tv');
    // The correlator rides in options, NOT the content query.
    expect(options).toMatchObject({ dispatchId: 'dispatch-abc-123' });
    expect(contentQuery).toEqual({ play: 'plex:59493' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('tolerates a missing dispatchId (service mints its own)', async () => {
    const req = { params: { deviceId: 'tv' }, query: { play: 'plex:1' } };
    const res = makeRes();

    await handler(req, res, vi.fn());

    const [, contentQuery, options] = wakeAndLoadService.execute.mock.calls[0];
    expect(contentQuery).toEqual({ play: 'plex:1' });
    expect(options.dispatchId).toBeUndefined();
  });
});
