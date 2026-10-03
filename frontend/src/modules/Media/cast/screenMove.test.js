// PLACE.9a (RQ-PLACE-13): move playback between two other screens, or from a
// screen to this device — destination first, the source stopped (claimed,
// so it says "Moved by …") only after the destination confirms.
import { describe, it, expect, vi } from 'vitest';
import { createFleetStore } from '../fleet/fleetStore.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { moveScreenPlayback, moveFailureReason } from './screenMove.js';

vi.mock('../logging/mediaLog.js', () => {
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
