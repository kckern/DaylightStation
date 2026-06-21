/**
 * POST /api/v1/device/audio-bridge/heal — router-level tests.
 *
 * Tests the handler in isolation via req/res mocks (same pattern as
 * device.session.test.mjs). No real HTTP — just verify routing + the
 * heal orchestration over deviceService.
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
 * Build a fake device with capabilities and a healAudioBridge spy.
 * @param {boolean} healable - whether contentControl supports heal
 */
function makeDevice(id, { healable = true, healResult } = {}) {
  return {
    getCapabilities: vi.fn(() => ({
      contentControl: healable ? { healAudioBridge: () => {} } : false,
    })),
    healAudioBridge: vi.fn(async () => healResult ?? { ok: true, companions: [{ pkg: 'net.kckern.audiobridge', action: 'relaunched', ok: true }] }),
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

  it('heals eligible devices and returns 200', async () => {
    const shield = makeDevice('shield');
    const pc = makeDevice('pc', { healable: false });
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
    expect(res.body.healed).toEqual([
      expect.objectContaining({ deviceId: 'shield', ok: true }),
    ]);
    // Only the eligible device is healed
    expect(shield.healAudioBridge).toHaveBeenCalledWith({ force: false });
    expect(pc.healAudioBridge).not.toHaveBeenCalled();
  });

  it('passes force:true through to the device', async () => {
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

  it('targets only the given deviceId when provided', async () => {
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

  it('returns no-eligible-devices when nothing is healable', async () => {
    const pc = makeDevice('pc', { healable: false });
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
    expect(pc.healAudioBridge).not.toHaveBeenCalled();
  });
});
