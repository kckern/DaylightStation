import { describe, expect, it } from 'vitest';
import { createIdleSessionSnapshot } from './shapes.mjs';
import {
  validateHandoffParams,
  validateHandoffResult,
  validateHandoffCommandAck,
  fingerprintHandoffSnapshot,
} from './handoff.mjs';

const identity = {
  ownerInstanceId: 'owner-1', playbackRevision: 2, queueRevision: 4,
  sessionId: 'session-1', contentId: null, queueItemId: null,
};
const snapshot = createIdleSessionSnapshot({ sessionId: 'session-1', ownerId: 'screen-1' });
const destinationIdentity = { ...identity, ownerInstanceId: 'owner-2' };
const destinationReceipt = {
  transferId: 'transfer-1', phase: 'started',
  destination: { kind: 'device', id: 'screen-2', ownerInstanceId: 'owner-2' },
  identity: destinationIdentity, snapshotFingerprint: fingerprintHandoffSnapshot(snapshot), actualPosition: 12,
  liveEdge: false, receiptId: 'receipt-1',
};

describe('handoff v1 contract', () => {
  it('accepts versioned capture/start/align/status/cancel/commit-stop fields without mutating a detached snapshot', () => {
    const before = structuredClone(snapshot);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'capture' }).valid).toBe(true);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'start', snapshot, expectedDestination: identity, positionPolicy: { kind: 'absolute', seconds: 12 } }).valid).toBe(true);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'align', expectedDestination: identity, positionPolicy: { kind: 'live-edge' } }).valid).toBe(true);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'status' }).valid).toBe(true);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'cancel', expected: identity }).valid).toBe(true);
    expect(validateHandoffParams({ version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: identity, destinationReceipt }).valid).toBe(true);
    expect(snapshot).toEqual(before);
  });

  it.each([
    ['unknown version', { version: 2, transferId: 'transfer-1', op: 'capture' }],
    ['unknown operation', { version: 1, transferId: 'transfer-1', op: 'teleport' }],
    ['start without snapshot', { version: 1, transferId: 'transfer-1', op: 'start', expectedDestination: identity, positionPolicy: { kind: 'live-edge' } }],
    ['commit without bound receipt', { version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: identity }],
    ['mismatched receipt transfer', { version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: identity, destinationReceipt: { ...destinationReceipt, transferId: 'other' } }],
    ['extra field', { version: 1, transferId: 'transfer-1', op: 'capture', nativeStarted: true }],
  ])('rejects %s', (_label, params) => {
    expect(validateHandoffParams(params).valid).toBe(false);
  });

  it('requires operation-appropriate typed terminal results rather than generic transport success', () => {
    const command = { commandId: 'command-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'start', snapshot, expectedDestination: destinationIdentity, positionPolicy: { kind: 'absolute', seconds: 12 } } };
    const started = { deviceId: 'screen-2', commandId: 'command-1', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: destinationReceipt } };
    expect(validateHandoffResult(started.handoff).valid).toBe(true);
    expect(validateHandoffCommandAck(command, started, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(true);
    expect(validateHandoffCommandAck(command, { deviceId: 'screen-2', commandId: 'command-1', ok: true }, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
    expect(validateHandoffCommandAck(command, { ...started, handoff: { ...started.handoff, transferId: 'other' } }, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
    expect(validateHandoffCommandAck(command, { ...started, commandId: 'other' }, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
    expect(validateHandoffCommandAck(command, { ...started, handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' }, ok: true }, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
  });

  it('rejects a captured result whose owner identity is not bound to its snapshot', () => {
    const ownerSnapshot = structuredClone(snapshot);
    ownerSnapshot.meta.playbackOwner = identity;
    expect(validateHandoffResult({
      transferId: 'transfer-1', phase: 'captured',
      capture: { snapshot: ownerSnapshot, identity: { ...identity, playbackRevision: 3 }, capabilities: { handoffV1: true, seekable: true, liveEdge: false } },
    }).valid).toBe(false);
  });

  it('binds an align receipt media identity and live policy to its expected destination', () => {
    const expectedDestination = { ...destinationIdentity, contentId: 'plex:a', queueItemId: 'entry-a' };
    const command = { commandId: 'align-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'align', expectedDestination, positionPolicy: { kind: 'live-edge' } } };
    const ack = { deviceId: 'screen-2', commandId: 'align-1', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: { ...destinationReceipt, identity: { ...expectedDestination, contentId: 'plex:wrong', queueItemId: 'entry-wrong' }, liveEdge: false } } };
    expect(validateHandoffCommandAck(command, ack, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
  });

  it('binds a status started receipt to the correlated target route', () => {
    const command = { commandId: 'status-1', command: 'handoff', params: { version: 1, transferId: 'transfer-1', op: 'status' } };
    const ack = { deviceId: 'screen-2', commandId: 'status-1', ok: true, handoff: { transferId: 'transfer-1', phase: 'started', receipt: destinationReceipt } };
    expect(validateHandoffCommandAck(command, { ...ack, handoff: { ...ack.handoff, receipt: { ...destinationReceipt, destination: { ...destinationReceipt.destination, id: 'screen-wrong' } } } }, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(false);
    expect(validateHandoffCommandAck(command, ack, { target: { kind: 'device', id: 'screen-2' } }).valid).toBe(true);
  });
});
