// Regression: a play=<container> dispatch (e.g. play=plex:59493, a show) must
// prewarm just as queue= does, so the receiver-outcome watchdog can match the
// resolved child state. `WakeAndLoadService.watchdog.test.mjs` owns the
// authoritative proof: only correlated target device-state—not global
// playback.log—can confirm playback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

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

function makeEventBus() {
  const handlers = new Map();
  return {
    handlers,
    subscribe: vi.fn((topic, cb) => {
      handlers.set(topic, cb);
      return () => handlers.delete(topic);
    }),
    getTopicSubscriberCount: vi.fn().mockReturnValue(0),
    emit(topic, payload) {
      handlers.get(topic)?.(payload);
    },
  };
}

describe('WakeAndLoadService — playback watchdog on container dispatches', () => {
  let svc, device, broadcast, eventBus, prewarmService;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    device = makeDevice();
    eventBus = makeEventBus();
    prewarmService = {
      // play=plex:59493 (show container) resolves to first playable episode
      prewarm: vi.fn().mockResolvedValue({ status: 'ok', token: 't0k3n', contentId: 'plex:347695' }),
    };
    svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() },
      broadcast,
      eventBus,
      screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
      prewarmService,
      logger: makeLogger(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs prewarm for play= dispatches (not just queue=)', async () => {
    await svc.execute('tv', { play: 'plex:59493' });
    expect(prewarmService.prewarm).toHaveBeenCalledWith('plex:59493', expect.any(Object));
  });
});
