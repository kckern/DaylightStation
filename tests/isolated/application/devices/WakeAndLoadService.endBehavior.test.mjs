import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice(overrides = {}) {
  return {
    id: 'livingroom-tv',
    screenPath: '/screen/tv',
    defaultVolume: 10,
    hasCapability: vi.fn().mockReturnValue(false),
    powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 50 }),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('WakeAndLoadService — end-behavior propagation', () => {
  let svc;
  let device;
  let broadcast;
  let eventBus;

  beforeEach(() => {
    broadcast = vi.fn();
    // 0 subscribers forces fall-through to device.loadContent (FKB path)
    eventBus = {
      getTopicSubscriberCount: vi.fn().mockReturnValue(0),
      waitForMessage: vi.fn().mockRejectedValue(new Error('not used')),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    device = makeDevice();
    svc = new WakeAndLoadService({
      deviceService: { get: vi.fn().mockReturnValue(device) },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast,
      eventBus,
      logger: makeLogger(),
    });
  });

  it('injects endBehavior, endDeviceId, endLocation into contentQuery', async () => {
    await svc.execute('livingroom-tv', { queue: 'plex:1' }, {
      dispatchId: 'd1',
      endBehavior: 'tv-off',
      endLocation: 'living_room',
    });
    expect(device.loadContent).toHaveBeenCalledTimes(1);
    const [, query] = device.loadContent.mock.calls[0];
    expect(query.endBehavior).toBe('tv-off');
    expect(query.endLocation).toBe('living_room');
    expect(query.endDeviceId).toBe('livingroom-tv');
  });

  it('omits end-behavior fields when endBehavior is absent', async () => {
    await svc.execute('livingroom-tv', { queue: 'plex:1' }, { dispatchId: 'd1' });
    expect(device.loadContent).toHaveBeenCalledTimes(1);
    const [, query] = device.loadContent.mock.calls[0];
    expect(query.endBehavior).toBeUndefined();
    expect(query.endLocation).toBeUndefined();
    expect(query.endDeviceId).toBeUndefined();
  });

  it("does not inject when endBehavior === 'nothing'", async () => {
    await svc.execute('livingroom-tv', { queue: 'plex:1' }, {
      dispatchId: 'd1',
      endBehavior: 'nothing',
      endLocation: 'living_room',
    });
    expect(device.loadContent).toHaveBeenCalledTimes(1);
    const [, query] = device.loadContent.mock.calls[0];
    expect(query.endBehavior).toBeUndefined();
    expect(query.endLocation).toBeUndefined();
    expect(query.endDeviceId).toBeUndefined();
  });

  it('omits endLocation when only endBehavior is provided', async () => {
    await svc.execute('livingroom-tv', { queue: 'plex:1' }, {
      dispatchId: 'd1',
      endBehavior: 'tv-off',
    });
    expect(device.loadContent).toHaveBeenCalledTimes(1);
    const [, query] = device.loadContent.mock.calls[0];
    expect(query.endBehavior).toBe('tv-off');
    expect(query.endDeviceId).toBe('livingroom-tv');
    expect(query.endLocation).toBeUndefined();
  });
});
