import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

const RETRY_DELAY_MS = 45_000;

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice(overrides = {}) {
  return {
    id: 'tv',
    screenPath: '/screen/tv',
    defaultVolume: 10,
    notifyService: 'mobile_app_kc_phone',
    hasCapability: vi.fn().mockReturnValue(false),
    // Simulates the real failure: script ran but sensor never confirmed
    powerOn: vi.fn().mockResolvedValue({ ok: false, verifyFailed: true, elapsedMs: 25000 }),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeSvc({ device, readinessPolicy, haGateway } = {}) {
  return new WakeAndLoadService({
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy,
    broadcast: vi.fn(),
    haGateway,
    logger: makeLogger(),
  });
}

describe('WakeAndLoadService deferred retry on verify failure', () => {
  let device;
  let readinessPolicy;
  let haGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    device = makeDevice();
    readinessPolicy = {
      isReady: vi.fn().mockResolvedValue({ ready: false, reason: 'display_off' }),
    };
    haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ok:false immediately without waiting for retry', async () => {
    const svc = makeSvc({ device, readinessPolicy, haGateway });
    const result = await svc.execute('tv', { queue: 'plex:1' });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('verify');
  });

  it('attempts content load after 45s when verify initially fails but retry succeeds', async () => {
    const svc = makeSvc({ device, readinessPolicy, haGateway });

    await svc.execute('tv', { queue: 'plex:1' });
    expect(device.loadContent).not.toHaveBeenCalled();

    // Retry succeeds: power on verifies, content loads
    device.powerOn.mockResolvedValue({ ok: true, verified: true, elapsedMs: 50 });

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(device.loadContent).toHaveBeenCalled();
  });

  it('sends HA notification when retry also fails', async () => {
    const svc = makeSvc({ device, readinessPolicy, haGateway });

    await svc.execute('tv', { queue: 'plex:1' });

    // Retry still fails (power still off)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(haGateway.callService).toHaveBeenCalledWith(
      'notify',
      'mobile_app_kc_phone',
      expect.objectContaining({ title: expect.any(String) })
    );
  });

  it('does not cascade retries — retry failure schedules no further retry', async () => {
    const svc = makeSvc({ device, readinessPolicy, haGateway });

    await svc.execute('tv', { queue: 'plex:1' });

    // Advance past first retry
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    // Advance again — no third attempt should fire
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    // isReady called exactly twice: original + one retry
    expect(readinessPolicy.isReady).toHaveBeenCalledTimes(2);
  });
});
