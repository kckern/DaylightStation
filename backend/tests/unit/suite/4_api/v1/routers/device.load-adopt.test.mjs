/**
 * POST /api/v1/device/:id/load (mode: 'adopt') — router-level tests.
 *
 * Covers the Hand Off adoption endpoint (spec §4.7). The wake + adopt
 * orchestration itself lives in WakeAndLoadService; these tests verify
 * validation, idempotency, and status mapping at the HTTP boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';

function makeDeviceService() {
  return {
    get: vi.fn(() => null),
    listDevices: vi.fn(() => []),
  };
}

function findHandler(router, path, method = 'post') {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} route not mounted`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    ended: false,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
    end: vi.fn(function end() { this.ended = true; return this; }),
  };
  return res;
}

function makeSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: { contentId: 'plex/123', format: 'video', title: 'Test' },
    position: 42,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

describe('POST /device/:deviceId/load (mode: adopt)', () => {
  let deviceService, wakeAndLoadService, logger, router, handler;

  beforeEach(() => {
    deviceService = makeDeviceService();
    wakeAndLoadService = {
      execute: vi.fn(async () => ({
        ok: true,
        deviceId: 'tv-1',
        dispatchId: 'd-1',
        steps: {
          power: { ok: true, verified: true },
          prepare: { ok: true },
          prewarm: { skipped: true, reason: 'adopt-mode' },
          load: { ok: true, method: 'adopt-snapshot', commandId: 'd-1' },
        },
        totalElapsedMs: 123,
      })),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    router = createDeviceRouter({ deviceService, wakeAndLoadService, logger });
    handler = findHandler(router, '/:deviceId/load', 'post');
  });

  function buildReq(body, deviceId = 'tv-1') {
    return { params: { deviceId }, body };
  }

  it('returns 200 with adopted:true + dispatchId on happy path', async () => {
    const snapshot = makeSnapshot();
    const req = buildReq({ mode: 'adopt', snapshot, dispatchId: 'd-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      adopted: true,
      dispatchId: 'd-1',
    });
    expect(res.body.steps).toBeTruthy();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);
    const [deviceId, query, options] = wakeAndLoadService.execute.mock.calls[0];
    expect(deviceId).toBe('tv-1');
    expect(query).toEqual({});
    expect(options.dispatchId).toBe('d-1');
    expect(options.adoptSnapshot).toBe(snapshot);
  });

  it('returns 400 when mode is not "adopt"', async () => {
    const req = buildReq({ mode: 'something-else', snapshot: makeSnapshot(), dispatchId: 'd-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('returns 400 when dispatchId is missing', async () => {
    const req = buildReq({ mode: 'adopt', snapshot: makeSnapshot() });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/dispatchId/i);
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('returns 400 when snapshot is invalid', async () => {
    const req = buildReq({ mode: 'adopt', snapshot: { sessionId: 'x' /* incomplete */ }, dispatchId: 'd-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid snapshot/);
    expect(res.body.details).toBeDefined();
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('returns 502 when adopt orchestration fails', async () => {
    wakeAndLoadService.execute.mockResolvedValueOnce({
      ok: false,
      dispatchId: 'd-fail',
      deviceId: 'tv-1',
      failedStep: 'load',
      error: 'adopt-snapshot failed',
      steps: { load: { ok: false, code: 'DEVICE_REFUSED' } },
    });

    const req = buildReq({ mode: 'adopt', snapshot: makeSnapshot(), dispatchId: 'd-fail' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      ok: false,
      adopted: false,
      dispatchId: 'd-fail',
    });
  });

  it('is idempotent: second call with same dispatchId + body replays without re-running', async () => {
    const snapshot = makeSnapshot();
    const body = { mode: 'adopt', snapshot, dispatchId: 'd-idem' };

    const res1 = makeRes();
    await handler(buildReq(body), res1, vi.fn());
    expect(res1.statusCode).toBe(200);
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    const res2 = makeRes();
    await handler(buildReq(body), res2, vi.fn());
    expect(res2.statusCode).toBe(200);
    // wakeAndLoadService.execute was NOT called a second time — served from cache.
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);
    expect(res2.body).toEqual(res1.body);
  });

  it('returns 409 IDEMPOTENCY_CONFLICT when same dispatchId used with different body', async () => {
    const body1 = { mode: 'adopt', snapshot: makeSnapshot({ position: 10 }), dispatchId: 'd-conflict' };
    const body2 = { mode: 'adopt', snapshot: makeSnapshot({ position: 20 }), dispatchId: 'd-conflict' };

    const res1 = makeRes();
    await handler(buildReq(body1), res1, vi.fn());
    expect(res1.statusCode).toBe(200);

    const res2 = makeRes();
    await handler(buildReq(body2), res2, vi.fn());
    expect(res2.statusCode).toBe(409);
    expect(res2.body).toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    // Conflict detected before re-running the orchestration.
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when wakeAndLoadService is not configured', async () => {
    const r = createDeviceRouter({ deviceService, wakeAndLoadService: undefined, logger });
    const h = findHandler(r, '/:deviceId/load', 'post');
    const req = buildReq({ mode: 'adopt', snapshot: makeSnapshot(), dispatchId: 'd-1' });
    const res = makeRes();
    await h(req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/WakeAndLoadService/);
  });
});
