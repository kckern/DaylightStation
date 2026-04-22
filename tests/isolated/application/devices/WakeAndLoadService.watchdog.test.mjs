import { jest } from '@jest/globals';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// Minimal EventBus double implementing subscribe + publish
function makeEventBus() {
  const handlers = new Map();
  return {
    publish: (topic, payload) => {
      (handlers.get(topic) || []).forEach(h => h(payload));
    },
    subscribe: (topic, handler) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(handler);
      return () => {
        const list = handlers.get(topic);
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    getTopicSubscriberCount: () => 0,
    waitForMessage: () => Promise.reject(new Error('not used')),
  };
}

function makeDevice(overrides = {}) {
  return {
    id: 'living-room',
    screenPath: '/screen/living-room',
    defaultVolume: 10,
    hasCapability: () => false,
    powerOn: async () => ({ ok: true, verified: true, elapsedMs: 100 }),
    setVolume: async () => ({ ok: true }),
    prepareForContent: async () => ({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: async () => ({ ok: true, url: '/screen/living-room?queue=plex:1', verified: true }),
    ...overrides
  };
}

describe('WakeAndLoadService playback watchdog', () => {
  test('broadcasts timeout event when no playback.log arrives within 90s', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Watchdog running — advance 90s
    await jest.advanceTimersByTimeAsync(90_000);
    await Promise.resolve(); // flush microtasks

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'homeline:living-room',
        type: 'wake-progress',
        step: 'playback',
        status: 'timeout'
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ deviceId: 'living-room' })
    );
    jest.useRealTimers();
  });

  test('cancels watchdog when playback.log arrives for the loaded content', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Playback event arrives after 30s
    await jest.advanceTimersByTimeAsync(30_000);
    eventBus.publish('playback.log', { contentId: 'plex:1', playhead: 5 });

    await jest.advanceTimersByTimeAsync(70_000);
    await Promise.resolve();

    // timeout log should NOT have been emitted
    expect(logger.warn).not.toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.objectContaining({ deviceId: 'living-room', contentId: 'plex:1' })
    );
    jest.useRealTimers();
  });

  test('uses prewarmContentId when queue is a playlist name', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    // Simulate the prewarm service resolving a named queue to a contentId.
    // The Task 2 flow sets contentQuery.prewarmContentId = resolved plex id.
    const device = makeDevice({
      // Swap loadContent to no-op (we just care that the watchdog saw prewarmContentId)
      loadContent: async () => ({ ok: true, url: '/screen/living-room?queue=morning-program' })
    });
    const prewarmService = {
      prewarm: jest.fn().mockResolvedValue({
        status: 'ok',
        token: 'tok',
        contentId: 'plex:12345'
      })
    };
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      prewarmService,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'morning-program' });
    expect(result.ok).toBe(true);

    // /play/log broadcasts the real content id, not the queue name
    await jest.advanceTimersByTimeAsync(10_000);
    eventBus.publish('playback.log', { contentId: 'plex:12345', playhead: 3 });
    await jest.advanceTimersByTimeAsync(100_000);

    expect(logger.warn).not.toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.objectContaining({ contentId: 'plex:12345' })
    );
    jest.useRealTimers();
  });

  test('does not falsely confirm plex:12 when expecting plex:1', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    await svc.execute('living-room', { queue: 'plex:1' });

    // Different content finishes playing — must NOT confirm
    eventBus.publish('playback.log', { contentId: 'plex:12', playhead: 5 });
    await jest.advanceTimersByTimeAsync(90_000);

    // Timeout SHOULD fire because plex:12 is not plex:1
    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.any(Object)
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.any(Object)
    );
    jest.useRealTimers();
  });

  test('skips watchdog when queue param is missing', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const subscribeSpy = jest.spyOn(eventBus, 'subscribe');

    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    await svc.execute('living-room', {}); // no queue
    await jest.advanceTimersByTimeAsync(120_000);

    // With no content to track, don't arm the watchdog at all.
    expect(subscribeSpy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
