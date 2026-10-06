// RQ-PLAY-11 Show briefly: a screen acks a brief play with appliedAs:'brief'
// and shows it OVER its programme, so its current item never changes. The
// watchdog confirms on the published brief instead of timing out at 90 s, and
// a camera ref (`camera:<id>`) is never sent to the transcode prewarm.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const film = (controls = {}) => ({
  sessionId: 's1', state: 'paused',
  currentItem: { contentId: 'plex:film', queueItemId: 'q0', format: 'video' },
  queue: { items: [{ contentId: 'plex:film', queueItemId: 'q0' }], currentIndex: 0, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'tv', updatedAt: 'x', playbackOwner: { ownerInstanceId: 'p1', playbackRevision: 3, queueRevision: 4 } },
  controls,
});

describe('WakeAndLoadService — Show briefly', () => {
  let svc, broadcast, handlers, prewarm;
  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    handlers = new Map();
    prewarm = { prewarm: vi.fn().mockResolvedValue({ status: 'ok', token: 't', contentId: 'plex:clip' }) };
    const eventBus = {
      subscribe: vi.fn((topic, cb) => { handlers.set(topic, cb); return () => handlers.delete(topic); }),
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      waitForMessage: vi.fn(async (predicate) => {
        const [[envelope]] = broadcast.mock.calls.filter(([m]) => m.type === 'command');
        const ack = { topic: 'device-ack', deviceId: 'tv', ok: true, appliedAs: 'brief', commandId: envelope.commandId };
        return predicate(ack) ? ack : null;
      }),
    };
    const device = {
      id: 'tv', screenPath: '/screen/tv', defaultVolume: null, hasCapability: vi.fn().mockReturnValue(false),
      powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true }),
      prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
      loadContent: vi.fn().mockResolvedValue({ ok: true }),
    };
    svc = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast, eventBus, prewarmService: prewarm,
      commandHandlerLivenessService: { isFresh: () => true },
      deviceLivenessService: { getLastSnapshot: () => ({ snapshot: film() }) },
      logger: logger(),
    });
  });
  afterEach(() => vi.useRealTimers());

  it('confirms a brief camera from the published brief and never prewarms the camera', async () => {
    const result = await svc.execute('tv', { play: 'camera:doorbell' });
    expect(result).toMatchObject({ ok: true, appliedAs: 'brief' });
    expect(prewarm.prewarm).not.toHaveBeenCalled();
    const sent = broadcast.mock.calls.map(([m]) => m).find((m) => m.type === 'command');
    expect(sent.params).toMatchObject({ op: 'play-now', contentId: 'camera:doorbell' });
    handlers.get('device-state:tv')({ deviceId: 'tv', snapshot: film({ brief: { kind: 'camera', contentId: 'camera:doorbell', label: 'Doorbell' } }) });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'playback', status: 'confirmed', operation: 'brief' }));
    vi.advanceTimersByTime(90_001);
    expect(broadcast.mock.calls.some(([e]) => e.step === 'playback' && e.status === 'timeout')).toBe(false);
  });

  it('a brief clip passes its brief flag to the screen and confirms the same way', async () => {
    await svc.execute('tv', { play: 'plex:clip', brief: '1' });
    expect(prewarm.prewarm).toHaveBeenCalled();
    const sent = broadcast.mock.calls.map(([m]) => m).find((m) => m.type === 'command');
    expect(sent.params).toMatchObject({ contentId: 'plex:clip', brief: '1' });
    handlers.get('device-state:tv')({ deviceId: 'tv', snapshot: film({ brief: { kind: 'clip', contentId: 'plex:clip', label: 'Clip' } }) });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ step: 'playback', status: 'confirmed', operation: 'brief' }));
  });

  it('a cold screen gets a brief camera as the same envelope, never as a page URL', async () => {
    const device = svc.deviceService?.get?.('tv');
    // Re-wire: nobody subscribed yet, as on a cold page.
    const t0 = Date.now();
    const eventBus = {
      subscribe: vi.fn((topic, cb) => { handlers.set(topic, cb); return () => handlers.delete(topic); }),
      // The page mounts and subscribes about 4 s after the base URL loads.
      getTopicSubscriberCount: vi.fn(() => (Date.now() - t0 >= 4000 ? 1 : 0)),
      // The ack is awaited from before the page loads; it arrives once the
      // envelope has been sent.
      waitForMessage: vi.fn(async (predicate) => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const [[envelope]] = broadcast.mock.calls.filter(([m]) => m.type === 'command');
        const ack = { topic: 'device-ack', deviceId: 'tv', ok: true, appliedAs: 'brief', commandId: envelope.commandId };
        return predicate(ack) ? ack : null;
      }),
    };
    const loadContent = vi.fn().mockResolvedValue({ ok: true });
    const cold = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => ({
        id: 'tv', screenPath: '/screen/tv', defaultVolume: null, hasCapability: () => false,
        powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true }),
        prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
        loadContent,
      }) },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast, eventBus, prewarmService: prewarm,
      commandHandlerLivenessService: { isFresh: () => true },
      deviceLivenessService: { getLastSnapshot: () => null },
      logger: logger(),
    });
    const pending = cold.execute('tv', { play: 'camera:doorbell', brief: '1' });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, appliedAs: 'brief' });
    // The page URL never carried the camera or the brief flag.
    expect(loadContent.mock.calls.every(([, query]) => !query || Object.keys(query).length === 0)).toBe(true);
    const sent = broadcast.mock.calls.map(([m]) => m).find((m) => m.type === 'command');
    expect(sent.params).toMatchObject({ op: 'play-now', contentId: 'camera:doorbell', brief: '1' });
    // It went out only once the screen had subscribed — not on a fixed guess.
    expect(eventBus.getTopicSubscriberCount.mock.calls.length).toBeGreaterThan(1);
  });

  it('a cold screen that never subscribes within the bound is a failed load, not ok', async () => {
    const eventBus = {
      subscribe: vi.fn((topic, cb) => { handlers.set(topic, cb); return () => handlers.delete(topic); }),
      getTopicSubscriberCount: vi.fn().mockReturnValue(0),
      waitForMessage: vi.fn(() => new Promise(() => {})),
    };
    const cold = new WakeAndLoadService({
      ...testApplicationRuntime(),
      deviceService: { get: () => ({
        id: 'tv', screenPath: '/screen/tv', defaultVolume: null, hasCapability: () => false,
        powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true }),
        prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
        loadContent: vi.fn().mockResolvedValue({ ok: true }),
      }) },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast, eventBus, prewarmService: prewarm,
      commandHandlerLivenessService: { isFresh: () => true },
      deviceLivenessService: { getLastSnapshot: () => null },
      logger: logger(),
    });
    const pending = cold.execute('tv', { play: 'camera:doorbell', brief: '1' });
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, failedStep: 'load', error: 'Screen not connected' });
    expect(broadcast.mock.calls.some(([m]) => m.type === 'command')).toBe(false);
  });
});
