/**
 * POST /api/v1/device/:id/session/transport — router-level tests.
 *
 * Mocks sessionControlService.sendCommand directly; the service has its
 * own tests. These verify request validation + result→HTTP mapping.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { TRANSPORT_ACTIONS } from '#shared-contracts/media/commands.mjs';

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

describe('POST /device/:deviceId/session/transport', () => {
  let deviceService, sessionControlService, logger, router, handler;

  beforeEach(() => {
    deviceService = makeDeviceService();
    sessionControlService = {
      getSnapshot: vi.fn(() => null),
      sendCommand: vi.fn(async () => ({
        ok: true, commandId: 'c1', appliedAt: '2026-04-17T00:00:00.000Z',
      })),
      waitForStateChange: vi.fn(),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    router = createDeviceRouter({ deviceService, sessionControlService, logger });
    handler = findHandler(router, '/:deviceId/session/transport', 'post');
  });

  function buildReq(body, deviceId = 'tv-1') {
    return { params: { deviceId }, body };
  }

  // ---------------------------------------------------------------------------
  // Happy paths — one per transport action
  // ---------------------------------------------------------------------------

  it.each(['play', 'pause', 'stop', 'skipNext', 'skipPrev'])(
    'returns 200 for %s action',
    async (action) => {
      const req = buildReq({ action, commandId: 'cmd-' + action });
      const res = makeRes();
      await handler(req, res, vi.fn());

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, commandId: 'c1' });
      expect(sessionControlService.sendCommand).toHaveBeenCalledTimes(1);
      const envelope = sessionControlService.sendCommand.mock.calls[0][0];
      expect(envelope).toMatchObject({
        type: 'command',
        command: 'transport',
        targetDevice: 'tv-1',
        commandId: 'cmd-' + action,
        params: { action },
      });
    }
  );

  it('returns 200 for seekAbs with value', async () => {
    const req = buildReq({ action: 'seekAbs', value: 42, commandId: 'c-seek-abs' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ action: 'seekAbs', value: 42 });
  });

  it('returns 200 for seekRel with negative value', async () => {
    const req = buildReq({ action: 'seekRel', value: -10, commandId: 'c-seek-rel' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ action: 'seekRel', value: -10 });
  });

  // ---------------------------------------------------------------------------
  // Validation errors (service must NOT be called)
  // ---------------------------------------------------------------------------

  it('returns 400 when commandId is missing', async () => {
    const req = buildReq({ action: 'play' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/commandId/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when action is invalid', async () => {
    const req = buildReq({ action: 'teleport', commandId: 'c1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/action/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when seekAbs is missing a numeric value', async () => {
    const req = buildReq({ action: 'seekAbs', commandId: 'c1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/value/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when seekRel value is non-numeric', async () => {
    const req = buildReq({ action: 'seekRel', value: 'forward', commandId: 'c1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/value/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Service result mapping
  // ---------------------------------------------------------------------------

  it('returns 409 with lastKnown when device is offline', async () => {
    const lastKnown = { sessionId: 's', state: 'paused' };
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      error: 'Device offline',
      lastKnown,
    });

    const req = buildReq({ action: 'play', commandId: 'c1' });
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      lastKnown,
    });
  });

  it('returns 502 when device refuses / ack times out', async () => {
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false,
      code: ERROR_CODES.DEVICE_REFUSED,
      error: 'Timeout waiting for ack',
    });

    const req = buildReq({ action: 'play', commandId: 'c1' });
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
    const h = findHandler(r, '/:deviceId/session/transport', 'post');
    const req = buildReq({ action: 'play', commandId: 'c1' });
    const res = makeRes();
    await h(req, res, vi.fn());

    expect(res.statusCode).toBe(501);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('covers all TRANSPORT_ACTIONS values', () => {
    // Guard: if someone adds a new transport action we should add a test for it.
    expect([...TRANSPORT_ACTIONS].sort()).toEqual(
      ['pause', 'play', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev', 'stop']
    );
  });
});
