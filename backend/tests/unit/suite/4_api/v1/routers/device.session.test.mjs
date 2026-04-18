/**
 * GET /api/v1/device/:id/session — router-level tests.
 *
 * Tests the handler in isolation via req/res mocks (same pattern as
 * cost.test.mjs). No real HTTP — just verify routing + status codes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';

function makeDeviceService() {
  return {
    get: vi.fn(() => null),
    listDevices: vi.fn(() => []),
  };
}

function makeSessionSnapshot(overrides = {}) {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: {
      contentId: 'plex/123',
      format: 'video',
      title: 'Something',
    },
    position: 42,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
    ...overrides,
  };
}

function makeIdleSnapshot() {
  return {
    sessionId: 'sess-1',
    state: 'idle',
    currentItem: null,
    position: 0,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
  };
}

function findSessionHandler(router) {
  // The route path on the sub-router is '/:deviceId/session'.
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/:deviceId/session'
  );
  if (!layer) throw new Error('session route not mounted');
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

describe('GET /device/:deviceId/session', () => {
  let deviceService, sessionControlService, logger, router, handler;

  beforeEach(() => {
    deviceService = makeDeviceService();
    sessionControlService = {
      getSnapshot: vi.fn(() => null),
      sendCommand: vi.fn(),
      waitForStateChange: vi.fn(),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function buildRouter(opts = {}) {
    const svc = Object.prototype.hasOwnProperty.call(opts, 'sessionControlService')
      ? opts.sessionControlService
      : sessionControlService;
    router = createDeviceRouter({
      deviceService,
      sessionControlService: svc,
      logger,
    });
    handler = findSessionHandler(router);
  }

  it('returns 200 with the snapshot when online + non-idle', async () => {
    const snap = makeSessionSnapshot();
    sessionControlService.getSnapshot.mockReturnValue({
      snapshot: snap,
      lastSeenAt: '2026-04-17T00:00:01.000Z',
      online: true,
    });
    buildRouter();

    const req = { params: { deviceId: 'tv-1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(sessionControlService.getSnapshot).toHaveBeenCalledWith('tv-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(snap);
  });

  it('returns 204 (no content) when online + idle + empty queue', async () => {
    sessionControlService.getSnapshot.mockReturnValue({
      snapshot: makeIdleSnapshot(),
      lastSeenAt: '2026-04-17T00:00:01.000Z',
      online: true,
    });
    buildRouter();

    const req = { params: { deviceId: 'tv-1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    // 204 must not carry a body.
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 200 when online + idle BUT queue is non-empty', async () => {
    // Edge case: idle state with queued items is NOT empty → return snapshot.
    const snap = {
      ...makeIdleSnapshot(),
      queue: {
        items: [{ queueItemId: 'q1', contentId: 'plex/1' }],
        currentIndex: -1,
        upNextCount: 1,
      },
    };
    sessionControlService.getSnapshot.mockReturnValue({
      snapshot: snap,
      lastSeenAt: '2026-04-17T00:00:01.000Z',
      online: true,
    });
    buildRouter();

    const req = { params: { deviceId: 'tv-1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(snap);
  });

  it('returns 503 with offline envelope when device is offline', async () => {
    const snap = makeSessionSnapshot({ state: 'paused' });
    sessionControlService.getSnapshot.mockReturnValue({
      snapshot: snap,
      lastSeenAt: '2026-04-17T00:00:00.000Z',
      online: false,
    });
    buildRouter();

    const req = { params: { deviceId: 'tv-1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      offline: true,
      lastKnown: snap,
      lastSeenAt: '2026-04-17T00:00:00.000Z',
    });
  });

  it('returns 404 with DEVICE_NOT_FOUND when snapshot is null', async () => {
    sessionControlService.getSnapshot.mockReturnValue(null);
    buildRouter();

    const req = { params: { deviceId: 'never-seen' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_NOT_FOUND,
      error: expect.stringMatching(/not found/i),
    });
  });

  it('returns 501 when sessionControlService is not injected', async () => {
    buildRouter({ sessionControlService: undefined });

    const req = { params: { deviceId: 'tv-1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(501);
    expect(res.body).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not configured/i),
    });
  });
});
