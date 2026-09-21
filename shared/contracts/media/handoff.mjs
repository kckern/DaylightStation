// Versioned handoff wire contract. This deliberately describes owner evidence
// without claiming that any receiver can produce it; F3b owns that executor.
import { validateSessionSnapshot } from './shapes.mjs';
import { samePlaybackOwnerIdentity, validatePlaybackOwnerIdentity } from './playback-owner.mjs';

const isString = (value) => typeof value === 'string' && value.length > 0;
const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const result = (errors) => ({ valid: errors.length === 0, errors });
const OPS = new Set(['capture', 'start', 'align', 'status', 'cancel', 'commit-stop']);
const PHASES = new Set(['captured', 'starting', 'started', 'stopped', 'cancelled', 'failed']);

/** Stable queue/current/config identity; deliberately excludes hot position,
 * mutable metadata, and enrichment so an owner can bind a start receipt. */
export function fingerprintHandoffSnapshot(snapshot) {
  const queue = snapshot?.queue ?? {};
  const items = Array.isArray(queue.items) ? queue.items : [];
  const currentIndex = Number.isInteger(queue.currentIndex) ? queue.currentIndex : -1;
  const executionOrder = Array.isArray(queue.executionOrder)
    ? queue.executionOrder
    : (currentIndex >= 0 ? items.slice(currentIndex).map((item) => item?.queueItemId) : []);
  const config = snapshot?.config ?? {};
  return `handoff-v1:${JSON.stringify({
    sessionId: snapshot?.sessionId ?? null,
    queue: {
      items: items.map((item) => ({ queueItemId: item?.queueItemId ?? null, contentId: item?.contentId ?? null, priority: item?.priority ?? null })),
      currentIndex,
      executionOrder,
    },
    currentItem: snapshot?.currentItem == null ? null : { contentId: snapshot.currentItem.contentId ?? null, format: snapshot.currentItem.format ?? null },
    config: {
      shuffle: config.shuffle ?? false, repeat: config.repeat ?? 'off', shader: config.shader ?? null,
      volume: config.volume ?? 50, playbackRate: config.playbackRate ?? 1,
    },
  })}`;
}

function validateIdentity(value, field, errors) {
  const checked = validatePlaybackOwnerIdentity(value);
  if (!checked.valid) errors.push(...checked.errors.map((error) => `${field}.${error}`));
}

function validatePositionPolicy(value, errors) {
  if (!value || typeof value !== 'object') { errors.push('positionPolicy: required object'); return; }
  if (value.kind === 'absolute') {
    if (!isFiniteNonNegative(value.seconds)) errors.push('positionPolicy.seconds: required non-negative finite number');
    if (Object.keys(value).some((key) => key !== 'kind' && key !== 'seconds')) errors.push('positionPolicy: unexpected field');
    return;
  }
  if (value.kind === 'live-edge') {
    if (Object.keys(value).some((key) => key !== 'kind')) errors.push('positionPolicy: unexpected field');
    return;
  }
  errors.push('positionPolicy.kind: must be absolute|live-edge');
}

function validateDestination(value, errors) {
  if (!value || typeof value !== 'object') { errors.push('receipt.destination: required object'); return; }
  if (value.kind !== 'device' && value.kind !== 'client') errors.push('receipt.destination.kind: must be device|client');
  if (!isString(value.id)) errors.push('receipt.destination.id: required string');
  if (!isString(value.ownerInstanceId)) errors.push('receipt.destination.ownerInstanceId: required string');
  if (Object.keys(value).some((key) => !['kind', 'id', 'ownerInstanceId'].includes(key))) errors.push('receipt.destination: unexpected field');
}

export function validateStartedReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') return result(['receipt: required object']);
  if (!isString(receipt.transferId)) errors.push('receipt.transferId: required string');
  if (receipt.phase !== 'started') errors.push('receipt.phase: must be started');
  validateDestination(receipt.destination, errors);
  validateIdentity(receipt.identity, 'receipt.identity', errors);
  if (receipt.destination?.ownerInstanceId !== receipt.identity?.ownerInstanceId) {
    errors.push('receipt.destination.ownerInstanceId: must match receipt identity');
  }
  if (!isString(receipt.snapshotFingerprint)) errors.push('receipt.snapshotFingerprint: required string');
  if (!isFiniteNonNegative(receipt.actualPosition)) errors.push('receipt.actualPosition: required non-negative finite number');
  if (typeof receipt.liveEdge !== 'boolean') errors.push('receipt.liveEdge: required boolean');
  if (!isString(receipt.receiptId)) errors.push('receipt.receiptId: required string');
  const allowed = new Set(['transferId', 'phase', 'destination', 'identity', 'snapshotFingerprint', 'actualPosition', 'liveEdge', 'receiptId']);
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) errors.push(`receipt: unexpected field ${key}`);
  return result(errors);
}

function validateCapture(capture, errors) {
  if (!capture || typeof capture !== 'object') { errors.push('capture: required object'); return; }
  const snapshot = validateSessionSnapshot(capture.snapshot);
  if (!snapshot.valid) errors.push(...snapshot.errors.map((error) => `capture.snapshot.${error}`));
  validateIdentity(capture.identity, 'capture.identity', errors);
  const snapshotIdentity = capture.snapshot?.meta?.playbackOwner;
  if (!snapshotIdentity || !samePlaybackOwnerIdentity(snapshotIdentity, capture.identity)) {
    errors.push('capture.identity: must match snapshot playback owner');
  }
  if (!capture.capabilities || typeof capture.capabilities !== 'object'
    || typeof capture.capabilities.handoffV1 !== 'boolean'
    || typeof capture.capabilities.seekable !== 'boolean'
    || typeof capture.capabilities.liveEdge !== 'boolean') errors.push('capture.capabilities: required handoffV1/seekable/liveEdge booleans');
  const allowed = new Set(['snapshot', 'identity', 'capabilities']);
  for (const key of Object.keys(capture)) if (!allowed.has(key)) errors.push(`capture: unexpected field ${key}`);
}

function snapshotCurrentIdentity(snapshot) {
  const currentIndex = snapshot?.queue?.currentIndex;
  const current = Number.isInteger(currentIndex) ? snapshot?.queue?.items?.[currentIndex] : null;
  return current
    ? { contentId: current.contentId, queueItemId: current.queueItemId }
    : { contentId: null, queueItemId: null };
}

function sameMediaIdentity(left, right) {
  return left?.contentId === right?.contentId && left?.queueItemId === right?.queueItemId;
}

export function validateHandoffParams(params) {
  const errors = [];
  if (!params || typeof params !== 'object') return result(['handoff: required object']);
  if (params.version !== 1) errors.push('version: must be 1');
  if (!isString(params.transferId)) errors.push('transferId: required string');
  if (!OPS.has(params.op)) errors.push('op: must be capture|start|align|status|cancel|commit-stop');
  if (params.op === 'start') {
    const snapshot = validateSessionSnapshot(params.snapshot);
    if (!snapshot.valid) errors.push(...snapshot.errors.map((error) => `snapshot.${error}`));
    validateIdentity(params.expectedDestination, 'expectedDestination', errors);
    validatePositionPolicy(params.positionPolicy, errors);
  }
  if (params.op === 'align') {
    validateIdentity(params.expectedDestination, 'expectedDestination', errors);
    validatePositionPolicy(params.positionPolicy, errors);
  }
  if (params.op === 'cancel') validateIdentity(params.expected, 'expected', errors);
  if (params.op === 'commit-stop') {
    validateIdentity(params.expected, 'expected', errors);
    const receipt = validateStartedReceipt(params.destinationReceipt);
    if (!receipt.valid) errors.push(...receipt.errors.map((error) => `destinationReceipt.${error}`));
    if (params.destinationReceipt?.transferId !== params.transferId) errors.push('destinationReceipt.transferId: must match transferId');
  }
  const allowedByOp = {
    capture: ['version', 'transferId', 'op'], status: ['version', 'transferId', 'op'],
    start: ['version', 'transferId', 'op', 'snapshot', 'expectedDestination', 'positionPolicy'],
    align: ['version', 'transferId', 'op', 'expectedDestination', 'positionPolicy'],
    cancel: ['version', 'transferId', 'op', 'expected'],
    'commit-stop': ['version', 'transferId', 'op', 'expected', 'destinationReceipt'],
  };
  for (const key of Object.keys(params)) if (!allowedByOp[params.op]?.includes(key)) errors.push(`handoff: unexpected field ${key}`);
  return result(errors);
}

export function validateHandoffResult(handoff) {
  const errors = [];
  if (!handoff || typeof handoff !== 'object') return result(['handoff: required object']);
  if (!isString(handoff.transferId)) errors.push('transferId: required string');
  if (!PHASES.has(handoff.phase)) errors.push('phase: invalid');
  if (handoff.phase === 'captured') validateCapture(handoff.capture, errors);
  if (handoff.phase === 'started') {
    const receipt = validateStartedReceipt(handoff.receipt);
    if (!receipt.valid) errors.push(...receipt.errors);
    if (handoff.receipt?.transferId !== handoff.transferId) errors.push('receipt.transferId: must match transferId');
  }
  if (handoff.phase === 'failed' && !isString(handoff.code)) errors.push('code: required for failed phase');
  const allowed = new Set(['transferId', 'phase', 'capture', 'receipt', 'code']);
  for (const key of Object.keys(handoff)) if (!allowed.has(key)) errors.push(`handoff: unexpected field ${key}`);
  return result(errors);
}

export function validateHandoffCommandAck(command, ack, { target = null } = {}) {
  const errors = [];
  if (command?.command !== 'handoff') return result(['command: must be handoff']);
  const params = validateHandoffParams(command.params);
  if (!params.valid) errors.push(...params.errors.map((error) => `command.params.${error}`));
  if (ack?.commandId !== command?.commandId) errors.push('commandId: must match command');
  const handoff = validateHandoffResult(ack?.handoff);
  if (!handoff.valid) errors.push(...handoff.errors);
  if (ack?.handoff?.transferId !== command?.params?.transferId) errors.push('handoff.transferId: must match command');
  const expected = { capture: ['captured', 'failed'], start: ['started', 'failed'], align: ['started', 'failed'], status: [...PHASES], cancel: ['cancelled', 'failed'], 'commit-stop': ['stopped', 'failed'] };
  if (!expected[command?.params?.op]?.includes(ack?.handoff?.phase)) errors.push('handoff.phase: invalid for operation');
  if (typeof ack?.ok !== 'boolean' || ack.ok !== (ack?.handoff?.phase !== 'failed')) errors.push('ok: must match handoff phase');
  if (ack?.handoff?.phase === 'started') {
    const receipt = ack.handoff.receipt;
    if (!target || !['device', 'client'].includes(target.kind) || !isString(target.id)) errors.push('target: required receiver route');
    else if (receipt?.destination?.kind !== target.kind || receipt?.destination?.id !== target.id) errors.push('receipt.destination: must match receiver route');
  }
  if ((command?.params?.op === 'start' || command?.params?.op === 'align') && ack?.handoff?.phase === 'started') {
    const receipt = ack.handoff.receipt;
    const expectedOwner = command.params.expectedDestination?.ownerInstanceId;
    if (receipt?.destination?.ownerInstanceId !== expectedOwner || receipt?.identity?.ownerInstanceId !== expectedOwner) {
      errors.push('receipt: must match expected destination owner');
    }
    if (command.params.op === 'start' && receipt?.snapshotFingerprint !== fingerprintHandoffSnapshot(command.params.snapshot)) {
      errors.push('receipt.snapshotFingerprint: must match start snapshot');
    }
    const expectedMedia = command.params.op === 'start'
      ? snapshotCurrentIdentity(command.params.snapshot)
      : command.params.expectedDestination;
    if (!sameMediaIdentity(receipt?.identity, expectedMedia)) {
      errors.push('receipt.identity: must match expected current media identity');
    }
    const expectsLiveEdge = command.params.positionPolicy?.kind === 'live-edge';
    if (receipt?.liveEdge !== expectsLiveEdge) errors.push('receipt.liveEdge: must match position policy');
  }
  return result(errors);
}
