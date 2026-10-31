// PLACE.9a (RQ-PLACE-13): move playback between two other screens, or from a
// screen to this device — destination first, the source stopped (claimed,
// so it says "Moved by …") only after the destination confirms.
import { describe, it, expect, vi } from 'vitest';
import { createFleetStore } from "../fleet/fleetStore.js";
import { createLocalSessionController } from "../session/LocalSessionController.js";
import { moveScreenPlayback, moveFailureReason, createLoadAdoptDestination, createScreenMoveDestination } from "./screenMove.js";

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function published(overrides = {}) {
  return {
    sessionId: 'sess-a', state: 'playing', position: 100,
    currentItem: { contentId: 'plex:1', title: 'Hospital', duration: 420, format: 'video', queueItemId: 'q1' },
    queue: { items: [{ queueItemId: 'q1', contentId: 'plex:1', title: 'Hospital', format: 'video', duration: 420 }], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: 'kitchen', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'owner-a', playbackRevision: 3, queueRevision: 2, sessionId: 'sess-a', contentId: 'plex:1', queueItemId: 'q1' } },
    ...overrides,
  };
}

function storeWith(snapshot) {
  const store = createFleetStore();
  store.receive({ deviceId: 'kitchen', snapshot, ts: new Date().toISOString() });
  return store;
}

describe('moveScreenPlayback', () => {
  it('starts it at the destination first, then claims the source with this device as origin', async () => {
    const order = [];
    const destination = { adopt: vi.fn(async (request) => { order.push('adopt'); expect(request.snapshot.position).toBeGreaterThanOrEqual(100); return { status: 'adopted' }; }) };
    const http = vi.fn(async () => { order.push('claim'); return { ok: true }; });
    const origin = { kind: 'device', id: 'browser:me', name: "Dad's phone" };
    const result = await moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'den', fleetStore: storeWith(published()), http, destination, origin, operationId: 'op1' });
    expect(result).toMatchObject({ ok: true, sourceStopped: true, title: 'Hospital' });
    expect(order).toEqual(['adopt', 'claim']);
    expect(http).toHaveBeenCalledWith('api/v1/device/kitchen/session/claim', { commandId: 'op1:claim', origin }, 'POST');
  });

  it('leaves the source playing when the destination does not confirm', async () => {
    const http = vi.fn();
    const destination = { adopt: async () => ({ status: 'uncertain', reason: 'start-not-confirmed' }) };
    const result = await moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'den', fleetStore: storeWith(published()), http, destination });
    expect(result.ok).toBe(false);
    expect(http).not.toHaveBeenCalled();
    expect(moveFailureReason(result)).toBe('The new screen did not confirm; the original kept playing');
  });

  it('does not stop the source if something else started there meanwhile', async () => {
    const store = storeWith(published());
    const http = vi.fn();
    const destination = { adopt: async () => {
      store.receive({ deviceId: 'kitchen', snapshot: published({ meta: { ...published().meta, playbackOwner: { ...published().meta.playbackOwner, playbackRevision: 4 } } }), ts: new Date().toISOString() });
      return { status: 'adopted' };
    } };
    const result = await moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'den', fleetStore: store, http, destination });
    expect(result).toMatchObject({ ok: false, reason: 'source-changed', sourceStopped: false });
    expect(http).not.toHaveBeenCalled();
  });

  it('moves it to this device: the local session adopts the same item at the same spot', async () => {
    const local = createLocalSessionController({ clientId: 'me', sessionControls: { storage: null } });
    const http = vi.fn(async () => ({ ok: true }));
    const result = await moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'local', fleetStore: storeWith(published({ state: 'paused' })), http, localController: local });
    expect(result.ok).toBe(true);
    expect(local.getSnapshot().currentItem.contentId).toBe('plex:1');
    expect(local.getSnapshot().position).toBe(100);
    expect(http).toHaveBeenCalledWith('api/v1/device/kitchen/session/claim', expect.any(Object), 'POST');
  });

  it('refuses a screen that publishes no playback owner identity, touching nothing', async () => {
    const snapshot = published();
    delete snapshot.meta.playbackOwner;
    const http = vi.fn();
    const result = await moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'den', fleetStore: storeWith(snapshot), http, destination: { adopt: vi.fn() } });
    expect(result).toMatchObject({ ok: false, reason: 'no-owner-identity' });
    expect(http).not.toHaveBeenCalled();
  });
});


describe('moving to an idle screen (no owner to capture)', () => {
  it('falls back after a capture 502 and keeps the source until the destination reports adoption', async () => {
    const store = storeWith(published());
    store.receive({ deviceId: 'den', snapshot: { sessionId: 'game', state: 'playing', currentItem: { contentId: 'arcade:gb/game', format: 'game' }, meta: { authority: 'arcade-session' } }, ts: new Date().toISOString() });
    const http = vi.fn(async url => {
      if (url.endsWith('/session/handoff')) throw new Error('HTTP 502: Bad Gateway');
      return { ok: true };
    });
    const pending = moveScreenPlayback({ sourceId: 'kitchen', destinationId: 'den', fleetStore: store, http, operationId: 'op' });
    await vi.waitFor(() => expect(http.mock.calls.map(c => c[0])).toContain('api/v1/device/den/load'));
    expect(http.mock.calls.map(c => c[0])).not.toContain('api/v1/device/kitchen/session/claim');
    store.receive({ deviceId: 'den', snapshot: published({ sessionId: 'movie' }), ts: new Date().toISOString() });
    await expect(pending).resolves.toMatchObject({ ok: true, sourceStopped: true });
    expect(http).toHaveBeenLastCalledWith('api/v1/device/kitchen/session/claim', expect.any(Object), 'POST');
  });

  it('does not fall back after a start HTTP failure because playback may already have started', async () => {
    const store = createFleetStore(), snapshot = published();
    const http = vi.fn()
      .mockResolvedValueOnce({ ok: true, commandId: 'op:capture', handoff: { transferId: 'op', phase: 'captured', capture: { snapshot, identity: snapshot.meta.playbackOwner, capabilities: { handoffV1: true, seekable: true, liveEdge: false } } } })
      .mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway'));
    await expect(createScreenMoveDestination({ deviceId: 'den', fleetStore: store, http }).adopt({ operationId: 'op', destinationId: 'den', snapshot }))
      .resolves.toMatchObject({ status: 'uncertain', reason: 'HTTP 502: Bad Gateway' });
    expect(http.mock.calls.map(c => c[0])).toEqual(['api/v1/device/den/session/handoff', 'api/v1/device/den/session/handoff']);
    expect(http.mock.calls[1][1].params.op).toBe('start');
  });

  it('adopts through the adopt load, and counts only once the screen reports the same item', async () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'den', snapshot: { sessionId: 'den-idle', state: 'idle', currentItem: null, queue: { items: [], currentIndex: -1 } }, ts: new Date().toISOString() });
    const http = vi.fn(async () => ({ ok: true }));
    const destination = createLoadAdoptDestination({ deviceId: 'den', fleetStore: store, http, observeMs: 2000 });
    const snapshot = published();
    const pending = destination.adopt({ operationId: 'op', snapshot });
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    expect(http).toHaveBeenCalledWith('api/v1/device/den/load', { dispatchId: 'op:adopt', snapshot, mode: 'adopt' }, 'POST');
    store.receive({ deviceId: 'den', snapshot: published({ sessionId: 'sess-a', meta: { ownerId: 'den' } }), ts: new Date().toISOString() });
    await expect(pending).resolves.toEqual({ status: 'adopted' });
  });

  it('is uncertain when the screen never reports it', async () => {
    const store = createFleetStore();
    const destination = createLoadAdoptDestination({ deviceId: 'den', fleetStore: store, http: async () => ({ ok: true }), observeMs: 20 });
    await expect(destination.adopt({ operationId: 'op', snapshot: published() })).resolves.toMatchObject({ status: 'uncertain' });
  });

  it('uses the typed hand-off first and falls back only when there is nothing to capture', async () => {
    const store = createFleetStore();
    const http = vi.fn(async (url) => (url.endsWith('/session/handoff')
      ? { ok: false, code: 'INVALID_CAPTURE', handoff: { transferId: 'op', phase: 'failed', code: 'INVALID_CAPTURE' } }
      : { ok: true }));
    const destination = createScreenMoveDestination({ deviceId: 'den', fleetStore: store, http });
    const pending = destination.adopt({ operationId: 'op', destinationId: 'den', snapshot: published() });
    await vi.waitFor(() => expect(http.mock.calls.map((c) => c[0])).toContain('api/v1/device/den/load'));
    store.receive({ deviceId: 'den', snapshot: published({ sessionId: 'new' }), ts: new Date().toISOString() });
    await expect(pending).resolves.toEqual({ status: 'adopted' });
  });
});
