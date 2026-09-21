import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAckRouter } from './ackRouter.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ackRouter', () => {
  it('resolves a registered command on ok ack', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-1', { action: 'play', deviceId: 'tv' });
    expect(router.resolve({ commandId: 'cmd-1', ok: true })).toBe(true);
    await expect(p).resolves.toEqual({ ok: true });
    expect(router.pendingCount()).toBe(0);
  });

  it('rejects on not-ok ack with the error message', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-2', {});
    router.resolve({ commandId: 'cmd-2', ok: false, error: 'DEVICE_REFUSED' });
    await expect(p).rejects.toThrow('DEVICE_REFUSED');
  });

  it('rejects on timeout', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-3', {});
    const assertion = expect(p).rejects.toThrow('ack-timeout:cmd-3');
    vi.advanceTimersByTime(6000);
    await assertion;
    expect(router.pendingCount()).toBe(0);
  });

  it('ignores acks for unknown commandIds', () => {
    const router = createAckRouter();
    expect(router.resolve({ commandId: 'ghost', ok: true })).toBe(false);
  });

  it('an ack that beats slow HTTP still resolves (registration precedes the call)', async () => {
    const router = createAckRouter();
    const p = router.register('cmd-4', {});
    // ack arrives "before" the HTTP promise would settle
    router.resolve({ commandId: 'cmd-4', ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('keeps a handoff pending through a generic receipt and forwards only its typed terminal result', async () => {
    const router = createAckRouter();
    const command = { commandId: 'handoff-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'capture' } };
    const p = router.register('handoff-1', { deviceId: 'tv', handoffCommand: command });
    expect(router.resolve({ deviceId: 'tv', commandId: 'handoff-1', ok: true })).toBe(false);
    expect(router.pendingCount()).toBe(1);
    expect(router.resolve({ deviceId: 'tv', commandId: 'handoff-1', ok: false, code: 'HANDOFF_UNSUPPORTED', handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } })).toBe(true);
    await expect(p).resolves.toMatchObject({ ok: false, handoff: { phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
  });

  it('rejects duplicate pending handoff IDs and wrong device acks without disturbing the original timer', async () => {
    const router = createAckRouter();
    const command = { commandId: 'handoff-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'capture' } };
    const first = router.register('handoff-1', { deviceId: 'tv-a', handoffCommand: command });
    const duplicate = router.register('handoff-1', { deviceId: 'tv-b', handoffCommand: command });
    let duplicateError = null;
    duplicate.catch((error) => { duplicateError = error; });
    await Promise.resolve();
    expect(duplicateError).toMatchObject({ message: 'ack-duplicate:handoff-1' });
    expect(router.resolve({ deviceId: 'tv-b', commandId: 'handoff-1', ok: false, handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } })).toBe(false);
    expect(router.pendingCount()).toBe(1);
    expect(router.resolve({ deviceId: 'tv-a', commandId: 'handoff-1', ok: false, handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } })).toBe(true);
    await expect(first).resolves.toMatchObject({ handoff: { phase: 'failed' } });
  });

  it('does not settle Peek handoff on a route-bound receipt with the wrong entry or live policy', async () => {
    const router = createAckRouter();
    const expectedDestination = { ownerInstanceId: 'owner-tv', playbackRevision: 1, queueRevision: 2, sessionId: 'destination-session', contentId: null, queueItemId: null };
    const receiptIdentity = { ...expectedDestination, playbackRevision: 2, queueRevision: 3, contentId: 'plex:a', queueItemId: 'entry-a' };
    const snapshot = { sessionId: 'source-session', state: 'paused', currentItem: { contentId: 'plex:a', format: 'video' }, position: 4, queue: { items: [{ queueItemId: 'entry-a', contentId: 'plex:a', priority: 'queue' }], currentIndex: 0, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 }, meta: { ownerId: 'source', updatedAt: '2026-09-14T00:00:00.000Z' } };
    const fingerprint = 'handoff-v1:{"sessionId":"source-session","queue":{"items":[{"queueItemId":"entry-a","contentId":"plex:a","priority":"queue"}],"currentIndex":0,"executionOrder":["entry-a"]},"currentItem":{"contentId":"plex:a","format":"video"},"config":{"shuffle":false,"repeat":"off","shader":null,"volume":50,"playbackRate":1}}';
    const command = { commandId: 'start-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'start', snapshot, expectedDestination, positionPolicy: { kind: 'absolute', seconds: 4 } } };
    const ack = (identity = receiptIdentity, liveEdge = false) => ({ deviceId: 'tv-a', commandId: 'start-1', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: { transferId: 'transfer-1', phase: 'started', destination: { kind: 'device', id: 'tv-a', ownerInstanceId: 'owner-tv' }, identity, snapshotFingerprint: fingerprint, actualPosition: 4, liveEdge, receiptId: 'receipt-1' } } });
    const pending = router.register('start-1', { deviceId: 'tv-a', handoffCommand: command });
    router.resolve(ack({ ...receiptIdentity, contentId: 'plex:wrong', queueItemId: 'entry-wrong' }, true));
    router.resolve(ack());
    await expect(pending).resolves.toMatchObject({ handoff: { receipt: { identity: { contentId: 'plex:a', queueItemId: 'entry-a' }, liveEdge: false } } });
  });

  it('ignores a status recovery receipt embedded for another device but accepts the correlated route', async () => {
    const router = createAckRouter();
    const command = { commandId: 'status-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'status' } };
    const ack = (receiptDeviceId) => ({ deviceId: 'tv-a', commandId: 'status-1', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: { transferId: 'transfer-1', phase: 'started', destination: { kind: 'device', id: receiptDeviceId, ownerInstanceId: 'owner-tv' }, identity: { ownerInstanceId: 'owner-tv', playbackRevision: 2, queueRevision: 3, sessionId: 'destination-session', contentId: 'plex:a', queueItemId: 'entry-a' }, snapshotFingerprint: 'handoff-v1:status', actualPosition: 4, liveEdge: false, receiptId: 'receipt-1' } } });
    const pending = router.register('status-1', { deviceId: 'tv-a', handoffCommand: command });
    expect(router.resolve(ack('tv-wrong'))).toBe(false);
    expect(router.resolve(ack('tv-a'))).toBe(true);
    await expect(pending).resolves.toMatchObject({ handoff: { phase: 'started', receipt: { destination: { id: 'tv-a' } } } });
  });
});
