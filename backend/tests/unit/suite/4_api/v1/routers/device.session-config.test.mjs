/**
 * PUT /api/v1/device/:id/session/{shuffle|repeat|shader|volume}
 * — router-level tests for the four config-setter endpoints (§4.5).
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

function findHandler(router, path, method) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not mounted`);
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

describe('PUT /device/:deviceId/session/{shuffle|repeat|shader|volume}', () => {
  let deviceService, sessionControlService, logger, router;

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
  });

  async function invoke(path, body, deviceId = 'tv-1') {
    const handler = findHandler(router, path, 'put');
    const req = { params: { deviceId }, body };
    const res = makeRes();
    await handler(req, res, vi.fn());
    return res;
  }

  // ---------------------------------------------------------------------------
  // Happy paths — one per setting
  // ---------------------------------------------------------------------------

  it('shuffle: 200 when enabled is boolean', async () => {
    const res = await invoke('/:deviceId/session/shuffle', {
      enabled: true, commandId: 'c-sh',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope).toMatchObject({
      command: 'config',
      targetDevice: 'tv-1',
      commandId: 'c-sh',
      params: { setting: 'shuffle', value: true },
    });
  });

  it('shuffle: 200 when enabled is false', async () => {
    const res = await invoke('/:deviceId/session/shuffle', {
      enabled: false, commandId: 'c-sh-off',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ setting: 'shuffle', value: false });
  });

  it.each(['off', 'one', 'all'])('repeat: 200 for mode %s', async (mode) => {
    const res = await invoke('/:deviceId/session/repeat', {
      mode, commandId: 'c-rp-' + mode,
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ setting: 'repeat', value: mode });
  });

  it('shader: 200 for a non-empty string', async () => {
    const res = await invoke('/:deviceId/session/shader', {
      shader: 'warm', commandId: 'c-sh-str',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ setting: 'shader', value: 'warm' });
  });

  it('shader: 200 for null (clear)', async () => {
    const res = await invoke('/:deviceId/session/shader', {
      shader: null, commandId: 'c-sh-null',
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ setting: 'shader', value: null });
  });

  it.each([0, 50, 100])('volume: 200 for level %i', async (level) => {
    const res = await invoke('/:deviceId/session/volume', {
      level, commandId: 'c-vol-' + level,
    });
    expect(res.statusCode).toBe(200);
    const envelope = sessionControlService.sendCommand.mock.calls[0][0];
    expect(envelope.params).toMatchObject({ setting: 'volume', value: level });
  });

  // ---------------------------------------------------------------------------
  // Missing commandId — one endpoint is enough to prove the shared check
  // ---------------------------------------------------------------------------

  it('returns 400 when commandId is missing (shuffle)', async () => {
    const res = await invoke('/:deviceId/session/shuffle', { enabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/commandId/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Per-setter value validation
  // ---------------------------------------------------------------------------

  it('shuffle: 400 when enabled is not a boolean (string)', async () => {
    const res = await invoke('/:deviceId/session/shuffle', {
      enabled: 'yes', commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/enabled|boolean/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('shuffle: 400 when enabled is missing', async () => {
    const res = await invoke('/:deviceId/session/shuffle', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
  });

  it('repeat: 400 for unknown mode', async () => {
    const res = await invoke('/:deviceId/session/repeat', {
      mode: 'forever', commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/mode|off|one|all/i);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('shader: 400 when shader is undefined (not supplied)', async () => {
    const res = await invoke('/:deviceId/session/shader', { commandId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/shader/i);
  });

  it('shader: 400 when shader is a non-string, non-null value (number)', async () => {
    const res = await invoke('/:deviceId/session/shader', {
      shader: 42, commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  it('volume: 400 for a negative level', async () => {
    const res = await invoke('/:deviceId/session/volume', {
      level: -1, commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/level|0|100/i);
  });

  it('volume: 400 for a level above 100', async () => {
    const res = await invoke('/:deviceId/session/volume', {
      level: 101, commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
  });

  it('volume: 400 for a non-integer (float) level', async () => {
    const res = await invoke('/:deviceId/session/volume', {
      level: 50.5, commandId: 'c1',
    });
    expect(res.statusCode).toBe(400);
    expect(sessionControlService.sendCommand).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Service-result mapping — one endpoint per mapped outcome
  // ---------------------------------------------------------------------------

  it('returns 409 with lastKnown when device is offline (volume)', async () => {
    const lastKnown = { sessionId: 's', state: 'paused' };
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false, code: ERROR_CODES.DEVICE_OFFLINE, error: 'Device offline', lastKnown,
    });
    const res = await invoke('/:deviceId/session/volume', {
      level: 50, commandId: 'c1',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: ERROR_CODES.DEVICE_OFFLINE,
      lastKnown,
    });
  });

  it('returns 502 when device refuses (repeat)', async () => {
    sessionControlService.sendCommand.mockResolvedValue({
      ok: false, code: ERROR_CODES.DEVICE_REFUSED, error: 'Timeout',
    });
    const res = await invoke('/:deviceId/session/repeat', {
      mode: 'one', commandId: 'c1',
    });

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({
      ok: false, code: ERROR_CODES.DEVICE_REFUSED,
    });
  });

  it('returns 501 when sessionControlService is not injected (shuffle)', async () => {
    const r = createDeviceRouter({ deviceService, sessionControlService: undefined, logger });
    const handler = findHandler(r, '/:deviceId/session/shuffle', 'put');
    const req = { params: { deviceId: 'tv-1' }, body: { enabled: true, commandId: 'c1' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(501);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
