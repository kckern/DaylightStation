import { describe, expect, it, vi } from 'vitest';
import { validateHandoffResult } from '@shared-contracts/media/handoff.mjs';
import { fingerprintHandoffSnapshot } from '@shared-contracts/media/handoff.mjs';
import { createHandoffExecutor } from './handoffExecutor.js';

const sourceIdentity = { ownerInstanceId: 'source-owner', playbackRevision: 1, queueRevision: 1, sessionId: 'source-session', contentId: 'plex:a', queueItemId: 'entry-a' };
const destinationIdentity = { ownerInstanceId: 'destination-owner', playbackRevision: 1, queueRevision: 1, sessionId: 'destination-session', contentId: null, queueItemId: null };

function snapshot(identity, { state = 'playing', position = 4 } = {}) {
  return {
    sessionId: identity.sessionId, state, currentItem: identity.contentId ? { contentId: identity.contentId, format: 'video' } : null, position,
    queue: { items: identity.contentId ? [{ queueItemId: identity.queueItemId, contentId: identity.contentId, priority: 'queue' }] : [], currentIndex: identity.contentId ? 0 : -1, upNextCount: 0, executionOrder: identity.contentId ? [identity.queueItemId] : [] },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
    meta: { ownerId: identity.ownerInstanceId, updatedAt: '2026-09-14T00:00:00.000Z', playbackOwner: identity },
  };
}

function capture(identity, options = {}) {
  return { snapshot: snapshot(identity, options), identity, capabilities: { handoffV1: true, seekable: true, liveEdge: false } };
}

function acceptedBinding({ operationId, node, resolvedGeneration = 3, token, targetSeconds = 4 } = {}) {
  return { operationId, node, resolvedGeneration, rendererToken: token, targetSeconds };
}

function ownerHarness({ initial = capture(destinationIdentity, { state: 'idle' }), native = null } = {}) {
  let currentCapture = initial;
  let currentNative = native;
  const listeners = new Set();
  const boundaryListeners = new Set();
  const boundaryBindings = new Map();
  const owner = {
    capture: vi.fn(() => structuredClone(currentCapture)),
    getNativeObservation: vi.fn(() => currentNative),
    subscribeNative: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener); }),
    getHandoffBoundaryBinding: vi.fn((operationId) => boundaryBindings.get(operationId) ?? null),
    subscribeHandoffBoundaryBinding: vi.fn((listener) => { boundaryListeners.add(listener); return () => boundaryListeners.delete(listener); }),
    adoptAndBeginHandoffStart: vi.fn((request) => ({ ok: true, operationId: request.operationId })),
    alignHandoffStart: vi.fn((request) => ({ ok: true, operationId: request.operationId })),
    cancelHandoffStart: vi.fn(() => ({ ok: true })),
    stopIfCurrent: vi.fn(() => ({ ok: true })),
  };
  return {
    owner,
    setCapture(value) { currentCapture = value; },
    setBoundaryBinding(value) {
      boundaryBindings.set(value.operationId, value);
      for (const listener of [...boundaryListeners]) listener(value);
    },
    emit(value) { currentNative = value; for (const listener of [...listeners]) listener(value); },
    listenerCount: () => listeners.size,
    boundaryListenerCount: () => boundaryListeners.size,
  };
}

function timers() {
  const entries = [];
  return {
    setTimer(callback, ms) { const timer = { callback, ms, cleared: false }; entries.push(timer); return timer; },
    clearTimer(timer) { timer.cleared = true; },
    entries,
  };
}

function startParams() {
  return { version: 1, transferId: 'transfer-1', op: 'start', snapshot: snapshot(sourceIdentity), expectedDestination: destinationIdentity, positionPolicy: { kind: 'absolute', seconds: 4 } };
}

function startedObservation({ token = {}, node = {}, nodeGeneration = 2, currentTime = 4, playingObserved = true, advancedObserved = true, targetSeekedObserved = false, identity = { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }, operationId = 'transfer-1:start', resolvedGeneration = 2 } = {}) {
  return { node, nodeGeneration, resolvedContentId: 'plex:a', resolvedGeneration, identity, currentTime, readyState: 2, paused: false, seeking: false, ended: false, error: null, playingObserved, advancedObserved, targetSeekedObserved, operationId, rendererToken: token };
}

function pausedObservation(options = {}) {
  return { ...startedObservation(options), paused: true, playingObserved: false, advancedObserved: false };
}

describe('handoffExecutor', () => {
  it('adopts a paused source and returns started only after exact operation-bound paused native proof', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const token = Object.freeze({ tokenId: 'paused-token' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }, { state: 'paused', position: 4 }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const params = { ...startParams(), snapshot: snapshot(sourceIdentity, { state: 'paused', position: 4 }) };

    const pending = executor.execute({ commandId: 'paused-start', params });
    harness.emit(pausedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));

    await expect(pending).resolves.toMatchObject({ ok: true, handoff: { phase: 'started', receipt: { actualPosition: 4 } } });
    expect(harness.owner.adoptAndBeginHandoffStart).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ state: 'paused', position: 4 }),
      targetSeconds: 4,
    }));
  });
  it('captures a detached, schema-valid owner state without playback mutation', async () => {
    const harness = ownerHarness({ initial: capture(sourceIdentity) });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });

    const result = await executor.execute({ commandId: 'capture-1', params: { version: 1, transferId: 'transfer-1', op: 'capture' } });
    expect(result.commandId).toBe('capture-1');
    expect(validateHandoffResult(result.handoff).valid).toBe(true);
    expect(result.handoff.capture).not.toBe(harness.owner.capture.mock.results[0].value);
    expect(harness.owner.adoptAndBeginHandoffStart).not.toHaveBeenCalled();
    expect(harness.owner.stopIfCurrent).not.toHaveBeenCalled();
  });

  it('requires a fresh operation-bound native observation before returning started', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const token = Object.freeze({ tokenId: 'token-1' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer, receiptId: () => 'receipt-1' });

    const pending = executor.execute({ commandId: 'start-1', params: startParams() });
    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
    const result = await pending;
    expect(result).toMatchObject({ ok: true, commandId: 'start-1', handoff: { phase: 'started', receipt: { transferId: 'transfer-1', destination: { kind: 'device', id: 'tv-a' }, actualPosition: 4 } } });
    expect(validateHandoffResult(result.handoff).valid).toBe(true);
  });

  it('ignores a wrong first frozen token until the owner-authorized boundary binding arrives', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const wrongToken = Object.freeze({ tokenId: 'wrong-token' });
    const realToken = Object.freeze({ tokenId: 'real-token' });
    const wrongNode = {};
    const realNode = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.emit(startedObservation({ node: wrongNode, token: wrongToken, currentTime: 3, targetSeekedObserved: true }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: realNode, token: realToken }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    harness.emit(startedObservation({ node: realNode, token: realToken, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
    clock.entries[0].callback();
    await expect(pending).resolves.toMatchObject({ ok: true, handoff: { phase: 'started' } });
  });

  it('rejects a stale reused operation observation below its new physical baseline', async () => {
    let clockNow = 0;
    const harness = ownerHarness();
    const oldToken = Object.freeze({ tokenId: 'old-token' });
    const oldNode = {};
    const newToken = Object.freeze({ tokenId: 'new-token' });
    const newNode = {};
    let attempt = 0;
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      attempt += 1;
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      if (attempt === 1) {
        harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: oldNode, token: oldToken, resolvedGeneration: 3 }));
      } else {
        harness.emit(startedObservation({ node: oldNode, token: oldToken, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
        harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: newNode, token: newToken, resolvedGeneration: 4 }));
      }
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, now: () => clockNow, terminalTtlMs: 1 });
    const params = startParams();
    const first = executor.execute({ commandId: 'start-old', params });
    harness.emit(startedObservation({ node: oldNode, token: oldToken, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
    await first;

    clockNow = 2;
    await executor.execute({ commandId: 'other-capture', params: { version: 1, transferId: 'other-transfer', op: 'capture' } });
    harness.setCapture(capture(destinationIdentity, { state: 'idle' }));
    const reused = executor.execute({ commandId: 'start-reused', params });
    harness.emit(startedObservation({ node: newNode, token: newToken, nodeGeneration: 4, resolvedGeneration: 4, currentTime: 4.2, targetSeekedObserved: true }));

    await expect(reused).resolves.toMatchObject({ handoff: { phase: 'started', receipt: { actualPosition: 4.2 } } });
  });

  it('snapshots the pre-operation native baseline before an adapter can mutate it', async () => {
    const baselineNode = {};
    const mutableBaseline = { node: baselineNode, nodeGeneration: 8, resolvedGeneration: 8 };
    const harness = ownerHarness({ native: mutableBaseline });
    const clock = timers();
    const token = Object.freeze({ tokenId: 'too-old' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      mutableBaseline.nodeGeneration = 0;
      mutableBaseline.resolvedGeneration = 0;
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token, resolvedGeneration: 1 }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });
    harness.emit(startedObservation({ node, token, nodeGeneration: 1, resolvedGeneration: 1, targetSeekedObserved: true }));
    clock.entries[0].callback();

    await expect(pending).resolves.toMatchObject({ ok: false, handoff: { code: 'START_TIMEOUT' } });
  });

  it('keeps receipt fingerprint immutable when caller and atomic adapter mutate their input copies', async () => {
    const harness = ownerHarness();
    const params = startParams();
    const originalFingerprint = fingerprintHandoffSnapshot(params.snapshot);
    const token = Object.freeze({ tokenId: 'real-token' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      expect(request.snapshot).not.toBe(params.snapshot);
      request.snapshot.config.repeat = 'all';
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const pending = executor.execute({ commandId: 'start-1', params });
    params.snapshot.config.repeat = 'one';
    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));

    await expect(pending).resolves.toMatchObject({
      handoff: { phase: 'started', receipt: { snapshotFingerprint: originalFingerprint } },
    });
    expect(params.snapshot.config.repeat).toBe('one');
  });

  it('retains the complete validated start input when the caller mutates target and expected identity', async () => {
    const harness = ownerHarness();
    const params = startParams();
    const token = Object.freeze({ tokenId: 'real-token' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      expect(request.targetSeconds).toBe(4);
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token, targetSeconds: 4 }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const pending = executor.execute({ commandId: 'start-1', params });
    params.positionPolicy.seconds = 9;
    params.expectedDestination = { ...params.expectedDestination, playbackRevision: 99 };
    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true, currentTime: 4 }));

    await expect(pending).resolves.toMatchObject({ ok: true, handoff: { phase: 'started', receipt: { actualPosition: 4 } } });
  });

  it('ignores a pre-begin cached binding and cleans synchronous accepted subscriptions and timer', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const staleToken = Object.freeze({ tokenId: 'cached' });
    const token = Object.freeze({ tokenId: 'accepted' });
    const staleNode = {};
    const node = {};
    let boundaryListener;
    const nativeUnsubscribe = vi.fn();
    const boundaryUnsubscribe = vi.fn();
    harness.owner.subscribeNative.mockImplementation((listener) => {
      harness.nativeListener = listener;
      return nativeUnsubscribe;
    });
    harness.owner.subscribeHandoffBoundaryBinding.mockImplementation((listener) => {
      boundaryListener = listener;
      listener(acceptedBinding({ operationId: 'transfer-1:start', node: staleNode, token: staleToken }));
      return boundaryUnsubscribe;
    });
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.nativeListener(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
      boundaryListener(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    await expect(executor.execute({ commandId: 'start-1', params: startParams() })).resolves.toMatchObject({ ok: true, handoff: { phase: 'started' } });
    expect(nativeUnsubscribe).toHaveBeenCalledOnce();
    expect(boundaryUnsubscribe).toHaveBeenCalledOnce();
    expect(clock.entries).toHaveLength(1);
    expect(clock.entries[0].cleared).toBe(true);
  });

  it('replays an identical same-operation result with the new caller commandId', async () => {
    const harness = ownerHarness({ initial: capture(sourceIdentity) });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const params = { version: 1, transferId: 'transfer-1', op: 'capture' };

    await expect(executor.execute({ commandId: 'capture-old', params })).resolves.toMatchObject({ commandId: 'capture-old', handoff: { phase: 'captured' } });
    await expect(executor.execute({ commandId: 'capture-new', params })).resolves.toMatchObject({ commandId: 'capture-new', handoff: { phase: 'captured' } });
    expect(harness.owner.capture).toHaveBeenCalledOnce();
  });

  it('replays a completed start receipt with the retry caller commandId', async () => {
    const harness = ownerHarness();
    const token = Object.freeze({ tokenId: 'token-1' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const params = startParams();
    const first = executor.execute({ commandId: 'start-old', params });
    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));

    await expect(first).resolves.toMatchObject({ commandId: 'start-old', handoff: { phase: 'started' } });
    await expect(executor.execute({ commandId: 'start-new', params })).resolves.toMatchObject({ commandId: 'start-new', handoff: { phase: 'started' } });
    expect(harness.owner.adoptAndBeginHandoffStart).toHaveBeenCalledOnce();
  });

  it('uses one no-readopt fresh boundary for the first guarded align', async () => {
    const afterStart = { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' };
    const afterAlign = { ...afterStart, playbackRevision: 3 };
    const harness = ownerHarness();
    const startToken = Object.freeze({ tokenId: 'start-token' });
    const startNode = {};
    const alignToken = Object.freeze({ tokenId: 'align-token' });
    const alignNode = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture(afterStart));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: startNode, token: startToken }));
      return { ok: true, operationId: request.operationId };
    });
    harness.owner.alignHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture(afterAlign));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: alignNode, token: alignToken, resolvedGeneration: 4, targetSeconds: 5 }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const initial = executor.execute({ commandId: 'start-1', params: startParams() });
    harness.emit(startedObservation({ node: startNode, token: startToken, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true, identity: afterStart }));
    await initial;

    const aligned = executor.execute({ commandId: 'align-1', params: { version: 1, transferId: 'transfer-1', op: 'align', expectedDestination: afterStart, positionPolicy: { kind: 'absolute', seconds: 5 } } });
    harness.emit(startedObservation({ node: alignNode, token: alignToken, nodeGeneration: 4, resolvedGeneration: 4, targetSeekedObserved: true, currentTime: 5, identity: afterAlign, operationId: 'transfer-1:align' }));
    await expect(aligned).resolves.toMatchObject({ ok: true, handoff: { phase: 'started' } });
    expect(harness.owner.adoptAndBeginHandoffStart).toHaveBeenCalledOnce();
    expect(harness.owner.alignHandoffStart).toHaveBeenCalledOnce();
  });

  it('fails closed on an observation missing the operation token and cleans up at deadline', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const pending = executor.execute({ commandId: 'start-1', params: startParams() });
    harness.emit({ ...startedObservation(), rendererToken: null });
    expect(harness.listenerCount()).toBe(1);
    clock.entries[0].callback();
    await expect(pending).resolves.toMatchObject({ ok: false, handoff: { phase: 'failed', code: 'START_TIMEOUT' } });
    expect(harness.listenerCount()).toBe(0);
  });

  it('requires target seek evidence before starting a positive absolute position', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const token = Object.freeze({ tokenId: 'token-1' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: false }));
    clock.entries[0].callback();
    await expect(pending).resolves.toMatchObject({ ok: false, handoff: { code: 'START_TIMEOUT' } });
  });

  it('rejects a destination without handoff capability before adopting', async () => {
    const unsupported = capture(destinationIdentity, { state: 'idle' });
    unsupported.capabilities.handoffV1 = false;
    const harness = ownerHarness({ initial: unsupported });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });

    await expect(executor.execute({ commandId: 'start-unsupported', params: startParams() })).resolves.toMatchObject({
      ok: false,
      handoff: { phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    });
    expect(harness.owner.adoptAndBeginHandoffStart).not.toHaveBeenCalled();
    expect(harness.listenerCount()).toBe(0);
  });

  it('uses actual native source position, not stored snapshot position, before guarded stop', async () => {
    const source = capture(sourceIdentity, { position: 0 });
    const native = { identity: sourceIdentity, currentTime: 5 };
    const harness = ownerHarness({ initial: source, native });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'source-tv' } });
    const receipt = { transferId: 'transfer-1', phase: 'started', destination: { kind: 'device', id: 'tv-a', ownerInstanceId: 'destination-owner' }, identity: { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }, snapshotFingerprint: fingerprintHandoffSnapshot(source.snapshot), actualPosition: 4, liveEdge: false, receiptId: 'receipt-1' };

    const result = await executor.execute({ commandId: 'commit-1', params: { version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: sourceIdentity, destinationReceipt: receipt } });
    expect(result).toMatchObject({ ok: true, handoff: { phase: 'stopped' } });
    expect(harness.owner.stopIfCurrent).toHaveBeenCalledWith(sourceIdentity);
  });

  it('returns a schema-valid fresh capture and does not stop when actual source position moved beyond two seconds', async () => {
    const source = capture(sourceIdentity, { position: 0 });
    const harness = ownerHarness({ initial: source, native: { identity: sourceIdentity, currentTime: 8 } });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'source-tv' } });
    const receipt = { transferId: 'transfer-1', phase: 'started', destination: { kind: 'device', id: 'tv-a', ownerInstanceId: 'destination-owner' }, identity: { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }, snapshotFingerprint: fingerprintHandoffSnapshot(source.snapshot), actualPosition: 4, liveEdge: false, receiptId: 'receipt-1' };

    const result = await executor.execute({ commandId: 'commit-1', params: { version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: sourceIdentity, destinationReceipt: receipt } });
    expect(result).toMatchObject({ ok: false, handoff: { phase: 'failed', code: 'POSITION_MOVED' } });
    expect(validateHandoffResult({ transferId: 'transfer-1', phase: 'captured', capture: result.freshCapture }).valid).toBe(true);
    expect(harness.owner.stopIfCurrent).not.toHaveBeenCalled();
  });

  it('tombstones a cancelled transfer before a delayed valid commit-stop can mutate its source', async () => {
    const source = capture(sourceIdentity, { position: 0 });
    const harness = ownerHarness({ initial: source, native: { identity: sourceIdentity, currentTime: 4 } });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'source-tv' } });
    const receipt = {
      transferId: 'transfer-1', phase: 'started',
      destination: { kind: 'device', id: 'tv-a', ownerInstanceId: 'destination-owner' },
      identity: { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' },
      snapshotFingerprint: fingerprintHandoffSnapshot(source.snapshot), actualPosition: 4, liveEdge: false, receiptId: 'receipt-1',
    };

    await expect(executor.execute({ commandId: 'capture-1', params: { version: 1, transferId: 'transfer-1', op: 'capture' } })).resolves.toMatchObject({ handoff: { phase: 'captured' } });
    await expect(executor.execute({ commandId: 'cancel-1', params: { version: 1, transferId: 'transfer-1', op: 'cancel', expected: sourceIdentity } })).resolves.toMatchObject({ handoff: { phase: 'cancelled' } });
    await expect(executor.execute({ commandId: 'commit-late', params: { version: 1, transferId: 'transfer-1', op: 'commit-stop', expected: sourceIdentity, destinationReceipt: receipt } })).resolves.toMatchObject({ ok: false, handoff: { code: 'CANCELLED' } });
    expect(harness.owner.stopIfCurrent).not.toHaveBeenCalled();
    await expect(executor.execute({ commandId: 'status-after-cancel', params: { version: 1, transferId: 'transfer-1', op: 'status' } })).resolves.toMatchObject({ ok: true, handoff: { phase: 'cancelled' } });
  });

  it('tombstones a cancelled start and disposal clears its pending resources', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });
    await expect(executor.execute({ commandId: 'cancel-1', params: { version: 1, transferId: 'transfer-1', op: 'cancel', expected: destinationIdentity } })).resolves.toMatchObject({ handoff: { phase: 'cancelled' } });
    harness.emit(startedObservation({ token: Object.freeze({ tokenId: 'late' }) }));
    await expect(pending).resolves.toMatchObject({ ok: false, handoff: { phase: 'failed', code: 'CANCELLED' } });
    executor.dispose();
    expect(harness.listenerCount()).toBe(0);
    expect(clock.entries.every((timer) => timer.cleared)).toBe(true);
  });

  it('cancels an active align by its exact operation id and ignores its later proof', async () => {
    const afterStart = { ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' };
    const harness = ownerHarness();
    const startToken = Object.freeze({ tokenId: 'start-token' });
    const startNode = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture(afterStart));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node: startNode, token: startToken }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const started = executor.execute({ commandId: 'start-1', params: startParams() });
    harness.emit(startedObservation({ node: startNode, token: startToken, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true, identity: afterStart }));
    await started;

    const aligned = executor.execute({ commandId: 'align-1', params: { version: 1, transferId: 'transfer-1', op: 'align', expectedDestination: afterStart, positionPolicy: { kind: 'absolute', seconds: 5 } } });
    const cancelled = await executor.execute({ commandId: 'cancel-1', params: { version: 1, transferId: 'transfer-1', op: 'cancel', expected: afterStart } });
    expect(cancelled).toMatchObject({ ok: true, handoff: { phase: 'cancelled' } });
    expect(harness.owner.cancelHandoffStart).toHaveBeenCalledWith('transfer-1:align');
    await expect(aligned).resolves.toMatchObject({ ok: false, handoff: { code: 'CANCELLED' } });
    harness.emit(startedObservation({ operationId: 'transfer-1:align', currentTime: 5, targetSeekedObserved: true }));
  });

  it('rejects stale expected cancellation without touching the active owner operation', async () => {
    const harness = ownerHarness();
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    await expect(executor.execute({ commandId: 'cancel-stale', params: { version: 1, transferId: 'transfer-1', op: 'cancel', expected: { ...destinationIdentity, playbackRevision: 9 } } })).resolves.toMatchObject({ ok: false, handoff: { code: 'SOURCE_CHANGED' } });
    expect(harness.owner.cancelHandoffStart).not.toHaveBeenCalled();
    executor.dispose();
    await pending;
  });

  it.each([
    ['returns false', () => ({ ok: false, code: 'CANCEL_REJECTED' })],
    ['throws', () => { throw new Error('cancel transport broke'); }],
  ])('does not claim cancelled when the owner cancellation %s', async (_label, cancel) => {
    const harness = ownerHarness();
    harness.owner.cancelHandoffStart.mockImplementation(cancel);
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' } });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    await expect(executor.execute({ commandId: 'cancel-1', params: { version: 1, transferId: 'transfer-1', op: 'cancel', expected: destinationIdentity } })).resolves.toMatchObject({ ok: false, handoff: { code: 'CANCEL_REJECTED' } });
    expect(harness.owner.cancelHandoffStart).toHaveBeenCalledWith('transfer-1:start');
    executor.dispose();
    await pending;
  });

  it('never evicts a live operation when its bounded record table is full', async () => {
    const harness = ownerHarness();
    const clock = timers();
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, setTimer: clock.setTimer, clearTimer: clock.clearTimer, maxRecords: 1 });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    await expect(executor.execute({ commandId: 'capture-2', params: { version: 1, transferId: 'transfer-2', op: 'capture' } })).resolves.toMatchObject({ ok: false, handoff: { code: 'HANDOFF_CAPACITY' } });
    expect(harness.listenerCount()).toBe(1);
    executor.dispose();
    await expect(pending).resolves.toMatchObject({ handoff: { code: 'EXECUTOR_DISPOSED' } });
  });

  it('reports a completed start from status after an earlier status observed starting', async () => {
    const harness = ownerHarness();
    const token = Object.freeze({ tokenId: 'token-1' });
    const node = {};
    harness.owner.adoptAndBeginHandoffStart.mockImplementation((request) => {
      harness.setCapture(capture({ ...destinationIdentity, playbackRevision: 2, contentId: 'plex:a', queueItemId: 'entry-a' }));
      harness.setBoundaryBinding(acceptedBinding({ operationId: request.operationId, node, token }));
      return { ok: true, operationId: request.operationId };
    });
    const executor = createHandoffExecutor({ owner: harness.owner, destination: { kind: 'device', id: 'tv-a' }, receiptId: () => 'receipt-1' });
    const pending = executor.execute({ commandId: 'start-1', params: startParams() });

    await expect(executor.execute({ commandId: 'status-pending', params: { version: 1, transferId: 'transfer-1', op: 'status' } })).resolves.toMatchObject({ handoff: { phase: 'starting' } });
    harness.emit(startedObservation({ node, token, nodeGeneration: 3, resolvedGeneration: 3, targetSeekedObserved: true }));
    await pending;
    await expect(executor.execute({ commandId: 'status-complete', params: { version: 1, transferId: 'transfer-1', op: 'status' } })).resolves.toMatchObject({ handoff: { phase: 'started' } });
  });
});
