import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// A self-powered surface: content_control but NO device_control (portal, yellow-room-tablet).
function makeSelfPoweredDevice(overrides = {}) {
  return {
    id: 'portal',
    screenPath: '/screen/portal',
    defaultVolume: null,
    notifyService: null,
    hasCapability: vi.fn((cap) => cap === 'contentControl'),
    powerOn: vi.fn().mockResolvedValue({ ok: false, error: 'No device control configured' }),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeSvc(device, readinessPolicy) {
  return new WakeAndLoadService({
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy,
    broadcast: vi.fn(),
    haGateway: undefined,
    logger: makeLogger(),
  });
}

describe('WakeAndLoadService self-powered devices (no device_control)', () => {
  it('skips the power step instead of failing the dispatch', async () => {
    const device = makeSelfPoweredDevice();
    const svc = makeSvc(device, { isReady: vi.fn() });

    const result = await svc.execute('portal', { plex: '620669' });

    expect(device.powerOn).not.toHaveBeenCalled();
    expect(result.steps.power).toEqual({ ok: true, skipped: 'no_device_control' });
    expect(result.failedStep).toBeUndefined();
  });

  it('skips display verification and never consults the readiness policy', async () => {
    const device = makeSelfPoweredDevice();
    const readinessPolicy = { isReady: vi.fn() };
    const svc = makeSvc(device, readinessPolicy);

    const result = await svc.execute('portal', { plex: '620669' });

    expect(readinessPolicy.isReady).not.toHaveBeenCalled();
    expect(result.steps.verify).toEqual({ ready: true, skipped: 'no_sensor' });
  });

  it('reaches loadContent and reports overall success', async () => {
    const device = makeSelfPoweredDevice();
    const svc = makeSvc(device, { isReady: vi.fn() });

    const result = await svc.execute('portal', { plex: '620669' });

    expect(device.loadContent).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('still powers on a device that HAS device_control', async () => {
    const device = makeSelfPoweredDevice({
      id: 'livingroom-tv',
      hasCapability: vi.fn((cap) => cap === 'deviceControl' || cap === 'contentControl'),
      powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 1200 }),
    });
    const svc = makeSvc(device, { isReady: vi.fn() });

    await svc.execute('livingroom-tv', { plex: '620669' });

    expect(device.powerOn).toHaveBeenCalledTimes(1);
  });
});
