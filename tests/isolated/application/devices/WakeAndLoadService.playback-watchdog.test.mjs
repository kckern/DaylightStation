// Regression: a play=<container> dispatch (e.g. play=plex:59493, a show) is
// resolved by the device to a FLAT child key (plex:347695). The watchdog used
// to arm with only the container id, which can never prefix-match the child,
// so every container dispatch reported a false `playback: timeout`
// (2026-07-14 Bluey cast). Prewarm now runs for play= too and its resolved
// first-playable id is an accepted match candidate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

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
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() },
      broadcast,
      eventBus,
      prewarmService,
      logger: makeLogger(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const timeoutBroadcasts = () =>
    broadcast.mock.calls.filter(([msg]) => msg?.step === 'playback' && msg?.status === 'timeout');

  it('runs prewarm for play= dispatches (not just queue=)', async () => {
    await svc.execute('tv', { play: 'plex:59493' });
    expect(prewarmService.prewarm).toHaveBeenCalledWith('plex:59493', expect.any(Object));
  });

  it('confirms playback when the device reports the resolved CHILD id', async () => {
    await svc.execute('tv', { play: 'plex:59493' });

    // Device resolved the show container itself and reports the episode.
    eventBus.emit('playback.log', { contentId: 'plex:347695' });
    await vi.advanceTimersByTimeAsync(91_000);

    expect(timeoutBroadcasts()).toHaveLength(0);
  });

  it('still confirms on the original id (non-container dispatch)', async () => {
    prewarmService.prewarm.mockResolvedValue({ status: 'skipped', reason: 'not plex' });
    await svc.execute('tv', { play: 'plex:12345' });

    eventBus.emit('playback.log', { contentId: 'plex:12345' });
    await vi.advanceTimersByTimeAsync(91_000);

    expect(timeoutBroadcasts()).toHaveLength(0);
  });

  it('still times out when nothing plays', async () => {
    await svc.execute('tv', { play: 'plex:59493' });

    eventBus.emit('playback.log', { contentId: 'plex:999999' }); // unrelated content
    await vi.advanceTimersByTimeAsync(91_000);

    expect(timeoutBroadcasts()).toHaveLength(1);
  });
});
