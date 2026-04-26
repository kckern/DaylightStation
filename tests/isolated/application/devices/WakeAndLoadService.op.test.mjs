import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice(overrides = {}) {
  return {
    id: 'tv',
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

describe('WakeAndLoadService op pass-through', () => {
  let svc;
  let device;
  let broadcast;
  let eventBus;

  beforeEach(() => {
    broadcast = vi.fn();
    eventBus = {
      // Return 1 subscriber so WS-first path activates
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      // Simulate a device-ack arriving promptly
      waitForMessage: vi.fn().mockResolvedValue({
        topic: 'device-ack',
        deviceId: 'tv',
        commandId: 'd',
        ok: true,
      }),
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

  function getQueueBroadcasts() {
    return broadcast.mock.calls
      .map(([msg]) => msg)
      .filter((m) => m && m.command === 'queue');
  }

  it('WS-first path forwards op=play-next from contentQuery into the broadcast envelope', async () => {
    await svc.execute('tv', { queue: 'plex:1', op: 'play-next', shader: 'dark' }, { dispatchId: 'd' });
    const queueCalls = getQueueBroadcasts();
    expect(queueCalls.length).toBeGreaterThan(0);
    expect(queueCalls[0].params.op).toBe('play-next');
    expect(queueCalls[0].params.contentId).toBe('plex:1');
  });

  it('WS-first path defaults op to play-now when contentQuery.op is absent', async () => {
    await svc.execute('tv', { queue: 'plex:1', shader: 'dark' }, { dispatchId: 'd' });
    const queueCalls = getQueueBroadcasts();
    expect(queueCalls.length).toBeGreaterThan(0);
    expect(queueCalls[0].params.op).toBe('play-now');
  });

  it('WS-first path falls back to play-now when contentQuery.op is unknown', async () => {
    await svc.execute('tv', { queue: 'plex:1', op: 'banana' }, { dispatchId: 'd' });
    const queueCalls = getQueueBroadcasts();
    expect(queueCalls.length).toBeGreaterThan(0);
    expect(queueCalls[0].params.op).toBe('play-now');
  });
});
