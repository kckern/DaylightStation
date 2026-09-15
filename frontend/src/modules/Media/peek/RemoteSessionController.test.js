import { describe, it, expect, vi } from 'vitest';
import { createFleetStore } from '../fleet/fleetStore.js';
import { createAckRouter } from './ackRouter.js';
import { createRemoteSessionController } from './RemoteSessionController.js';
import { assertController } from '../controller/controllerShape.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function setup({ httpImpl, onSteeringActivity } = {}) {
  const fleetStore = createFleetStore();
  const ackRouter = createAckRouter();
  const http = vi.fn(httpImpl ?? (async () => ({ ok: true })));
  let n = 0;
  const ctl = createRemoteSessionController({
    deviceId: 'tv',
    fleetStore,
    ackRouter,
    http,
    randomUuid: () => `cmd-${++n}`,
    onSteeringActivity,
  });
  return { fleetStore, ackRouter, http, ctl };
}

describe('RemoteSessionController', () => {
  it('conforms to the controller shape', () => {
    const { ctl } = setup();
    expect(() => assertController(ctl)).not.toThrow();
  });

  it('snapshot delegates to the fleet store', () => {
    const { fleetStore, ctl } = setup();
    expect(ctl.getSnapshot()).toBeNull();
    fleetStore.receive({ deviceId: 'tv', snapshot: { state: 'playing', position: 10, currentItem: { contentId: 'x' } } });
    expect(ctl.getSnapshot().state).toBe('playing');
  });

  it('subscribe fires when this device broadcasts', () => {
    const { fleetStore, ctl } = setup();
    const sub = vi.fn();
    ctl.subscribe(sub);
    fleetStore.receive({ deviceId: 'tv', snapshot: { state: 'paused', position: 5 } });
    expect(sub).toHaveBeenCalledWith(expect.objectContaining({ state: 'paused' }));
    fleetStore.receive({ deviceId: 'other', snapshot: { state: 'playing' } });
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('transport commands POST with a commandId and resolve on ack', async () => {
    const { ackRouter, http, ctl } = setup();
    const p = ctl.transport.pause();
    expect(http).toHaveBeenCalledWith(
      'api/v1/device/tv/session/transport',
      expect.objectContaining({ action: 'pause', commandId: 'cmd-1' }),
      'POST'
    );
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await expect(p).resolves.toMatchObject({ ok: true, commandId: 'cmd-1' });
  });

  it('reports a successfully acknowledged command only for fresh observed playback identity', async () => {
    const onSteeringActivity = vi.fn();
    const { fleetStore, ackRouter, ctl } = setup({ onSteeringActivity });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: {
        sessionId: 'session-1', state: 'playing',
        currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' },
      },
      reason: 'change', ts: '2026-09-14T19:00:00.000Z',
    });

    const pending = ctl.transport.pause();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await pending;

    expect(onSteeringActivity).toHaveBeenCalledWith({
      deviceId: 'tv',
      playback: { sessionId: 'session-1', contentId: 'plex:1', queueItemId: 'queue-1' },
    });
  });

  it('does not report steering for a rejected command or a missing playback observation', async () => {
    const onSteeringActivity = vi.fn();
    const { ackRouter, ctl } = setup({ onSteeringActivity });
    const pending = ctl.transport.pause();
    ackRouter.resolve({ commandId: 'cmd-1', ok: false, error: 'DENIED' });

    await expect(pending).rejects.toThrow('DENIED');
    expect(onSteeringActivity).not.toHaveBeenCalled();
  });

  it('reconciles an acknowledged Play when the matching fresh playing broadcast arrives later', async () => {
    const onSteeringActivity = vi.fn();
    const { fleetStore, ackRouter, ctl } = setup({ onSteeringActivity });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'paused', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });

    const pending = ctl.transport.play();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await pending;
    expect(onSteeringActivity).not.toHaveBeenCalled();

    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });
    expect(onSteeringActivity).toHaveBeenCalledWith({
      deviceId: 'tv',
      playback: { sessionId: 'session-1', contentId: 'plex:1', queueItemId: 'queue-1' },
    });
  });

  it('does not let an acknowledged Play inherit unrelated later playback', async () => {
    const onSteeringActivity = vi.fn();
    const { fleetStore, ackRouter, ctl } = setup({ onSteeringActivity });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'paused', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });
    const pending = ctl.transport.play();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await pending;

    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-2', state: 'playing', currentItem: { contentId: 'plex:2', queueItemId: 'queue-2' } },
    });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });

    expect(onSteeringActivity).not.toHaveBeenCalled();
  });

  it('clears a pending acknowledged Play when its remote controller is destroyed', async () => {
    const onSteeringActivity = vi.fn();
    const { fleetStore, ackRouter, ctl } = setup({ onSteeringActivity });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'paused', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });
    const pending = ctl.transport.play();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await pending;

    ctl.destroy();
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });

    expect(onSteeringActivity).not.toHaveBeenCalled();
  });

  it('clears a pending acknowledged Play when the target goes offline before playing', async () => {
    const onSteeringActivity = vi.fn();
    const { fleetStore, ackRouter, ctl } = setup({ onSteeringActivity });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'paused', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });
    const pending = ctl.transport.play();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await pending;

    fleetStore.receive({ deviceId: 'tv', snapshot: null, reason: 'offline' });
    fleetStore.receive({
      deviceId: 'tv',
      snapshot: { sessionId: 'session-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'queue-1' } },
    });

    expect(onSteeringActivity).not.toHaveBeenCalled();
  });

  it('ack arriving before HTTP settles still resolves', async () => {
    let releaseHttp;
    const { ackRouter, ctl } = setup({
      httpImpl: () => new Promise((res) => { releaseHttp = res; }),
    });
    const p = ctl.transport.play();
    ackRouter.resolve({ commandId: 'cmd-1', ok: true }); // ack first
    releaseHttp({ ok: true }); // HTTP second
    await expect(p).resolves.toMatchObject({ ok: true });
  });

  it('HTTP failure rejects without waiting for an ack', async () => {
    const { ctl } = setup({ httpImpl: async () => { throw new Error('DEVICE_OFFLINE'); } });
    await expect(ctl.transport.play()).rejects.toThrow('DEVICE_OFFLINE');
  });

  it('queue ops hit the per-op endpoints', async () => {
    const { ackRouter, http, ctl } = setup();
    const p = ctl.queue.playNow({ contentId: 'plex:1' }, { clearRest: true });
    expect(http).toHaveBeenCalledWith(
      'api/v1/device/tv/session/queue/play-now',
      expect.objectContaining({ contentId: 'plex:1', clearRest: true, commandId: 'cmd-1' }),
      'POST'
    );
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await p;
  });

  it('config setters PUT with clamped values', async () => {
    const { ackRouter, http, ctl } = setup();
    const p = ctl.config.setVolume(150);
    expect(http).toHaveBeenCalledWith(
      'api/v1/device/tv/session/volume',
      expect.objectContaining({ level: 100, commandId: 'cmd-1' }),
      'PUT'
    );
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await p;
  });

  it('position tier seeds from broadcasts and extrapolates while playing', () => {
    vi.useFakeTimers();
    try {
      const { fleetStore, ctl } = setup();
      fleetStore.receive({ deviceId: 'tv', snapshot: { state: 'playing', position: 100 } });
      const seen = [];
      const unsub = ctl.position.subscribe((p) => seen.push(p.seconds));
      vi.advanceTimersByTime(2100);
      expect(ctl.position.get().seconds).toBeGreaterThanOrEqual(102);
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it('capabilities reflect live content', () => {
    const { fleetStore, ctl } = setup();
    expect(ctl.capabilities.seekable).toBe(true);
    fleetStore.receive({ deviceId: 'tv', snapshot: { state: 'playing', currentItem: { contentId: 'cam:1', isLive: true } } });
    expect(ctl.capabilities.seekable).toBe(false);
  });
});
