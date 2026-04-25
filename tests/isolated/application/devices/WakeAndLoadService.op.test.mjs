import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeDevice(overrides = {}) {
  return {
    id: 'tv',
    screenPath: '/screen/tv',
    defaultVolume: 10,
    hasCapability: jest.fn().mockReturnValue(false),
    powerOn: jest.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 50 }),
    setVolume: jest.fn().mockResolvedValue({ ok: true }),
    prepareForContent: jest.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('WakeAndLoadService op pass-through', () => {
  let svc;
  let device;
  let broadcast;
  let eventBus;

  beforeEach(() => {
    broadcast = jest.fn();
    eventBus = {
      // Return 1 subscriber so WS-first path activates
      getTopicSubscriberCount: jest.fn().mockReturnValue(1),
      // Simulate a device-ack arriving promptly
      waitForMessage: jest.fn().mockResolvedValue({
        topic: 'device-ack',
        deviceId: 'tv',
        commandId: 'd',
        ok: true,
      }),
      subscribe: jest.fn().mockReturnValue(() => {}),
    };
    device = makeDevice();
    svc = new WakeAndLoadService({
      deviceService: { get: jest.fn().mockReturnValue(device) },
      readinessPolicy: { isReady: jest.fn().mockResolvedValue({ ready: true }) },
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
