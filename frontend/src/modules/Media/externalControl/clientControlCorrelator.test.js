import { describe, expect, it, vi } from 'vitest';
import { createClientControlCorrelator } from './clientControlCorrelator.js';
const expectedDestination = { ownerInstanceId: 'owner-client', playbackRevision: 1, queueRevision: 2, sessionId: 'destination-session', contentId: null, queueItemId: null };
const receiptIdentity = { ...expectedDestination, playbackRevision: 2, queueRevision: 3, contentId: 'plex:a', queueItemId: 'entry-a' };
const snapshot = { sessionId: 'source-session', state: 'paused', currentItem: { contentId: 'plex:a', format: 'video' }, position: 4, queue: { items: [{ queueItemId: 'entry-a', contentId: 'plex:a', priority: 'queue' }], currentIndex: 0, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 }, meta: { ownerId: 'source', updatedAt: '2026-09-14T00:00:00.000Z' } };
const snapshotFingerprint = 'handoff-v1:{"sessionId":"source-session","queue":{"items":[{"queueItemId":"entry-a","contentId":"plex:a","priority":"queue"}],"currentIndex":0,"executionOrder":["entry-a"]},"currentItem":{"contentId":"plex:a","format":"video"},"config":{"shuffle":false,"repeat":"off","shader":null,"volume":50,"playbackRate":1}}';
const handoffStart = { commandId: 'handoff-start', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'start', snapshot, expectedDestination, positionPolicy: { kind: 'absolute', seconds: 4 } } };
const handoffStatus = { commandId: 'handoff-status', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'status' } };
const startedAck = (overrides = {}) => ({ topic: 'client-ack:caller', clientId: 'target', commandId: 'handoff-start', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: { transferId: 'transfer-1', phase: 'started', destination: { kind: 'client', id: 'target', ownerInstanceId: 'owner-client' }, identity: receiptIdentity, snapshotFingerprint, actualPosition: 4, liveEdge: false, receiptId: 'receipt-1', ...overrides } } });

function transport() {
  let listener;
  let status;
  return {
    subscribe: vi.fn((filter, cb) => { listener = { filter, cb }; return vi.fn(); }),
    onStatusChange: vi.fn((cb) => { status = cb; return vi.fn(); }),
    sendEphemeral: vi.fn(() => true),
    ack: (msg) => listener.cb(msg),
    status: (s) => status(s),
  };
}

describe('client control correlator', () => {
  it('installs its exact caller ack listener before sending and resolves only matching target plus command', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const pending = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-1', command: 'transport', params: { action: 'pause' } } });
    expect(ws.subscribe).toHaveBeenCalledBefore(ws.sendEphemeral);
    expect(ws.sendEphemeral).toHaveBeenCalledWith(expect.objectContaining({ topic: 'client-control:target', replyToControlClientId: 'caller' }));
    ws.ack({ topic: 'client-ack:caller', clientId: 'other', commandId: 'cmd-1', ok: true });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'other', ok: true });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'cmd-1', ok: false, code: 'REFUSED' });
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'REFUSED' });
    correlator.dispose();
  });

  it('fails pending work on disconnect and does not claim send success when unavailable', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    ws.sendEphemeral.mockReturnValue(false);
    await expect(correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-2', command: 'transport', params: { action: 'pause' } } })).rejects.toThrow(/unavailable/);
    ws.sendEphemeral.mockReturnValue(true);
    const pending = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-3', command: 'transport', params: { action: 'pause' } } });
    ws.status({ connected: false });
    await expect(pending).rejects.toThrow(/disconnect/);
    correlator.dispose();
  });

  it('fails a duplicate pending commandId without displacing the original correlation', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const original = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-duplicate', command: 'transport', params: { action: 'pause' } } });

    await expect(correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-duplicate', command: 'transport', params: { action: 'play' } } })).rejects.toThrow(/duplicate-commandId/);
    expect(ws.sendEphemeral).toHaveBeenCalledTimes(1);

    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'cmd-duplicate', ok: true });
    await expect(original).resolves.toMatchObject({ commandId: 'cmd-duplicate', ok: true });
    correlator.dispose();
  });

  it('does not resolve a handoff on a generic receipt and preserves the typed terminal result', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const command = { commandId: 'handoff-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'capture' } };
    const pending = correlator.send({ targetControlClientId: 'target', command });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'handoff-1', ok: true });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'handoff-1', ok: false, handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
    await expect(pending).resolves.toMatchObject({ ok: false, handoff: { phase: 'failed', code: 'HANDOFF_UNSUPPORTED' } });
    correlator.dispose();
  });

  it('ignores a typed started receipt bound to another client, owner, or snapshot', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const pending = correlator.send({ targetControlClientId: 'target', command: handoffStart });
    ws.ack(startedAck({ destination: { kind: 'client', id: 'other', ownerInstanceId: 'owner-other' }, identity: { ...receiptIdentity, ownerInstanceId: 'owner-other' }, snapshotFingerprint: 'wrong' }));
    ws.ack(startedAck());
    await expect(pending).resolves.toMatchObject({ handoff: { phase: 'started', receipt: { destination: { id: 'target', ownerInstanceId: 'owner-client' } } } });
    correlator.dispose();
  });

  it('ignores a route-bound browser receipt with the wrong current entry or live policy', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const pending = correlator.send({ targetControlClientId: 'target', command: handoffStart });
    ws.ack(startedAck({ identity: { ...receiptIdentity, contentId: 'plex:wrong', queueItemId: 'entry-wrong' }, liveEdge: true }));
    ws.ack(startedAck());
    await expect(pending).resolves.toMatchObject({ handoff: { receipt: { identity: { contentId: 'plex:a', queueItemId: 'entry-a' }, liveEdge: false } } });
    correlator.dispose();
  });

  it('ignores a status recovery receipt embedded for another browser but accepts the correlated route', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const pending = correlator.send({ targetControlClientId: 'target', command: handoffStatus });
    ws.ack({ ...startedAck({ destination: { kind: 'client', id: 'other', ownerInstanceId: 'owner-client' } }), commandId: 'handoff-status' });
    ws.ack({ ...startedAck(), commandId: 'handoff-status' });
    await expect(pending).resolves.toMatchObject({ handoff: { phase: 'started', receipt: { destination: { kind: 'client', id: 'target' } } } });
    correlator.dispose();
  });

  it('rejects malformed handoff before publishing or registering a timeout', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 10 });
    await expect(correlator.send({ targetControlClientId: 'target', command: { ...handoffStart, params: { version: 2, transferId: 'transfer-1', op: 'capture' } } })).rejects.toThrow('control-invalid-command');
    expect(ws.sendEphemeral).not.toHaveBeenCalled();
    correlator.dispose();
  });
});
