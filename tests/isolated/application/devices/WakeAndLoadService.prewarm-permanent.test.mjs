import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice() {
  return {
    id: 'tv',
    screenPath: '/screen/tv',
    defaultVolume: null,
    hasCapability: vi.fn().mockReturnValue(false),
    powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 5 }),
    setVolume: vi.fn(),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('WakeAndLoadService — prewarm permanent failure', () => {
  let svc;
  let device;
  let prewarmService;
  let broadcast;

  beforeEach(() => {
    broadcast = vi.fn();
    device = makeDevice();
    prewarmService = {
      prewarm: vi.fn().mockResolvedValue({
        status: 'failed', reason: 'non-playable-type', permanent: true,
      }),
    };
    svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() },
      broadcast,
      prewarmService,
      logger: makeLogger(),
    });
  });

  it('returns failedStep="prewarm" with permanent=true and skips load', async () => {
    const result = await svc.execute('tv', { queue: 'plex:487146', shuffle: '1' });

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('prewarm');
    expect(result.permanent).toBe(true);
    expect(result.error).toMatch(/non-playable-type/);
    expect(device.loadContent).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit when prewarm fails transiently', async () => {
    prewarmService.prewarm.mockResolvedValue({
      status: 'failed', reason: 'transient', permanent: false,
    });

    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(result.ok).toBe(true);
    expect(device.loadContent).toHaveBeenCalled();
  });
});
