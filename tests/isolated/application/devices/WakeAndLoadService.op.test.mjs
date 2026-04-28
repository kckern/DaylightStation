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

describe('WakeAndLoadService — WS-first liveness gate', () => {
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

  let svc;
  let device;
  let broadcast;
  let eventBus;
  let livenessService;

  beforeEach(() => {
    broadcast = vi.fn();
    eventBus = {
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      waitForMessage: vi.fn().mockResolvedValue({
        topic: 'device-ack', deviceId: 'tv', commandId: 'd', ok: true,
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    livenessService = { isFresh: vi.fn() };
    device = makeDevice();
    svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast,
      eventBus,
      commandHandlerLivenessService: livenessService,
      logger: makeLogger(),
    });
  });

  it('skips WS-first when liveness reports stale, falls back to FKB URL', async () => {
    livenessService.isFresh.mockReturnValue(false);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).not.toHaveBeenCalled();
    expect(device.loadContent).toHaveBeenCalled();
    expect(result.steps.load.method).toBe('fkb-fallback');
    expect(result.steps.load.wsSkipped).toBe('handler-stale');
  });

  it('uses WS-first when liveness reports fresh', async () => {
    livenessService.isFresh.mockReturnValue(true);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).toHaveBeenCalled();
    expect(result.steps.load.method).toBe('websocket');
  });

  it('skips WS-first when no subscribers (liveness fresh but count=0)', async () => {
    livenessService.isFresh.mockReturnValue(true);
    eventBus.getTopicSubscriberCount.mockReturnValue(0);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).not.toHaveBeenCalled();
    expect(result.steps.load.method).toBe('fkb-fallback');
    expect(result.steps.load.wsSkipped).toBe('no-subscribers');
  });

  it('skips WS-first on cold wake regardless of liveness', async () => {
    livenessService.isFresh.mockReturnValue(true);
    device.prepareForContent.mockResolvedValue({ ok: true, coldRestart: true, cameraAvailable: true });
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).not.toHaveBeenCalled();
    expect(device.loadContent).toHaveBeenCalled();
  });
});
