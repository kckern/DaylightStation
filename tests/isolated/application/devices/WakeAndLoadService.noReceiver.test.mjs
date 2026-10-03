// Review B3 / PR-10: when nothing is subscribed to the screen's topic, the
// URL load reports "Screen not connected" and the WebSocket fallback must not
// turn that into ok with a broadcast nobody hears.
import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function setup({ subscribers = 0, loadResult = { ok: false, error: 'Screen not connected (no receiver subscribed)' } } = {}) {
  const broadcast = vi.fn();
  const eventBus = {
    getTopicSubscriberCount: vi.fn().mockReturnValue(subscribers),
    waitForMessage: vi.fn().mockRejectedValue(new Error('waitForMessage timed out')),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
  const device = {
    id: 'tv', screenPath: '/screen/tv', defaultVolume: null,
    hasCapability: vi.fn().mockReturnValue(false),
    powerOn: vi.fn().mockResolvedValue({ ok: true, skipped: 'no_device_control' }),
    setVolume: vi.fn(),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraSkipped: true }),
    loadContent: vi.fn().mockResolvedValue(loadResult),
  };
  const svc = new WakeAndLoadService({
    ...testApplicationRuntime(),
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
    broadcast, eventBus,
    screenGateway: new EventBusDeviceTransportGateway({ eventBus, broadcastEvent: broadcast }),
    logger: logger(),
  });
  return { svc, broadcast, device };
}

const queueBroadcasts = (broadcast) => broadcast.mock.calls.filter(([m]) => m?.command === 'queue');

describe('WakeAndLoadService with no receiver', () => {
  it('reports Screen not connected and sends no void fallback broadcast', async () => {
    const { svc, broadcast } = setup();
    const result = await svc.execute('tv', { play: 'plex:1' }, { dispatchId: 'd-1', deferredRetry: false });
    expect(result).toMatchObject({ ok: false, failedStep: 'load', error: 'Screen not connected' });
    expect(queueBroadcasts(broadcast)).toEqual([]);
  });

  it('keeps the existing WebSocket fallback for a URL failure while a receiver is subscribed', async () => {
    const { svc, broadcast } = setup({ subscribers: 1, loadResult: { ok: false, error: 'FKB unreachable' } });
    const result = await svc.execute('tv', { play: 'plex:1' }, { dispatchId: 'd-2', deferredRetry: false });
    expect(queueBroadcasts(broadcast).length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });
});
