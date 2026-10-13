import {
  fingerprintHandoffSnapshot,
  validateHandoffParams,
  validateHandoffResult,
} from '@shared-contracts/media/handoff.mjs';
import { samePlaybackOwnerIdentity } from '@shared-contracts/media/playback-owner.mjs';

const TERMINAL_TTL_MS = 60_000;
const START_DEADLINE_MS = 30_000;
const MAX_RECORDS = 32;
const SOURCE_POSITION_TOLERANCE_SECONDS = 2;

const clone = (value) => structuredClone(value);
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const isObject = (value) => value !== null && typeof value === 'object';
const failed = (transferId, code, extras = {}) => ({ ok: false, handoff: { transferId, phase: 'failed', code }, ...extras });
const terminal = (transferId, phase, extras = {}) => ({ ok: true, handoff: { transferId, phase, ...extras } });

function captureIsValid(capture) {
  return validateHandoffResult({ transferId: 'capture-check', phase: 'captured', capture }).valid;
}

export function createHandoffExecutor({
  owner,
  destination,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  startDeadlineMs = START_DEADLINE_MS,
  terminalTtlMs = TERMINAL_TTL_MS,
  maxRecords = MAX_RECORDS,
  receiptId = () => globalThis.crypto?.randomUUID?.() ?? `receipt-${now()}`,
  positionToleranceSeconds = 0.5,
} = {}) {
  if (!owner || !destination?.kind || !destination?.id) throw new TypeError('owner and destination are required');
  const records = new Map();
  let disposed = false;

  const wrap = (inner, commandId) => ({ ...inner, commandId });
  const readCapture = () => {
    try {
      const value = owner.capture?.();
      return captureIsValid(value) ? clone(value) : null;
    } catch { return null; }
  };
  const currentIdentity = () => readCapture()?.identity ?? null;
  const bindingCurrent = (binding) => binding && samePlaybackOwnerIdentity(binding, currentIdentity());
  const evict = () => {
    const cutoff = now() - terminalTtlMs;
    for (const [transferId, record] of records) {
      if (!record.live && record.completedAt <= cutoff) records.delete(transferId);
    }
  };
  const reserve = (transferId) => {
    evict();
    let record = records.get(transferId);
    if (record) return record;
    if (records.size >= maxRecords) return null;
    record = { operations: new Map(), live: false, completedAt: now(), tombstone: false };
    records.set(transferId, record);
    return record;
  };
  const finish = (record, operation, inner, binding = null) => {
    if (operation.done) return;
    operation.done = true;
    operation.live = false;
    if (operation.timer != null) clearTimer(operation.timer);
    try { operation.unsubscribe?.(); } catch { /* observer cleanup */ }
    try { operation.boundaryUnsubscribe?.(); } catch { /* boundary observer cleanup */ }
    operation.inner = inner;
    operation.binding = binding;
    record.live = [...record.operations.values()].some((entry) => entry.live);
    record.completedAt = now();
    operation.resolve?.(inner);
  };
  const operationResult = (record, operation, commandId) => {
    if (!operation.live && operation.binding && !bindingCurrent(operation.binding)) {
      return Promise.resolve(wrap(failed(operation.transferId, 'SOURCE_CHANGED'), commandId));
    }
    return operation.live
      ? operation.promise.then((inner) => wrap(inner, commandId))
      : Promise.resolve(wrap(operation.inner, commandId));
  };
  const addOperation = (record, op, params) => {
    const operation = { transferId: params.transferId, op, fingerprint: stable(params), live: false, done: false, inner: null, binding: null, timer: null, unsubscribe: null, boundaryUnsubscribe: null, boundary: null, queuedObservation: null, baseline: null, resolve: null, promise: null, context: {} };
    record.operations.set(op, operation);
    return operation;
  };
  const observeStart = (record, operation, params, sourceSnapshot) => (observation) => {
    if (!operation.live || !operation.beginInvoked || record.tombstone || disposed) return;
    if (!operation.boundary) {
      operation.queuedObservation = observation;
      return;
    }
    if (!isObject(observation) || observation.operationId !== operation.operationId
      || observation.node !== operation.boundary.node
      || observation.rendererToken !== operation.boundary.rendererToken
      || observation.resolvedGeneration !== operation.boundary.resolvedGeneration) return;
    if (observation?.error) return finish(record, operation, failed(params.transferId, 'START_FAILED'));
    const current = currentIdentity();
    const sourceCurrent = sourceSnapshot.queue?.items?.[sourceSnapshot.queue?.currentIndex] ?? null;
    const baseline = operation.baseline;
    const baselineIsBound = baseline?.node != null;
    const nativeStateQualifies = sourceSnapshot.state === 'paused'
      ? observation.paused === true
      : observation.paused === false
        && observation.playingObserved === true
        && observation.advancedObserved === true;
    const qualifies = observation.node && Number.isInteger(observation.nodeGeneration)
      && Number.isInteger(observation.resolvedGeneration)
      && (!baselineIsBound || (observation.node !== baseline.node
        && Number.isInteger(baseline.nodeGeneration)
        && Number.isInteger(baseline.resolvedGeneration)
        && observation.nodeGeneration > baseline.nodeGeneration
        && observation.resolvedGeneration > baseline.resolvedGeneration))
      && observation.resolvedContentId === sourceCurrent?.contentId
      && observation.identity && current && samePlaybackOwnerIdentity(observation.identity, current)
      && observation.identity.contentId === sourceCurrent?.contentId
      && observation.identity.queueItemId === sourceCurrent?.queueItemId
      && Number.isFinite(observation.currentTime)
      && Math.abs(observation.currentTime - params.positionPolicy.seconds) <= positionToleranceSeconds
      && (params.positionPolicy.seconds === 0 || observation.targetSeekedObserved === true)
      && observation.readyState >= 2 && nativeStateQualifies && observation.seeking === false
      && observation.ended === false && !observation.error;
    if (!qualifies) return;
    const receipt = {
      transferId: params.transferId, phase: 'started',
      destination: { kind: destination.kind, id: destination.id, ownerInstanceId: observation.identity.ownerInstanceId },
      identity: clone(observation.identity), snapshotFingerprint: fingerprintHandoffSnapshot(sourceSnapshot),
      actualPosition: observation.currentTime, liveEdge: false, receiptId: receiptId(),
    };
    finish(record, operation, terminal(params.transferId, 'started', { receipt }), clone(observation.identity));
  };
  const acceptsBoundary = (operation, params, binding) => {
    if (!isObject(binding) || binding.operationId !== operation.operationId
      || !binding.node || !Number.isInteger(binding.resolvedGeneration)
      || !binding.rendererToken || !Object.isFrozen(binding.rendererToken)
      || binding.targetSeconds !== params.positionPolicy.seconds) return false;
    const baseline = operation.baseline;
    if (baseline?.node != null && (binding.node === baseline.node
      || !Number.isInteger(baseline.resolvedGeneration)
      || binding.resolvedGeneration <= baseline.resolvedGeneration)) return false;
    operation.boundary = Object.freeze({
      operationId: binding.operationId,
      node: binding.node,
      resolvedGeneration: binding.resolvedGeneration,
      rendererToken: binding.rendererToken,
      targetSeconds: binding.targetSeconds,
    });
    const queued = operation.queuedObservation;
    operation.queuedObservation = null;
    if (queued) observeStart(operation.record, operation, params, operation.context.sourceSnapshot)(queued);
    return true;
  };
  const beginObservedOperation = (record, operation, params, sourceSnapshot, begin) => {
    operation.record = record;
    const observedBaseline = owner.getNativeObservation?.() ?? null;
    operation.baseline = observedBaseline ? {
      node: observedBaseline.node ?? null,
      nodeGeneration: observedBaseline.nodeGeneration,
      resolvedGeneration: observedBaseline.resolvedGeneration,
    } : null;
    operation.live = true;
    record.live = true;
    operation.promise = new Promise((resolve) => { operation.resolve = resolve; });
    operation.beginInvoked = false;
    operation.accepted = false;
    operation.pendingBoundary = null;
    const nativeUnsubscribe = owner.subscribeNative?.(observeStart(record, operation, params, sourceSnapshot)) ?? (() => {});
    operation.unsubscribe = nativeUnsubscribe;
    if (operation.done) {
      try { nativeUnsubscribe?.(); } catch { /* observer cleanup */ }
    }
    const boundarySubscription = owner.subscribeHandoffBoundaryBinding?.((binding) => {
      if (!operation.beginInvoked) return false;
      if (!operation.accepted) {
        operation.pendingBoundary = binding;
        return false;
      }
      return acceptsBoundary(operation, params, binding);
    });
    const boundaryUnsubscribe = typeof boundarySubscription === 'function'
      ? boundarySubscription
      : boundarySubscription?.unsubscribe ?? null;
    operation.boundaryUnsubscribe = boundaryUnsubscribe;
    if (operation.done) {
      try { boundaryUnsubscribe?.(); } catch { /* boundary observer cleanup */ }
    }
    const timer = setTimer(() => finish(record, operation, failed(params.transferId, 'START_TIMEOUT')), startDeadlineMs);
    operation.timer = timer;
    if (operation.done) clearTimer(timer);
    let started;
    operation.beginInvoked = true;
    try { started = begin(); } catch { started = { ok: false, code: 'START_FAILED' }; }
    if (!started?.ok || started.operationId !== operation.operationId) {
      finish(record, operation, failed(params.transferId, started?.code || 'START_FAILED'));
      return;
    }
    operation.accepted = true;
    const currentBinding = owner.getHandoffBoundaryBinding?.(operation.operationId);
    if (currentBinding) acceptsBoundary(operation, params, currentBinding);
    else if (operation.pendingBoundary) acceptsBoundary(operation, params, operation.pendingBoundary);
    operation.pendingBoundary = null;
  };
  const execute = async ({ commandId, params } = {}) => {
    const validation = validateHandoffParams(params);
    let transferId = params?.transferId ?? 'invalid-transfer';
    if (disposed) return wrap(failed(transferId, 'EXECUTOR_DISPOSED'), commandId);
    if (!validation.valid) return wrap(failed(transferId, 'INVALID_HANDOFF'), commandId);
    // Every later closure, fingerprint, and adapter request observes this one
    // detached validated operation, never caller-owned mutable input.
    params = clone(params);
    transferId = params.transferId;
    const record = reserve(transferId);
    if (!record) return wrap(failed(transferId, 'HANDOFF_CAPACITY'), commandId);
    if (params.op === 'status') {
      const cancelled = record.operations.get('cancel')?.inner;
      if (record.tombstone && cancelled?.handoff?.phase === 'cancelled') {
        return wrap(cancelled, commandId);
      }
      const live = [...record.operations.values()].some((entry) => entry.live);
      const terminalOperation = [...record.operations.values()].reverse().find((entry) => !entry.live && entry.inner);
      if (live) return wrap(terminal(transferId, 'starting'), commandId);
      if (terminalOperation?.binding && !bindingCurrent(terminalOperation.binding)) {
        return wrap(failed(transferId, 'SOURCE_CHANGED'), commandId);
      }
      return wrap(terminalOperation?.inner ?? failed(transferId, 'HANDOFF_UNKNOWN'), commandId);
    }
    const existing = record.operations.get(params.op);
    const fingerprint = stable(params);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return wrap(failed(transferId, 'HANDOFF_CONFLICT'), commandId);
      return operationResult(record, existing, commandId);
    }

    if (params.op === 'capture') {
      const operation = addOperation(record, 'capture', params);
      const captured = readCapture();
      finish(record, operation, captured ? terminal(transferId, 'captured', { capture: captured }) : failed(transferId, 'INVALID_CAPTURE'));
      return wrap(operation.inner, commandId);
    }
    if (params.op === 'cancel') {
      const operation = addOperation(record, 'cancel', params);
      const current = currentIdentity();
      const active = [...record.operations.values()].reverse().find((entry) => entry.live
        && (entry.op === 'start' || entry.op === 'align'));
      if (!current || !samePlaybackOwnerIdentity(params.expected, current)) {
        finish(record, operation, failed(transferId, 'SOURCE_CHANGED'), current);
        return wrap(operation.inner, commandId);
      }
      if (active) {
        let cancelled;
        try { cancelled = owner.cancelHandoffStart?.(active.operationId); } catch { cancelled = { ok: false, code: 'CANCEL_REJECTED' }; }
        if (!cancelled?.ok) {
          finish(record, operation, failed(transferId, cancelled?.code || 'CANCEL_REJECTED'), current);
          return wrap(operation.inner, commandId);
        }
        record.tombstone = true;
        finish(record, active, failed(transferId, 'CANCELLED'));
      } else {
        record.tombstone = true;
      }
      finish(record, operation, terminal(transferId, 'cancelled'), current);
      return wrap(operation.inner, commandId);
    }
    if (params.op === 'commit-stop') {
      if (record.tombstone) return wrap(failed(transferId, 'CANCELLED'), commandId);
      const operation = addOperation(record, 'commit-stop', params);
      const fresh = readCapture();
      const native = owner.getNativeObservation?.();
      const fingerprintMatches = fresh && fingerprintHandoffSnapshot(fresh.snapshot) === params.destinationReceipt.snapshotFingerprint;
      const nativeMatches = native?.identity && fresh?.identity && samePlaybackOwnerIdentity(native.identity, fresh.identity)
        && Number.isFinite(native.currentTime);
      if (!fresh || !fingerprintMatches || !nativeMatches || !samePlaybackOwnerIdentity(params.expected, fresh.identity)) {
        finish(record, operation, failed(transferId, 'SOURCE_CHANGED'), fresh?.identity ?? null);
      } else if (Math.abs(native.currentTime - params.destinationReceipt.actualPosition) > SOURCE_POSITION_TOLERANCE_SECONDS) {
        finish(record, operation, failed(transferId, 'POSITION_MOVED', { freshCapture: fresh }), fresh.identity);
      } else {
        let stopped;
        try { stopped = owner.stopIfCurrent?.(params.expected); } catch { stopped = { ok: false, code: 'SOURCE_CHANGED' }; }
        const post = currentIdentity();
        finish(record, operation, stopped?.ok ? terminal(transferId, 'stopped') : failed(transferId, stopped?.code || 'SOURCE_CHANGED'), post);
      }
      return wrap(operation.inner, commandId);
    }

    const isStart = params.op === 'start';
    const operation = addOperation(record, params.op, params);
    const sourceSnapshot = isStart ? params.snapshot : record.operations.get('start')?.context.sourceSnapshot;
    const currentCapture = readCapture();
    const current = currentCapture?.identity ?? null;
    if (!sourceSnapshot || record.tombstone || !current || !samePlaybackOwnerIdentity(params.expectedDestination, current)) {
      finish(record, operation, failed(transferId, 'SOURCE_CHANGED'), current);
    } else if (!currentCapture.capabilities.handoffV1 || !currentCapture.capabilities.seekable
      || params.positionPolicy.kind === 'live-edge') {
      finish(record, operation, failed(transferId, 'HANDOFF_UNSUPPORTED'), current);
    } else {
      operation.operationId = `${transferId}:${params.op}`;
      operation.context.sourceSnapshot = sourceSnapshot;
      if (isStart) record.operations.get('start').context.sourceSnapshot = sourceSnapshot;
      beginObservedOperation(record, operation, params, sourceSnapshot, () => isStart
        ? owner.adoptAndBeginHandoffStart?.({ operationId: operation.operationId, snapshot: clone(sourceSnapshot), targetSeconds: params.positionPolicy.seconds })
        : owner.alignHandoffStart?.({ operationId: operation.operationId, expected: params.expectedDestination, targetSeconds: params.positionPolicy.seconds }));
    }
    return operationResult(record, operation, commandId);
  };

  return {
    execute,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of records.values()) {
        for (const operation of record.operations.values()) {
          if (operation.live) finish(record, operation, failed(operation.transferId, 'EXECUTOR_DISPOSED'));
        }
      }
      records.clear();
    },
  };
}
