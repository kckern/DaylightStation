import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';
import { WebSocketContentAdapter } from '#adapters/devices/WebSocketContentAdapter.mjs';
import { DeviceContentDispatchService } from '#apps/devices/services/DeviceContentDispatchService.mjs';
import { buildDispatchUrl } from '../../../../frontend/src/modules/Media/cast/dispatchUrl.js';
import { AUTOPLAY_ACTIONS, autoplayToAction, parseAutoplayParams } from '../../../../frontend/src/lib/parseAutoplayParams.js';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

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
      ...testApplicationRuntime(),
      deviceService: { get: vi.fn().mockReturnValue(device) },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      logger: makeLogger(),
    });
  });

  function getQueueBroadcasts() {
    return broadcast.mock.calls
      .map(([msg]) => msg)
      .filter((m) => m && m.command === 'queue');
  }

  it('carries the same item operation through warm delivery and cold URL fallback', async () => {
    const itemAction = { kind: 'playNow', operationId: 'op-1', tappedAt: 1000, clearRest: false, item: { contentId: 'plex:1', format: 'video' } };
    const query = { play: 'plex:1', itemAction: JSON.stringify(itemAction) };
    await svc.execute('tv', query, { dispatchId: 'd' });
    expect(getQueueBroadcasts()[0].params).toMatchObject({ op: 'item-action', ...itemAction });
    eventBus.getTopicSubscriberCount.mockReturnValue(0);
    await svc.execute('tv', query, { dispatchId: 'cold' });
    const coldQuery = device.loadContent.mock.calls.at(-1)[1];
    expect(autoplayToAction(parseAutoplayParams(`?${new URLSearchParams(coldQuery)}`, AUTOPLAY_ACTIONS))).toEqual({
      event: 'media:queue-op', payload: { op: 'item-action', ...itemAction, commandId: 'cold' },
    });
  });

  it('plain screen navigation does not attach a media dispatch id or wait for a receiver ack', async () => {
    await svc.execute('tv', {}, { dispatchId: 'navigation-1' });

    expect(device.loadContent).toHaveBeenCalledWith('/screen/tv', {}, { verifyAsync: true });
    expect(eventBus.waitForMessage).not.toHaveBeenCalled();
  });

  it('ordinary aimed Add survives URL, load service, and WebSocket adapter as queue op=add', async () => {
    const wsBus = {
      broadcast: vi.fn().mockResolvedValue(undefined),
      getSubscribers: vi.fn().mockReturnValue([]),
    };
    const adapter = new WebSocketContentAdapter(
      { topic: 'office', deviceId: 'tv' },
      { wsBus, logger: makeLogger() },
    );
    let parsedReceiverAction = null;
    const adapterDevice = makeDevice({ loadContent: vi.fn((path, query) => {
      parsedReceiverAction = autoplayToAction(parseAutoplayParams(
        `?${new URLSearchParams(query)}`, AUTOPLAY_ACTIONS,
      ));
      return adapter.load(path, query);
    }) });
    const directSvc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: vi.fn().mockReturnValue(adapterDevice) },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      logger: makeLogger(),
    });
    const dispatchUrl = new URL(buildDispatchUrl({
      deviceId: 'tv', queue: 'plex:1', dispatchId: 'add-1',
    }), 'http://daylight.test/');

    const dispatchService = new DeviceContentDispatchService({
      wakeAndLoad: directSvc,
      idempotency: { runWithIdempotency: vi.fn() },
      configuration: { device: () => null },
      logger: makeLogger(),
    });
    await dispatchService.load('tv', Object.fromEntries(dispatchUrl.searchParams));

    const [, envelope] = wsBus.broadcast.mock.calls[0];
    expect(parsedReceiverAction).toEqual({
      event: 'media:queue-op',
      payload: { op: 'add', contentId: 'plex:1', commandId: 'add-1' },
    });
    expect(envelope).toMatchObject({
      targetDevice: 'tv',
      command: 'queue',
      commandId: 'add-1',
      params: { op: 'add', contentId: 'plex:1' },
    });
    expect(envelope.params).not.toHaveProperty('dispatchId');
  });

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
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
        readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
        broadcast,
        eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      commandHandlerLivenessService: livenessService,
      logger: makeLogger(),
    });
  });

  it('skips WS-first when liveness reports stale, falls back to FKB URL', async () => {
    livenessService.isFresh.mockReturnValue(false);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).toHaveBeenCalledTimes(1); // URL receiver applied-ack
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

    expect(eventBus.waitForMessage).toHaveBeenCalledTimes(1); // URL receiver applied-ack
    expect(result.steps.load.method).toBe('fkb-fallback');
    expect(result.steps.load.wsSkipped).toBe('no-subscribers');
  });

  it('skips WS-first on cold wake regardless of liveness', async () => {
    livenessService.isFresh.mockReturnValue(true);
    device.prepareForContent.mockResolvedValue({ ok: true, coldRestart: true, cameraAvailable: true });
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).toHaveBeenCalledTimes(1); // cold URL receiver applied-ack
    expect(device.loadContent).toHaveBeenCalled();
  });
});
