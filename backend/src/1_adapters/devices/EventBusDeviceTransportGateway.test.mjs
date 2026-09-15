import { describe, expect, it, vi } from 'vitest';
import { EventBusDeviceTransportGateway } from './EventBusDeviceTransportGateway.mjs';
const expectedDestination = { ownerInstanceId: 'owner-tv', playbackRevision: 1, queueRevision: 2, sessionId: 'destination-session', contentId: null, queueItemId: null };
const receiptIdentity = { ...expectedDestination, playbackRevision: 2, queueRevision: 3, contentId: 'plex:a', queueItemId: 'entry-a' };
const startSnapshot = { sessionId: 'source-session', state: 'paused', currentItem: { contentId: 'plex:a', format: 'video' }, position: 4, queue: { items: [{ queueItemId: 'entry-a', contentId: 'plex:a', priority: 'queue' }], currentIndex: 0, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 }, meta: { ownerId: 'source', updatedAt: '2026-09-14T00:00:00.000Z' } };
const startFingerprint = 'handoff-v1:{"sessionId":"source-session","queue":{"items":[{"queueItemId":"entry-a","contentId":"plex:a","priority":"queue"}],"currentIndex":0,"executionOrder":["entry-a"]},"currentItem":{"contentId":"plex:a","format":"video"},"config":{"shuffle":false,"repeat":"off","shader":null,"volume":50,"playbackRate":1}}';
const startCommand = () => ({ targetDevice: 'tv-a', command: 'handoff', commandId: 'start-1', params: { version: 1, transferId: 'transfer-1', op: 'start', snapshot: startSnapshot, expectedDestination, positionPolicy: { kind: 'absolute', seconds: 4 } } });
const statusCommand = () => ({ targetDevice: 'tv-a', command: 'handoff', commandId: 'status-1', params: { version: 1, transferId: 'transfer-1', op: 'status' } });
const startedAck = (command, overrides = {}) => ({ deviceId: 'tv-a', commandId: command.commandId, ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: { transferId: 'transfer-1', phase: 'started', destination: { kind: 'device', id: 'tv-a', ownerInstanceId: 'owner-tv' }, identity: receiptIdentity, snapshotFingerprint: startFingerprint, actualPosition: 4, liveEdge: false, receiptId: 'receipt-1', ...overrides } } });

describe('EventBusDeviceTransportGateway', () => {
  it('arms correlation before publishing and resolves only the matching ack', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((predicate, handler) => {
        subscription = { predicate, handler };
        return vi.fn();
      }),
      broadcast: vi.fn((topic, command) => {
        expect(subscription.predicate('device-ack:tv')).toBe(true);
        subscription.handler({ commandId: 'other', ok: true });
        subscription.handler({ commandId: command.commandId, ok: true, appliedAt: 'now' });
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand({ targetDevice: 'tv', command: 'transport', commandId: 'cmd-1', params: { action: 'pause' } });

    await expect(gateway.sendCommand('tv', command)).resolves.toEqual({
      ok: true, commandId: 'cmd-1', appliedAt: 'now',
    });
    expect(eventBus.subscribePattern.mock.invocationCallOrder[0])
      .toBeLessThan(eventBus.broadcast.mock.invocationCallOrder[0]);
    expect(eventBus.broadcast).toHaveBeenCalledWith('screen:tv', command);
  });

  it('owns acknowledgement timeout settlement and cleanup', async () => {
    let timeout;
    const unsubscribe = vi.fn();
    const eventBus = {
      subscribePattern: vi.fn(() => unsubscribe),
      broadcast: vi.fn(),
    };
    const gateway = new EventBusDeviceTransportGateway({
      eventBus,
      setTimer: (callback, ms) => { timeout = { callback, ms }; return 7; },
      clearTimer: vi.fn(),
    });
    const command = gateway.buildCommand({ targetDevice: 'tv', command: 'transport', commandId: 'cmd-2', params: { action: 'pause' } });
    const result = gateway.sendCommand('tv', command, { timeoutMs: 1234 });
    expect(timeout.ms).toBe(1234);
    timeout.callback();
    await expect(result).resolves.toMatchObject({ ok: false, commandId: 'cmd-2', error: 'Timeout waiting for ack' });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not let a generic receipt satisfy a handoff command, but projects its typed failure', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((_predicate, handler) => { subscription = handler; return vi.fn(); }),
      broadcast: vi.fn((_topic, command) => {
        subscription({ commandId: command.commandId, ok: true });
        subscription({ commandId: command.commandId, ok: false, code: 'HANDOFF_UNSUPPORTED', handoff: {
          transferId: command.params.transferId, phase: 'failed', code: 'HANDOFF_UNSUPPORTED',
        } });
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand({ targetDevice: 'tv', command: 'handoff', commandId: 'handoff-1', params: { version: 1, transferId: 'transfer-1', op: 'capture' } });
    await expect(gateway.sendCommand('tv', command)).resolves.toMatchObject({
      ok: false, commandId: 'handoff-1', code: 'HANDOFF_UNSUPPORTED',
      handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    });
  });

  it('ignores a started receipt bound to a wrong device, owner, or snapshot fingerprint', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((_predicate, handler) => { subscription = handler; return vi.fn(); }),
      broadcast: vi.fn((_topic, command) => {
        subscription(startedAck(command, { destination: { kind: 'device', id: 'tv-wrong', ownerInstanceId: 'owner-wrong' }, identity: { ...receiptIdentity, ownerInstanceId: 'owner-wrong' }, snapshotFingerprint: 'wrong' }));
        subscription(startedAck(command));
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand(startCommand());
    await expect(gateway.sendCommand('tv-a', command)).resolves.toMatchObject({ ok: true, handoff: { phase: 'started', receipt: { destination: { id: 'tv-a', ownerInstanceId: 'owner-tv' } } } });
  });

  it('ignores a route-bound receipt with the wrong current queue identity or live mode', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((_predicate, handler) => { subscription = handler; return vi.fn(); }),
      broadcast: vi.fn((_topic, command) => {
        subscription(startedAck(command, { identity: { ...receiptIdentity, contentId: 'plex:wrong', queueItemId: 'entry-wrong' }, liveEdge: true }));
        subscription(startedAck(command));
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand(startCommand());
    await expect(gateway.sendCommand('tv-a', command)).resolves.toMatchObject({ handoff: { receipt: { identity: { contentId: 'plex:a', queueItemId: 'entry-a' }, liveEdge: false } } });
  });

  it('ignores a status recovery receipt embedded for another device but accepts the correlated route', async () => {
    let subscription;
    const eventBus = {
      subscribePattern: vi.fn((_predicate, handler) => { subscription = handler; return vi.fn(); }),
      broadcast: vi.fn((_topic, command) => {
        subscription(startedAck(command, { destination: { kind: 'device', id: 'tv-wrong', ownerInstanceId: 'owner-tv' } }));
        subscription(startedAck(command));
      }),
    };
    const gateway = new EventBusDeviceTransportGateway({ eventBus });
    const command = gateway.buildCommand(statusCommand());
    await expect(gateway.sendCommand('tv-a', command)).resolves.toMatchObject({ handoff: { receipt: { destination: { kind: 'device', id: 'tv-a' } } } });
  });

  it('refuses malformed handoff before subscribing, timing, or publishing it', async () => {
    const eventBus = { subscribePattern: vi.fn(), broadcast: vi.fn() };
    const setTimer = vi.fn((callback) => { callback(); return 1; });
    const gateway = new EventBusDeviceTransportGateway({ eventBus, setTimer });
    await expect(gateway.sendCommand('tv-a', { ...startCommand(), params: { version: 2, transferId: 'transfer-1', op: 'capture' } })).resolves.toMatchObject({ ok: false, code: 'INVALID_ENVELOPE' });
    expect(eventBus.subscribePattern).not.toHaveBeenCalled();
    expect(eventBus.broadcast).not.toHaveBeenCalled();
    expect(setTimer).not.toHaveBeenCalled();
  });
});
