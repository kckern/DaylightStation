import { vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
  test('ignores foreign playback logs and confirms Play only from the target owner state', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    eventBus.getTopicSubscriberCount = () => 1;
    eventBus.waitForMessage = async () => ({
      topic: 'device-ack', deviceId: 'living-room', commandId: 'test-dispatch-1', ok: true,
    });
    const baseline = {
      sessionId: 'session-1', state: 'paused',
      currentItem: { contentId: 'plex:old', format: 'video' },
      queue: { items: [{ contentId: 'plex:old', queueItemId: 'old', format: 'video' }], currentIndex: 0, upNextCount: 0, executionOrder: ['old'] },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'screen-owner', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'player-1', playbackRevision: 2, queueRevision: 3, contentId: 'plex:old', queueItemId: 'old' } },
    };
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(), deviceService: { get: () => makeDevice() },
      readinessPolicy: { isReady: async () => ({ ready: true }) }, broadcast, eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: baseline }) }, logger,
    });

    await svc.execute('living-room', { play: 'plex:1' });
    eventBus.publish('playback.log', { contentId: 'plex:1', playhead: 5 });
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ step: 'playback', status: 'confirmed' }));

    eventBus.publish('device-state:living-room', {
      deviceId: 'living-room', reason: 'change',
      snapshot: {
        ...baseline, state: 'playing',
        currentItem: { contentId: 'plex:1', format: 'video' },
        meta: { ...baseline.meta, playbackOwner: { ownerInstanceId: 'player-1', playbackRevision: 3, queueRevision: 4, contentId: 'plex:1', queueItemId: 'new' } },
      },
    });

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'homeline:living-room', dispatchId: expect.any(String),
      step: 'playback', status: 'confirmed', sessionId: 'session-1', ownerInstanceId: 'player-1',
    }));
    vi.useRealTimers();
  });

  test('confirms Add from a matching owner queue revision without calling it playback', async () => {
    vi.useFakeTimers();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    eventBus.getTopicSubscriberCount = () => 1;
    eventBus.waitForMessage = async () => ({
      topic: 'device-ack', deviceId: 'living-room', commandId: 'test-dispatch-2', ok: true,
    });
    const current = { contentId: 'plex:old', queueItemId: 'old', format: 'video' };
    const baseline = {
      sessionId: 'session-add', state: 'playing', currentItem: current,
      queue: { items: [current], currentIndex: 0, upNextCount: 0, executionOrder: ['old'] },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'screen-owner', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'player-add', playbackRevision: 7, queueRevision: 8, contentId: 'plex:old', queueItemId: 'old' } },
    };
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(), deviceService: { get: () => makeDevice() },
      readinessPolicy: { isReady: async () => ({ ready: true }) }, broadcast, eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: baseline }) }, logger: makeLogger(),
    });

    await svc.execute('living-room', { queue: 'plex:added', op: 'add' });
    eventBus.publish('device-state:living-room', {
      deviceId: 'living-room', reason: 'change',
      snapshot: {
        ...baseline,
        queue: { ...baseline.queue, items: [current, { contentId: 'plex:added', queueItemId: 'added', format: 'video' }], executionOrder: ['old', 'added'] },
        meta: { ...baseline.meta, playbackOwner: { ...baseline.meta.playbackOwner, queueRevision: 9 } },
      },
    });

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'homeline:living-room', step: 'queue', status: 'confirmed',
      operation: 'add', sessionId: 'session-add', ownerInstanceId: 'player-add', queueLength: 2,
    }));
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ step: 'playback', status: 'confirmed' }));
    vi.useRealTimers();
  });

  test('cold URL Add can confirm through its dispatchId ack and target owner state', async () => {
    vi.useFakeTimers();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    eventBus.waitForMessage = vi.fn().mockResolvedValue({
      topic: 'device-ack', deviceId: 'living-room', commandId: 'cold-add-1', ok: true,
    });
    const current = { contentId: 'plex:old', queueItemId: 'old', format: 'video' };
    const baseline = {
      sessionId: 'session-cold', state: 'playing', currentItem: current,
      queue: { items: [current], currentIndex: 0, upNextCount: 0, executionOrder: ['old'] },
      config: { shuffle: false, repeat: 'off', shader: 'dark', volume: 50, playbackRate: 1 },
      meta: { ownerId: 'screen-owner', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'player-cold', playbackRevision: 4, queueRevision: 5, contentId: 'plex:old', queueItemId: 'old' } },
    };
    const device = makeDevice({
      prepareForContent: async () => ({ ok: true, coldRestart: true, cameraAvailable: true }),
      loadContent: vi.fn().mockResolvedValue({ ok: true, verified: true }),
    });
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(), deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) }, broadcast, eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: baseline }) }, logger: makeLogger(),
    });

    await svc.execute('living-room', { queue: 'plex:added', op: 'add' }, { dispatchId: 'cold-add-1' });
    expect(device.loadContent).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ dispatchId: 'cold-add-1' }), expect.any(Object),
    );
    expect(eventBus.waitForMessage).toHaveBeenCalledWith(expect.any(Function), 15_000);
    eventBus.publish('device-state:living-room', {
      deviceId: 'living-room', reason: 'change', snapshot: {
        ...baseline,
        queue: { ...baseline.queue, items: [current, { contentId: 'plex:added', queueItemId: 'added', format: 'video' }], executionOrder: ['old', 'added'] },
        meta: { ...baseline.meta, playbackOwner: { ...baseline.meta.playbackOwner, queueRevision: 6 } },
      },
    });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'queue', status: 'confirmed' }));
    vi.useRealTimers();
  });

  test('URL failure keeps the correlated ack listener alive through delayed WS fallback', async () => {
    vi.useFakeTimers();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    eventBus.getTopicSubscriberCount = () => 0;
    eventBus.waitForMessage = vi.fn().mockResolvedValue({
      topic: 'device-ack', deviceId: 'living-room', commandId: 'fallback-add-1', ok: true,
    });
    const current = { contentId: 'plex:old', queueItemId: 'old', format: 'video' };
    const baseline = {
      sessionId: 'session-fallback', state: 'playing', currentItem: current,
      queue: { items: [current], currentIndex: 0, upNextCount: 0, executionOrder: ['old'] },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'screen-owner', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'player-fallback', playbackRevision: 2, queueRevision: 2, contentId: 'plex:old', queueItemId: 'old' } },
    };
    const device = makeDevice({
      loadContent: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: 'url failed' })
        .mockResolvedValueOnce({ ok: true }),
    });
    const runtime = testApplicationRuntime();
    runtime.scheduler.wait = vi.fn().mockResolvedValue(undefined);
    const svc = new WakeAndLoadService({
      ...runtime, deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) }, broadcast, eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: baseline }) }, logger: makeLogger(),
    });

    const result = await svc.execute(
      'living-room', { queue: 'plex:added', op: 'add' }, { dispatchId: 'fallback-add-1' },
    );
    expect(result.steps.load.method).toBe('websocket-fallback');
    expect(eventBus.waitForMessage).toHaveBeenCalledTimes(1);
    expect(eventBus.waitForMessage).toHaveBeenCalledWith(expect.any(Function), 15_000);
    eventBus.publish('device-state:living-room', {
      deviceId: 'living-room', reason: 'change', snapshot: {
        ...baseline,
        queue: { ...baseline.queue, items: [current, { contentId: 'plex:added', queueItemId: 'added', format: 'video' }], executionOrder: ['old', 'added'] },
        meta: { ...baseline.meta, playbackOwner: { ...baseline.meta.playbackOwner, queueRevision: 3 } },
      },
    });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'queue', status: 'confirmed' }));
    vi.useRealTimers();
  });

  test('broadcasts timeout event when no playback.log arrives within 90s', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Watchdog running — advance 90s
    await vi.advanceTimersByTimeAsync(90_000);
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
    vi.useRealTimers();
  });

  test('does not accept an unowned global playback.log as target playback proof', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Playback event arrives after 30s
    await vi.advanceTimersByTimeAsync(30_000);
    eventBus.publish('playback.log', { contentId: 'plex:1', playhead: 5 });

    await vi.advanceTimersByTimeAsync(70_000);
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ expectedContentId: 'plex:1' })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.any(Object)
    );
    vi.useRealTimers();
  });

  test('uses prewarmContentId for the correlated timeout when queue is a playlist name', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    // Simulate the prewarm service resolving a named queue to a contentId.
    // The Task 2 flow sets contentQuery.prewarmContentId = resolved plex id.
    const device = makeDevice({
      // Swap loadContent to no-op (we just care that the watchdog saw prewarmContentId)
      loadContent: async () => ({ ok: true, url: '/screen/living-room?queue=morning-program' })
    });
    const prewarmService = {
      prewarm: vi.fn().mockResolvedValue({
        status: 'ok',
        token: 'tok',
        contentId: 'plex:12345'
      })
    };
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      prewarmService,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'morning-program' });
    expect(result.ok).toBe(true);

    // /play/log broadcasts the real content id, not the queue name
    await vi.advanceTimersByTimeAsync(10_000);
    eventBus.publish('playback.log', { contentId: 'plex:12345', playhead: 3 });
    await vi.advanceTimersByTimeAsync(100_000);

    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ expectedContentId: 'plex:12345' })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.any(Object)
    );
    vi.useRealTimers();
  });

  test('does not falsely confirm plex:12 when expecting plex:1', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger
    });

    await svc.execute('living-room', { queue: 'plex:1' });

    // Different content finishes playing — must NOT confirm
    eventBus.publish('playback.log', { contentId: 'plex:12', playhead: 5 });
    await vi.advanceTimersByTimeAsync(90_000);

    // Timeout SHOULD fire because plex:12 is not plex:1
    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.any(Object)
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.any(Object)
    );
    vi.useRealTimers();
  });

  test('skips watchdog for empty/no-content query', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const subscribeSpy = vi.spyOn(eventBus, 'subscribe');

    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger
    });

    await svc.execute('living-room', {}); // no queue
    await vi.advanceTimersByTimeAsync(120_000);

    // With no content to track, don't arm the watchdog at all.
    expect(subscribeSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('does NOT arm watchdog for a menu list query (no false timeout)', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const subscribeSpy = vi.spyOn(eventBus, 'subscribe');
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger,
    });

    const result = await svc.execute('living-room', { list: 'plex:12345' });
    expect(result.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(90_000);

    // No playback.log subscription => watchdog never armed
    expect(subscribeSpy).not.toHaveBeenCalledWith('playback.log', expect.anything());
    expect(logger.warn).not.toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.anything()
    );
    vi.useRealTimers();
  });

  test('arms watchdog for play-next queries and times out when nothing plays', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const broadcast = vi.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger,
    });

    const result = await svc.execute('living-room', { 'play-next': 'plex:621568', op: 'play-next' });
    expect(result.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(90_000);

    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ expectedContentId: 'plex:621568' })
    );
    vi.useRealTimers();
  });

  test('play-next also rejects global playback.log without target owner state', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const eventBus = makeEventBus();
    const broadcast = vi.fn();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: vi.fn() }),
      logger,
    });

    await svc.execute('living-room', { 'play-next': 'plex:621568', op: 'play-next' });
    eventBus.publish('playback.log', { contentId: 'plex:621568' });
    await vi.advanceTimersByTimeAsync(90_000);

    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ expectedContentId: 'plex:621568' })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.anything()
    );
    vi.useRealTimers();
  });
});
