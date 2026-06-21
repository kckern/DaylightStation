/**
 * POST /api/v1/device/audio-bridge/heal — router-level tests.
 *
 * Tests the handler in isolation via req/res mocks (same pattern as
 * device.session.test.mjs). No real HTTP — just verify routing + the
 * heal orchestration over deviceService.
 *
 * The handler does NOT pre-filter via getCapabilities() (which returns
 * contentControl as a boolean summary). It calls device.healAudioBridge()
 * directly and treats a `{ supported: false }` return as "not eligible".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function status(code) { this.statusCode = code; return this; }),
    json: vi.fn(function json(body) { this.body = body; return this; }),
    end: vi.fn(function end() { return this; }),
  };
  return res;
}

function findHealHandler(router) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/audio-bridge/heal'
  );
  if (!layer) throw new Error('audio-bridge/heal route not mounted');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/**
 * Build a fake device exposing a healAudioBridge spy. The handler relies on
 * the return value (not getCapabilities) to decide eligibility.
 * @param {Object} [healResult] - what healAudioBridge resolves to.
 */
function makeDevice(id, { healResult } = {}) {
  return {
    healAudioBridge: vi.fn(async () =>
      healResult ?? { ok: true, companions: [{ pkg: 'net.kckern.audiobridge', action: 'relaunched', ok: true }] }
    ),
    _id: id,
  };
}

describe('POST /device/audio-bridge/heal', () => {
  let logger;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  function buildRouter(deviceService) {
    const router = createDeviceRouter({ deviceService, logger });
    return findHealHandler(router);
  }

  it('(a) heals an eligible device and returns 200', async () => {
    const shield = makeDevice('shield', { healResult: { ok: true, companions: [{ pkg: 'net.kckern.audiobridge' }] } });
    const deviceService = {
      get: vi.fn((id) => ({ shield }[id] || null)),
      listDeviceIds: vi.fn(() => ['shield']),
      listDevices: vi.fn(() => []),
    };
    const handler = buildRouter(deviceService);

    const req = { body: {} };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.healed).toEqual([
      expect.objectContaining({
        deviceId: 'shield',
        ok: true,
        companions: [{ pkg: 'net.kckern.audiobridge' }],
      }),
    ]);
    expect(shield.healAudioBridge).toHaveBeenCalledWith({ force: false });
  });

  it('(b) passes force:true through to the device', async () => {
    const shield = makeDevice('shield');
    const deviceService = {
      get: vi.fn(() => shield),
      listDeviceIds: vi.fn(() => ['shield']),
      listDevices: vi.fn(() => []),
    };
    const handler = buildRouter(deviceService);

    const req = { body: { force: true } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(shield.healAudioBridge).toHaveBeenCalledWith({ force: true });
    expect(res.statusCode).toBe(200);
  });

  it('(c) skips unsupported devices and only heals supported ones', async () => {
    const shield = makeDevice('shield', { healResult: { ok: true } });
    const pc = makeDevice('pc', { healResult: { ok: false, supported: false } });
    const deviceService = {
      get: vi.fn((id) => ({ shield, pc }[id] || null)),
      listDeviceIds: vi.fn(() => ['shield', 'pc']),
      listDevices: vi.fn(() => []),
    };
    const handler = buildRouter(deviceService);

    const req = { body: {} };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    // Both were called, but only the supported one appears in `healed`.
    expect(shield.healAudioBridge).toHaveBeenCalledWith({ force: false });
    expect(pc.healAudioBridge).toHaveBeenCalledWith({ force: false });
    expect(res.body.healed).toEqual([
      expect.objectContaining({ deviceId: 'shield', ok: true }),
    ]);
  });

  it('(d) targets only the given deviceId when provided', async () => {
    const shield = makeDevice('shield');
    const tv2 = makeDevice('tv2');
    const deviceService = {
      get: vi.fn((id) => ({ shield, tv2 }[id] || null)),
      listDeviceIds: vi.fn(() => ['shield', 'tv2']),
      listDevices: vi.fn(() => []),
    };
    const handler = buildRouter(deviceService);

    const req = { body: { deviceId: 'tv2' } };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(tv2.healAudioBridge).toHaveBeenCalledWith({ force: false });
    expect(shield.healAudioBridge).not.toHaveBeenCalled();
    expect(res.body.healed).toEqual([
      expect.objectContaining({ deviceId: 'tv2', ok: true }),
    ]);
  });

  it('(e) returns no-eligible-devices when every device is unsupported', async () => {
    const pc = makeDevice('pc', { healResult: { ok: false, supported: false } });
    const deviceService = {
      get: vi.fn(() => pc),
      listDeviceIds: vi.fn(() => ['pc']),
      listDevices: vi.fn(() => []),
    };
    const handler = buildRouter(deviceService);

    const req = { body: {} };
    const res = makeRes();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, healed: [], reason: 'no-eligible-devices' });
    expect(pc.healAudioBridge).toHaveBeenCalledWith({ force: false });
  });
});
