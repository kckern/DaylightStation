/**
 * POST /api/v1/device/:id/session/claim — router-level tests.
 *
 * Mocks sessionControlService.claim directly. The claim algorithm itself
 * is covered by SessionControlService.test.mjs; these tests verify the
 * HTTP wrapper: request validation + result→HTTP status mapping.
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

function makeSnapshot() {
  return {
    sessionId: 'sess-1',
    state: 'playing',
    currentItem: null,
    position: 0,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
  };
}

describe('POST /device/:deviceId/session/claim', () => {
  let deviceService, sessionControlService, logger, router, handler;

  beforeEach(() => {
    deviceService = makeDeviceService();
    sessionControlService = {
      getSnapshot: vi.fn(() => null),
      sendCommand: vi.fn(),
      waitForStateChange: vi.fn(),
      claim: vi.fn(async () => ({
        ok: true,
        commandId: 'c-claim-1',
        snapshot: makeSnapshot(),
        stoppedAt: '2026-04-17T00:00:00.000Z',
      })),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    router = createDeviceRouter({ deviceService, sessionControlService, logger });
    handler = findHandler(router, '/:deviceId/session/claim', 'post');
  });

  function buildReq(body, deviceId = 'tv-1') {
    return { params: { deviceId }, body };
  }

  it('returns 200 with snapshot + stoppedAt on claim success', async () => {
    const req = buildReq({ commandId: 'c-claim-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      commandId: 'c-claim-1',
      stoppedAt: '2026-04-17T00:00:00.000Z',
    });
    expect(res.body.snapshot).toBeTruthy();
    expect(res.body.snapshot.sessionId).toBe('sess-1');
    expect(sessionControlService.claim).toHaveBeenCalledWith('tv-1', { commandId: 'c-claim-1' });
  });

  it('returns 400 when commandId is missing', async () => {
    const req = buildReq({});
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/commandId/i);
    expect(sessionControlService.claim).not.toHaveBeenCalled();
  });

  it('returns 400 when commandId is empty string', async () => {
    const req = buildReq({ commandId: '' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(sessionControlService.claim).not.toHaveBeenCalled();
  });

  it('returns 409 with lastKnown when device is offline', async () => {
    const lastKnown = makeSnapshot();
    sessionControlService.claim.mockResolvedValue({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      error: 'Device offline or unknown',
      lastKnown,
    });

    const req = buildReq({ commandId: 'c-claim-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      lastKnown,
    });
  });

  it('returns 502 when the stop ack is refused', async () => {
    sessionControlService.claim.mockResolvedValue({
      ok: false,
      code: ERROR_CODES.DEVICE_REFUSED,
      error: 'Timeout waiting for ack',
    });

    const req = buildReq({ commandId: 'c-claim-1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_REFUSED,
    });
  });

  it('returns 501 when sessionControlService is not injected', async () => {
    const r = createDeviceRouter({ deviceService, sessionControlService: undefined, logger });
    const h = findHandler(r, '/:deviceId/session/claim', 'post');
    const req = buildReq({ commandId: 'c-claim-1' });
    const res = makeRes();
    await h(req, res, vi.fn());

    expect(res.statusCode).toBe(501);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/not configured/i);
  });
});
